import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/accessControl';
import supabaseDb from '@/lib/supabaseDb';

export const dynamic = 'force-dynamic';

function parseConfig(configJSON?: string | null) {
  if (!configJSON) return null;
  try {
    return JSON.parse(configJSON);
  } catch {
    return null;
  }
}

function readCompanyName(config: any): string {
  const value = config?.companyName || config?.company || config?.organization || config?.organisation || '';
  return typeof value === 'string' ? value.trim() : '';
}

export async function GET() {
  const authUser = await getAuthUser();

  if (!authUser?.id || authUser.role !== 'candidate') {
    return NextResponse.json({ error: 'Candidate login required' }, { status: 401 });
  }

  const user = await supabaseDb.user.findUnique({
    where: { id: authUser.id },
    select: { id: true, name: true, email: true },
  });

  if (!user?.email) {
    return NextResponse.json({ error: 'Candidate email not found' }, { status: 404 });
  }

  const email = user.email.toLowerCase();
  const sessions = await supabaseDb.interviewSession.findMany({
    where: {
      OR: [
        { userId: user.id },
        { candidateEmail: email },
      ],
    },
    include: { study: { include: { user: true } }, scoreBreakdown: true },
    orderBy: { startedAt: 'desc' },
  });

  const visibleSessions = sessions
    .filter((session: any) => session.candidateEmail?.toLowerCase() === email || session.userId === user.id)
    .map((session: any) => {
      const config = parseConfig(session.study?.configJSON);
      return {
        id: session.id,
        studyId: session.studyId,
        title: config?.name || session.role || 'Interview',
        description: config?.description || '',
        topic: config?.researchQuestion || '',
        companyName: readCompanyName(config),
        interviewerName: session.study?.user?.name || session.study?.user?.email || 'Interviewer',
        interviewerEmail: session.study?.user?.email || '',
        candidateName: session.candidateName || user.name || 'Candidate',
        candidateEmail: session.candidateEmail || user.email,
        assignedAt: session.startedAt,
        startedAt: session.mode === 'assigned' ? null : session.startedAt,
        completedAt: session.completedAt,
        averageScore: session.averageScore,
        status: session.completedAt
          ? 'completed'
          : session.mode === 'rejected'
            ? 'rejected'
            : session.mode === 'assigned'
              ? 'assigned'
              : 'in_progress',
        questionCount: config?.coreQuestions?.length || 0,
      };
    });

  return NextResponse.json({ sessions: visibleSessions });
}
