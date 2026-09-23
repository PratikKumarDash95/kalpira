import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/accessControl';
import { assertTrustedOrigin } from '@/lib/csrf';
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

// Body-less POST, therefore a CORS "simple request" that never preflights —
// see the note in candidate/sessions/[id]/reject for the full mechanism. The
// session cookie rides along cross-site in production, so without this check a
// page the candidate visits could claim their assigned interview and bind the
// session row to their own account.
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
    include: { study: true },
  });

  if (!session || session.candidateEmail?.toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({ error: 'This interview is not assigned to your email' }, { status: 403 });
  }

  if (session.completedAt || session.mode === 'terminated') {
    return NextResponse.json({ error: 'This interview has already been completed or terminated' }, { status: 409 });
  }

  if (session.mode === 'rejected') {
    return NextResponse.json({ error: 'You rejected this interview and it can no longer be started.' }, { status: 409 });
  }

  if (!session.study) {
    return NextResponse.json({ error: 'This interview is no longer available — the study it belonged to was removed by the interviewer.' }, { status: 410 });
  }

  const config = parseConfig(session.study.configJSON);
  if (!config) {
    return NextResponse.json({ error: 'Interview configuration is invalid' }, { status: 500 });
  }

  await supabaseDb.interviewSession.update({
    where: { id: session.id },
    data: {
      userId: user.id,
      mode: session.mode === 'assigned' ? 'video' : session.mode,
      candidateName: session.candidateName || user.name || 'Candidate',
      candidateEmail: user.email.toLowerCase(),
    },
  });

  return NextResponse.json({
    sessionId: session.id,
    studyId: session.studyId,
    studyConfig: { ...config, id: session.studyId || config.id },
    candidate: {
      name: session.candidateName || user.name || 'Candidate',
      email: user.email.toLowerCase(),
    },
  });
}
