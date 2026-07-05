import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { isInterviewClosed } from '@/lib/interviewDeadline';
import { sendInterviewAssignmentEmail } from '@/lib/email';
import { getInterviewerUser } from '@/lib/interviewerAuth';
import { resolveEffectivePlan } from '@/lib/plans';
import { excludeSelfPreviewSessions } from '@/lib/previewSession';

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
