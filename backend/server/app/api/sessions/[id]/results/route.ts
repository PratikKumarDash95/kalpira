// GET /api/sessions/[id]/results — Return full session data for results page
import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { resolveSessionAccess } from '@/lib/sessionAccess';
import { isMeasuredResponse, readScoreSet } from '@/lib/fairness/decisionLog';

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
            // Feature 4: a not-measured answer reports null for every dimension, never 0 —
            // and says which it is, so a reader can tell "the model scored this zero" from
            // "nothing scored this". Null twice over: `?? null` because the columns are
            // nullable now, and a deliberate absence of the substitution that used to
            // turn them into zeroes.
            const measured = isMeasuredResponse(r);
            const read = measured ? readScoreSet(r) : null;
            const scores = read && read.state === 'measured' ? read.scores : null;

            return {
                // Feature 4: the answer's id, so the "how your score was decided" view can
                // join each question to the model decision that scored it. Without it the
                // candidate's provenance page could only list opaque ids.
                responseId: r?.id ?? null,
                question: q.text,
                category: q.category,
                difficulty: q.difficulty,
                answer: r?.answerText || '',
                measured,
                scoreSource: r?.scoreSource ?? null,
                scores: {
                    technical: scores?.technicalScore ?? null,
                    communication: scores?.communicationScore ?? null,
                    confidence: scores?.confidenceScore ?? null,
                    logic: scores?.logicScore ?? null,
                    depth: scores?.depthScore ?? null,
                },
                feedback: r?.feedback || '',
                idealAnswer: r?.idealAnswer || '',
                improvementTip: r?.improvementTip || '',
            };
        });

        // Null, never 0, for a session with nothing measured. The old fallback here was
        // `breakdown?.overallScore || averageScore`, and `averageScore` is a `not null
        // default 0` column — so a session whose answers were never scored reported an
        // overallScore of exactly 0, which reads as "this candidate scored zero" rather
        // than "this candidate was not scored".
        const breakdown = session.scoreBreakdown ?? null;

        return NextResponse.json({
            sessionId: session.id,
            role: session.role,
            difficulty: session.difficulty,
            mode: session.mode,
            startedAt: session.startedAt,
            completedAt: session.completedAt,
            assessed: breakdown !== null,
            overallScore: breakdown ? breakdown.overallScore : null,
            scoreBreakdown: breakdown
                ? {
                    technical: breakdown.technicalAverage,
                    communication: breakdown.communicationAverage,
                    confidence: breakdown.confidenceAverage,
                    logic: breakdown.logicAverage,
                    depth: breakdown.depthAverage,
                }
                : null,
            qaItems,
        });
    } catch (error) {
        console.error('Results fetch error:', error);
        return NextResponse.json({ error: 'Failed to fetch results' }, { status: 500 });
    }
}
