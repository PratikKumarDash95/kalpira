// GET /api/interviewer/studies/[id]/candidates
// Returns all InterviewSessions linked to this study with scores and candidate info
// NOTE: Uses (prisma as any) casts because the Prisma client needs regeneration
// after the schema migration. Restart the dev server to fix type errors.
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import prisma from '@/lib/prisma';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const db = prisma as any;

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
    } catch { return null; }
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
    const interviewerId = await getInterviewerId();
    if (!interviewerId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Verify the study belongs to this interviewer
        const study = await db.study.findFirst({
            where: { id: params.id, userId: interviewerId },
        });

        if (!study) {
            return NextResponse.json({ error: 'Study not found' }, { status: 404 });
        }

        const sessions = await db.interviewSession.findMany({
            where: { studyId: params.id },
            orderBy: { startedAt: 'desc' },
            include: {
                scoreBreakdown: true,
                questions: {
                    include: { responses: true },
                    orderBy: { createdAt: 'asc' },
                },
            },
        });

        const candidates = sessions.map((sess: any) => ({
            sessionId: sess.id,
            candidateName: sess.candidateName || 'Anonymous',
            candidateEmail: sess.candidateEmail || '',
            startedAt: sess.startedAt,
            completedAt: sess.completedAt,
            averageScore: sess.averageScore,
            scoreBreakdown: sess.scoreBreakdown ? {
                overallScore: sess.scoreBreakdown.overallScore,
                technicalAverage: sess.scoreBreakdown.technicalAverage,
                communicationAverage: sess.scoreBreakdown.communicationAverage,
                confidenceAverage: sess.scoreBreakdown.confidenceAverage,
                logicAverage: sess.scoreBreakdown.logicAverage,
                depthAverage: sess.scoreBreakdown.depthAverage,
            } : null,
            questionCount: sess.questions.length,
            qaItems: sess.questions.map((q: any) => ({
                question: q.text,
                answer: q.responses[0]?.answerText || '',
                feedback: q.responses[0]?.feedback || '',
                scores: {
                    technical: q.responses[0]?.technicalScore || 0,
                    communication: q.responses[0]?.communicationScore || 0,
                    confidence: q.responses[0]?.confidenceScore || 0,
                    logic: q.responses[0]?.logicScore || 0,
                    depth: q.responses[0]?.depthScore || 0,
                },
            })),
        }));

        return NextResponse.json({
            study: { id: study.id, config: JSON.parse(study.configJSON) },
            candidates,
        });
    } catch (error) {
        console.error('Error fetching candidates:', error);
        return NextResponse.json({ error: 'Failed to fetch candidates' }, { status: 500 });
    }
}
