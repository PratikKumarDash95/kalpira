import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import supabaseDb from '@/lib/supabaseDb';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/auth';
import { isInterviewClosed } from '@/lib/interviewDeadline';

export const dynamic = 'force-dynamic';

const db = supabaseDb as any;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function getInterviewerId(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return null;
    const session = await verifySessionToken(token);
    if (!session.valid || !session.researcherId) return null;
    const user = await db.user.findUnique({ where: { id: session.researcherId } });
    if (!user || user.role !== 'interviewer') return null;
    return user.id;
  } catch {
    return null;
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const interviewerId = await getInterviewerId();

  if (!interviewerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

  const assignments = [];
  let reusedCount = 0;
  let createdCount = 0;

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

  return NextResponse.json({
    assignment: assignments[0] || null,
    assignments,
    reused: createdCount === 0,
    reusedCount,
    createdCount,
  });
}
