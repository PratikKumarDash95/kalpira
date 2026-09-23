// POST /api/sessions/start — Create a new InterviewSession in the DB
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';
import supabaseDb from '@/lib/supabaseDb';
import { getParticipantRequestContext } from '@/lib/researcherContext';
import { getAuthUser } from '@/lib/accessControl';
import { isInterviewClosed } from '@/lib/interviewDeadline';

export const dynamic = 'force-dynamic';

function normalizeName(value?: string | null) {
    return (value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeEmail(value?: string | null) {
    return (value || '').trim().toLowerCase();
}

export async function POST(request: Request) {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

        let userId: string | null = null;
        if (token) {
            const session = await verifySessionToken(token);
            if (session.valid && session.researcherId) {
                userId = session.researcherId;
            }
        }

        const body = await request.json();
        const {
            role = 'General',
            difficulty = 'medium',
            mode = 'practice',
            studyId,
            candidateName,
            candidateEmail,
        } = body as {
            role?: string;
            difficulty?: string;
            mode?: string;
            studyId?: string;
            candidateName?: string;
            candidateEmail?: string;
        };

        const authUser = await getAuthUser();
        const participantAuth = await getParticipantRequestContext(request);

        // ── Identity comes from the session, never from the body ─────────────
        // `candidateName` and `candidateEmail` are free text. The email alone used
        // to be the whole gate: an authenticated candidate could name *any*
        // address, satisfy the "assigned candidate" test below, and then claim —
        // and rewrite the owner of — whichever session row in that study carried
        // it. The account's own address is the only thing in this request that
        // proves who is asking, and comparing against it is exactly what the
        // designed claim path (`/api/candidate/sessions/[id]/start`) already does.
        const callerEmail = normalizeEmail(authUser?.email);
        const normalizedCandidateEmail = normalizeEmail(candidateEmail);
        const namesSelf = Boolean(callerEmail && callerEmail === normalizedCandidateEmail);

        let studyConfig: any = null;
        if (studyId) {
            // Naming your own address is necessary but not sufficient: an account
            // holder is admitted only to an interview that was actually assigned
            // to that address. Without this, any signed-in candidate who knew or
            // guessed a study id could open the gate on a stranger's study and
            // write sessions into it, bypassing both the invitation link and its
            // expiry. An assignment row is the researcher's own record that this
            // address was invited.
            let isCandidateAssigned = false;
            if (authUser?.id && authUser.role === 'candidate' && namesSelf) {
                const assignment = await supabaseDb.interviewSession.findFirst({
                    where: { studyId, candidateEmail: normalizedCandidateEmail },
                    select: { id: true },
                });
                isCandidateAssigned = Boolean(assignment);
            }

            if (!participantAuth.valid && !isCandidateAssigned) {
                return NextResponse.json({ error: 'Valid participant link required for this study' }, { status: 401 });
            }

            const study = await supabaseDb.study.findFirst({
                where: { id: studyId },
                select: { configJSON: true },
            });

            if (study?.configJSON) {
                studyConfig = JSON.parse(study.configJSON);
                if (isInterviewClosed(studyConfig)) {
                    const pendingAssignments = await supabaseDb.interviewSession.findMany({
                        where: { studyId, mode: 'assigned', completedAt: null },
                    });
                    await Promise.all(pendingAssignments.map((session: any) =>
                        supabaseDb.interviewSession.update({
                            where: { id: session.id },
                            data: { mode: 'absent' },
                        })
                    ));

                    return NextResponse.json(
                        { error: 'This interview is closed. Please contact the interviewer.' },
                        { status: 410 }
                    );
                }
            }

            if (participantAuth.valid && participantAuth.studyId === studyId && candidateEmail) {
                if (studyConfig) {
                    const assigned = studyConfig.interviewerAssignment;
                    if (assigned?.candidateEmail) {
                        const nameMatches = normalizeName(candidateName) === normalizeName(assigned.candidateName);
                        const emailMatches = normalizeEmail(candidateEmail) === normalizeEmail(assigned.candidateEmail);

                        if (!nameMatches || !emailMatches) {
                            return NextResponse.json(
                                { error: 'Candidate details do not match this interview assignment' },
                                { status: 403 }
                            );
                        }
                    }
                }
            }

            if (participantAuth.valid && participantAuth.context && participantAuth.studyId === studyId) {
                userId = participantAuth.context.userId;
            } else if (authUser?.id) {
                userId = authUser.id;
            }
        }

        // Only persist sessions with a real authenticated user or a valid participant link.
        // Unassigned practice sessions stay transient so they do not appear as assigned interviews.
        if (!userId) {
            return NextResponse.json({ sessionId: `guest-${Date.now()}`, guest: true });
        }

        // ── Reuse only a row the caller has proven a claim to ────────────────
        // A participant link is a capability for one *study*, not an identity: a
        // study-wide link says nothing about which candidate is holding it, so
        // matching a row by the free-text email under one let any link holder
        // claim — and reset — whichever candidate's row they could name, and read
        // that row's state back through the 409 below. Three things can prove the
        // claim instead:
        //
        //   • the signed-in account naming its own address,
        //   • the study's own stored config naming that candidate, or
        //   • an assignment signed into the link itself.
        //
        // The last is what a per-candidate link carries (`generate-link` embeds
        // it, and the token is signed), which is the difference between "my
        // invitation" and "someone else's".
        //
        // An unproven email gets no reuse and no state disclosure: it falls
        // through to the create below, which is what already happens for an
        // address no assignment mentions. Refusing to match is the point — the
        // row it would have matched belongs to someone else.
        const assignmentEmail = normalizeEmail(studyConfig?.interviewerAssignment?.candidateEmail);
        const linkAssignmentEmail = normalizeEmail(participantAuth.assignment?.candidateEmail);
        const viaStudyLink = participantAuth.valid && participantAuth.studyId === studyId;
        const namesAssignment =
            Boolean(assignmentEmail) && assignmentEmail === normalizedCandidateEmail;
        const namesLinkAssignment =
            Boolean(linkAssignmentEmail) && linkAssignmentEmail === normalizedCandidateEmail;
        const identityProven =
            namesSelf || (viaStudyLink && (namesAssignment || namesLinkAssignment));

        if (studyId && normalizedCandidateEmail && identityProven) {
            const existingSession = await supabaseDb.interviewSession.findFirst({
                where: {
                    studyId,
                    candidateEmail: normalizedCandidateEmail,
                },
            });

            if (existingSession?.completedAt || existingSession?.mode === 'terminated' || existingSession?.mode === 'rejected') {
                return NextResponse.json(
                    {
                        error: existingSession.mode === 'terminated'
                            ? 'This interview was terminated and cannot be rejoined.'
                            : existingSession.mode === 'rejected'
                                ? 'This interview was rejected by the candidate and cannot be started.'
                                : 'This interview has already been completed.',
                    },
                    { status: 409 }
                );
            }

            if (existingSession) {
                if (existingSession.mode === 'assigned') {
                    // Best-effort atomic claim: re-read row inside a tight window to
                    // detect a concurrent claim. Not a true SERIALIZABLE transaction
                    // (would need a DB-side constraint), but it closes most of the race.
                    const recheck = await supabaseDb.interviewSession.findUnique({
                        where: { id: existingSession.id },
                    });

                    // If another tab has already flipped it out of 'assigned', reuse the row.
                    if (!recheck || recheck.mode !== 'assigned') {
                        return NextResponse.json({ sessionId: existingSession.id, guest: false, reused: true });
                    }

                    const session = await supabaseDb.interviewSession.update({
                        where: { id: existingSession.id },
                        data: {
                            userId,
                            role,
                            difficulty,
                            mode,
                            startedAt: new Date(),
                            ...(candidateName && { candidateName }),
                            candidateEmail: normalizedCandidateEmail,
                        },
                    });

                    return NextResponse.json({ sessionId: session.id, guest: false, reused: true });
                }

                return NextResponse.json({ sessionId: existingSession.id, guest: false, reused: true });
            }
        }

        const session = await supabaseDb.interviewSession.create({
            data: {
                userId,
                role,
                difficulty,
                mode,
                startedAt: new Date(),
                averageScore: 0,
                // Interviewer-linked fields (optional)
                ...(studyId && { studyId }),
                ...(candidateName && { candidateName }),
                ...(normalizedCandidateEmail && { candidateEmail: normalizedCandidateEmail }),
            },
        });

        return NextResponse.json({ sessionId: session.id, guest: false });
    } catch (error) {
        console.error('Session start error:', error);
        return NextResponse.json({ sessionId: `fallback-${Date.now()}`, guest: true });
    }
}
