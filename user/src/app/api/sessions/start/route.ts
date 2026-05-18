// POST /api/sessions/start — Create a new InterviewSession in the DB
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';
import supabaseDb from '@/lib/supabaseDb';
import { getParticipantRequestContext } from '@/lib/researcherContext';
import { getAuthUser } from '@/lib/accessControl';

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
        if (studyId) {
            const isCandidateAssigned = Boolean(authUser?.id && authUser.role === 'candidate' && candidateEmail);
            if (!participantAuth.valid && !isCandidateAssigned) {
                return NextResponse.json({ error: 'Valid participant link required for this study' }, { status: 401 });
            }

            if (participantAuth.valid && participantAuth.studyId === studyId && candidateEmail) {
                const study = await supabaseDb.study.findFirst({
                    where: { id: studyId },
                    select: { configJSON: true },
                });

                if (study?.configJSON) {
                    const config = JSON.parse(study.configJSON);
                    const assigned = config.interviewerAssignment;
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
                ...(candidateEmail && { candidateEmail }),
            },
        });

        return NextResponse.json({ sessionId: session.id, guest: false });
    } catch (error) {
        console.error('Session start error:', error);
        return NextResponse.json({ sessionId: `fallback-${Date.now()}`, guest: true });
    }
}
