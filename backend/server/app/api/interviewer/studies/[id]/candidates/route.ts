// GET /api/interviewer/studies/[id]/candidates
// Returns all InterviewSessions linked to this study with scores and candidate info
// NOTE: Uses (supabaseDb as any) casts because the Supabase client needs regeneration
// after the schema migration. Restart the dev server to fix type errors.
import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { isInterviewClosed } from '@/lib/interviewDeadline';
import { excludeSelfPreviewSessions } from '@/lib/previewSession';
import { getInterviewerId } from '@/lib/interviewerAuth';

export const dynamic = 'force-dynamic';

const db = supabaseDb as any;

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

        const config = JSON.parse(study.configJSON);
        if (isInterviewClosed(config)) {
            const pendingAssignments = await db.interviewSession.findMany({
                where: { studyId: params.id, mode: 'assigned', completedAt: null },
            });
            await Promise.all(pendingAssignments.map((session: any) =>
                db.interviewSession.update({
                    where: { id: session.id },
                    data: { mode: 'absent' },
                })
            ));
        }

        // Ownership already verified above via the study.findFirst check.
        // Note: do NOT add a nested `study: { userId }` filter here — the DB shim
        // can't resolve that relation on raw session rows and would drop every row.
        const sessions = await db.interviewSession.findMany({
            where: {
                studyId: params.id,
            },
            orderBy: { startedAt: 'desc' },
            include: {
                scoreBreakdown: true,
                questions: {
                    include: { responses: true },
                    orderBy: { createdAt: 'asc' },
                },
            },
        });

        // Drop the interviewer's own self-preview / self-practice runs — they are
        // the interviewer testing their own interview, not real candidate results.
        const realSessions = excludeSelfPreviewSessions(sessions);

        const candidates = realSessions.map((sess: any) => ({
            sessionId: sess.id,
            candidateName: sess.candidateName || 'Anonymous',
            candidateEmail: sess.candidateEmail || '',
            status: sess.mode === 'rejected' ? 'rejected' : sess.mode === 'absent' ? 'absent' : sess.completedAt ? 'completed' : 'incomplete',
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
            study: { id: study.id, config },
            candidates,
        });
    } catch (error) {
        console.error('Error fetching candidates:', error);
        return NextResponse.json({ error: 'Failed to fetch candidates' }, { status: 500 });
    }
}
