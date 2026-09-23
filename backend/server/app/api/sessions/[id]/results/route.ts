// GET /api/sessions/[id]/results — Return full session data for results page
import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { resolveSessionAccess } from '@/lib/sessionAccess';

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: sessionId } = await params;

        if (sessionId.startsWith('guest-') || sessionId.startsWith('fallback-')) {
            return NextResponse.json({ error: 'Guest session — no DB data' }, { status: 404 });
        }

        // ── Who may read these results ───────────────────────────────────────
        // This route had NO authorization at all: anyone holding a session id got
        // the candidate's verbatim answers, all five scores, the AI feedback and
        // the ideal answers. Session ids are UUIDv4 so they cannot be guessed, but
        // they travel — in the address bar of a page the candidate is told to
        // share, in browser history on a shared machine, in a proxy log.
        //
        // No participant link is accepted here, deliberately. The link flow ends at
        // synthesis and export and never reaches this page; `VideoInterview`
        // navigates to `/dashboard` on completion. The only navigations to
        // `/results/:id` come from `CandidateDashboard` and `allinterviews`, both of
        // which are signed-in screens. A link would also grant read on every session
        // in its study, which is broader than "your own results".
        const access = await resolveSessionAccess(request, sessionId);
        if (access.state === 'denied') return access.response;

        const session = await supabaseDb.interviewSession.findUnique({
            where: { id: sessionId },
            include: {
                scoreBreakdown: true,
                questions: {
                    include: {
                        responses: true,
                    },
                    orderBy: { createdAt: 'asc' },
                },
            },
        });

        if (!session) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        }

        // Build structured results
        const qaItems = session.questions.map((q: any) => {
            const r = q.responses[0]; // One response per question
            return {
                question: q.text,
                category: q.category,
                difficulty: q.difficulty,
                answer: r?.answerText || '',
                scores: {
                    technical: r?.technicalScore || 0,
                    communication: r?.communicationScore || 0,
                    confidence: r?.confidenceScore || 0,
                    logic: r?.logicScore || 0,
                    depth: r?.depthScore || 0,
                },
                feedback: r?.feedback || '',
                idealAnswer: r?.idealAnswer || '',
                improvementTip: r?.improvementTip || '',
            };
        });

        return NextResponse.json({
            sessionId: session.id,
            role: session.role,
            difficulty: session.difficulty,
            mode: session.mode,
            startedAt: session.startedAt,
            completedAt: session.completedAt,
            overallScore: session.scoreBreakdown?.overallScore || session.averageScore,
            scoreBreakdown: session.scoreBreakdown
                ? {
                    technical: session.scoreBreakdown.technicalAverage,
                    communication: session.scoreBreakdown.communicationAverage,
                    confidence: session.scoreBreakdown.confidenceAverage,
                    logic: session.scoreBreakdown.logicAverage,
                    depth: session.scoreBreakdown.depthAverage,
                }
                : null,
            qaItems,
        });
    } catch (error) {
        console.error('Results fetch error:', error);
        return NextResponse.json({ error: 'Failed to fetch results' }, { status: 500 });
    }
}
