import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/accessControl';
import supabaseDb from '@/lib/supabaseDb';

export const dynamic = 'force-dynamic';

// POST /api/candidate/sessions/[id]/reject
// Candidate declines an interview assigned to their email. The session is
// marked with mode: 'rejected' — a terminal state (see TERMINAL_SESSION_MODES
// in lib/kv.ts) so the interviewer can clearly see the candidate rejected it,
// and it no longer blocks study deletion or can be started/rejoined.
export async function POST(_request: Request, { params }: { params: { id: string } }) {
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

  const session = await supabaseDb.interviewSession.findUnique({
    where: { id: params.id },
    select: { id: true, candidateEmail: true, candidateName: true, completedAt: true, mode: true },
  });

  if (!session || session.candidateEmail?.toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({ error: 'This interview is not assigned to your email' }, { status: 403 });
  }

  if (session.completedAt) {
    return NextResponse.json({ error: 'This interview has already been completed and cannot be rejected' }, { status: 409 });
  }

  if (session.mode === 'rejected') {
    return NextResponse.json({ error: 'You have already rejected this interview' }, { status: 409 });
  }

  if (session.mode === 'terminated' || session.mode === 'absent') {
    return NextResponse.json({ error: 'This interview is already closed and cannot be rejected' }, { status: 409 });
  }

  await supabaseDb.interviewSession.update({
    where: { id: session.id },
    data: {
      userId: user.id,
      mode: 'rejected',
      candidateName: session.candidateName || user.name || 'Candidate',
      candidateEmail: user.email.toLowerCase(),
    },
  });

  return NextResponse.json({ sessionId: session.id, status: 'rejected' });
}
