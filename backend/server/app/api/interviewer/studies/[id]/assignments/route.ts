import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { isInterviewClosed } from '@/lib/interviewDeadline';
import { sendInterviewAssignmentEmail } from '@/lib/email';
import { getInterviewerUser } from '@/lib/interviewerAuth';
import { resolveEffectivePlan } from '@/lib/plans';
import { excludeSelfPreviewSessions } from '@/lib/previewSession';
import { BUDGETS, accountKey, checkBudget, penalize, tooManyRequests } from '@/lib/throttle';

export const dynamic = 'force-dynamic';

const db = supabaseDb as any;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const interviewer = await getInterviewerUser();

  if (!interviewer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const interviewerId = interviewer.id;

  const study = await db.study.findFirst({
    where: { id: params.id, userId: interviewerId },
  });

  if (!study) {
    return NextResponse.json({ error: 'Study not found' }, { status: 404 });
  }

  const body = await request.json();
  const rawCandidates = Array.isArray(body.candidates)
    ? body.candidates
    : [{ candidateName: body.candidateName, candidateEmail: body.candidateEmail }];
  const candidates = rawCandidates.map((candidate: any) => ({
    candidateName: typeof candidate.candidateName === 'string' ? candidate.candidateName.trim() : '',
    candidateEmail: typeof candidate.candidateEmail === 'string' ? candidate.candidateEmail.trim().toLowerCase() : '',
  })).filter((candidate: any) => candidate.candidateName || candidate.candidateEmail);

  if (!candidates.length || candidates.some((candidate: any) => !candidate.candidateName || !emailPattern.test(candidate.candidateEmail))) {
    return NextResponse.json({ error: 'Candidate names and valid emails are required' }, { status: 400 });
  }

  const uniqueCandidates = Array.from(new Map(candidates.map((candidate: any) => [candidate.candidateEmail, candidate])).values()) as {
    candidateName: string;
    candidateEmail: string;
  }[];
  const config = JSON.parse(study.configJSON);
  if (isInterviewClosed(config)) {
    const pendingAssignments = await db.interviewSession.findMany({
      where: { studyId: params.id, mode: 'assigned', completedAt: null },
    });
    await Promise.all(pendingAssignments.map((session: any) =>
      db.interviewSession.update({
        where: { id: session.id },
        data: { mode: 'absent' },
      })
    ));
    return NextResponse.json({ error: 'This interview is closed. New candidates cannot be assigned.' }, { status: 410 });
  }

  // Enforce the plan's per-interview candidate (seat) limit. Self-preview runs
  // don't consume seats, so exclude them from the existing count.
  const { limits } = resolveEffectivePlan(interviewer);
  const existingSessions = await db.interviewSession.findMany({ where: { studyId: params.id } });
  const existingRealCount = excludeSelfPreviewSessions(existingSessions).length;
  const newCandidateEmails = new Set(existingSessions.map((s: any) => (s.candidateEmail || '').toLowerCase()));
  const incomingNewCount = uniqueCandidates.filter((c) => !newCandidateEmails.has(c.candidateEmail)).length;
  if (existingRealCount + incomingNewCount > limits.maxStudentsPerInterview) {
    return NextResponse.json(
      {
        error: `This exceeds your plan's limit of ${limits.maxStudentsPerInterview} candidates per interview. Upgrade your plan for more seats.`,
        code: 'PLAN_LIMIT',
      },
      { status: 403 },
    );
  }

  // Bound the mail this route can generate, BEFORE anything is written, so a
  // refusal leaves no half-done batch behind.
  //
  // This exists because of what the DB fix next to it unblocked. The candidate
  // lookup below used to throw (a `completedAt: null` filter the shim turned
  // into `completedAt=eq.null`, which PostgREST rejects), and it threw before
  // the mail loop was reached — so this route had silently created nothing and
  // sent nothing for a long time. Repairing the query restores both. Session
  // creation is bounded by the seat check above; the mail is not bounded by
  // anything: the loop below mails every unique candidate including the reused
  // ones, to addresses the caller chooses, every time the caller asks. That is
  // an inbox-flooding vector for any account that can create a study.
  //
  // Accounted per RECIPIENT, not per request: one request can carry thousands
  // of addresses, so a per-request budget would not bound the volume at all.
  const mailBudgetKey = accountKey('assignmentEmail', 'interviewer', interviewer.email || interviewerId);
  const mailBudget = checkBudget(mailBudgetKey, BUDGETS.assignmentEmail);
  if (mailBudget.remaining < uniqueCandidates.length) {
    return NextResponse.json(
      tooManyRequests(
        mailBudget,
        'Too many assignment emails have been sent from this account recently. Please wait and try again.'
      ),
      { status: 429, headers: { 'Retry-After': String(mailBudget.retryAfterSeconds) } }
    );
  }

  const assignments = [];
  let reusedCount = 0;
  let createdCount = 0;
  let emailSentCount = 0;
  let emailFailedCount = 0;

  const studyName = typeof config?.name === 'string' && config.name.trim() ? config.name.trim() : 'Interview';
  const companyName = typeof config?.companyName === 'string' ? config.companyName : '';

  for (const candidate of uniqueCandidates) {
    const existing = await db.interviewSession.findFirst({
      where: {
        studyId: params.id,
        candidateEmail: candidate.candidateEmail,
        completedAt: null,
      },
    });

    if (existing) {
      reusedCount += 1;
      assignments.push(existing);
      continue;
    }

    const assignment = await db.interviewSession.create({
      data: {
        userId: interviewerId,
        role: config.name || 'Interview',
        difficulty: 'medium',
        mode: 'assigned',
        startedAt: new Date(),
        averageScore: 0,
        studyId: params.id,
        candidateName: candidate.candidateName,
        candidateEmail: candidate.candidateEmail,
      },
    });

    createdCount += 1;
    assignments.push(assignment);
  }

  for (const candidate of uniqueCandidates) {
    // Spent per recipient whether or not the send succeeds: the cost is the
    // attempt, and a failed send is not a reason to hand the budget back to a
    // caller working through a bad address list.
    penalize(mailBudgetKey, BUDGETS.assignmentEmail);
    try {
      await sendInterviewAssignmentEmail({
        candidateEmail: candidate.candidateEmail,
        candidateName: candidate.candidateName,
        interviewerName: interviewer?.name || interviewer?.email || 'Interviewer',
        studyName,
        companyName,
      });
      emailSentCount += 1;
    } catch (error) {
      emailFailedCount += 1;
      console.error('Failed to send assignment email:', candidate.candidateEmail, error);
    }
  }

  return NextResponse.json({
    assignment: assignments[0] || null,
    assignments,
    reused: createdCount === 0,
    reusedCount,
    createdCount,
    emailSentCount,
    emailFailedCount,
  });
}
