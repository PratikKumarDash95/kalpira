// POST /api/sessions/start — Create a new InterviewSession in the DB
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';
import supabaseDb from '@/lib/supabaseDb';
import { getParticipantRequestContext } from '@/lib/researcherContext';

export const dynamic = 'force-dynamic';

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

        const participantAuth = await getParticipantRequestContext(request);
        if (studyId) {
            if (!participantAuth.valid || !participantAuth.context || participantAuth.studyId !== studyId) {
                return NextResponse.json({ error: 'Valid participant link required for this study' }, { status: 401 });
            }
            userId = participantAuth.context.userId;
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
