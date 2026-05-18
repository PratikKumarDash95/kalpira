import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import supabaseDb from '@/lib/supabaseDb';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const db = supabaseDb as any;

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
  const candidateName = typeof body.candidateName === 'string' ? body.candidateName.trim() : '';
  const candidateEmail = typeof body.candidateEmail === 'string' ? body.candidateEmail.trim().toLowerCase() : '';

  if (!candidateName || !candidateEmail || !candidateEmail.includes('@')) {
    return NextResponse.json({ error: 'Candidate name and valid email are required' }, { status: 400 });
  }

  const existing = await db.interviewSession.findFirst({
    where: {
      studyId: params.id,
      candidateEmail,
      completedAt: null,
    },
  });

  if (existing) {
    return NextResponse.json({
      assignment: existing,
      reused: true,
    });
  }

  const config = JSON.parse(study.configJSON);
  const assignment = await db.interviewSession.create({
    data: {
      userId: interviewerId,
      role: config.name || 'Interview',
      difficulty: 'medium',
      mode: 'assigned',
      startedAt: new Date(),
      averageScore: 0,
      studyId: params.id,
      candidateName,
      candidateEmail,
    },
  });

  return NextResponse.json({ assignment, reused: false });
}
