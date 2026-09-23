import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/accessControl';
import { assertTrustedOrigin } from '@/lib/csrf';
import supabaseDb from '@/lib/supabaseDb';

export const dynamic = 'force-dynamic';

// POST /api/candidate/sessions/[id]/reject
// Candidate declines an interview assigned to their email. The session is
// marked with mode: 'rejected' — a terminal state (see TERMINAL_SESSION_MODES
// in lib/kv.ts) so the interviewer can clearly see the candidate rejected it,
// and it no longer blocks study deletion or can be started/rejoined.
//
// The request is body-less, so a cross-site page can issue it as a CORS
// "simple request" that never preflights, and in production the session cookie
// is SameSite=None — the API is on another host from the frontends — so the
// browser attaches it. Without the origin check below, any page a signed-in
// candidate visits could push them into this terminal state.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const csrfError = assertTrustedOrigin(request);
  if (csrfError) return csrfError;

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
