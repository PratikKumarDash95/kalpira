// POST /api/sessions/start — Create a new InterviewSession in the DB
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';
import prisma from '@/lib/prisma';

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

        // Resolve effective user ID for persistence
        if (!userId) {
            if (studyId) {
                const study = await prisma.study.findUnique({ where: { id: studyId } });
                if (study?.userId) {
                    userId = study.userId;
                }
            }

            // Fallback: Use the first admin/user found (for standalone mode)
            if (!userId) {
                const defaultUser = await prisma.user.findFirst();
                if (defaultUser) {
                    userId = defaultUser.id;
                }
            }
        }

        // Only default to transient guest session if absolutely no user context exists
        if (!userId) {
            return NextResponse.json({ sessionId: `guest-${Date.now()}`, guest: true });
        }

        const session = await prisma.interviewSession.create({
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
