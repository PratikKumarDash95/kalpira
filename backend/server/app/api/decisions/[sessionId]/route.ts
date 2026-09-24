// GET /api/decisions/[sessionId] — "how your score was decided"
//
// The candidate's own view of the provenance the decision log holds: for each answer, which
// model scored it, under which prompt version, what it returned, and whether the scores on
// the response could be traced back to that decision. Guarded by `resolveSessionAccess`, so
// it is the candidate, the study's owner, or an admin — and a refusal is the same 404
// whether the session does not exist or simply is not theirs, so it cannot be used to
// enumerate sessions.
//
// WHAT THIS RETURNS, AND WHAT IT MUST NOT
//
// Every field below is provenance ABOUT the scoring: model, provider, prompt version, a
// hash of the input, the scores, and the verification outcome. None of it is another
// candidate's content, and none of it is the raw model output — the stored output is
// already reduced to counts and lengths at write time (see `redactOutput`), precisely so
// that a table built for audit does not become a second copy of the interview.
//
// The `inputHash` is returned rather than the input. It lets a candidate (or their
// representative) confirm that the decision was made on a specific set of messages, by
// hashing them and comparing — without this route handing back a transcript that the
// candidate already has and nobody else in this flow needs.
import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { resolveSessionAccess } from '@/lib/sessionAccess';
import { sessionDecisions } from '@/lib/fairness/decisionLog';

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;

        const access = await resolveSessionAccess(request, sessionId);
        if (access.state === 'denied') return access.response;

        const decisions = await sessionDecisions(sessionId);

        // The live review request, if there is one. Read here rather than in a second call
        // because the page's whole purpose is to answer "was this decided about me, and can
        // I do anything about it" — and a page that renders the first half while the second
        // is still loading invites a candidate to press a button they already pressed.
        //
        // `{ in: [...] }` is one of the operators this shim resolves in memory rather than
        // in SQL, so it is correct here but not free; it is bounded by the unique index that
        // allows at most one live request per session.
        const live = (await supabaseDb.reviewRequest.findMany({
            where: { sessionId, status: { in: ['open', 'in_review'] } },
        })) as Array<Record<string, any>>;

        // 'open' is preferred over 'in_review' because it is the earlier state: a session
        // can only hold one of the two at a time, but if that ever changed, showing the
        // earlier one is the more conservative reading. Named `liveRequest` rather than
        // `request`, which is the HTTP request in this scope.
        const liveRequest = live.find((row) => String(row.status) === 'open') ?? live[0] ?? null;

        return NextResponse.json({
            sessionId,
            decisions,
            // Null when the candidate has not asked. The page shows the action when this is
            // null and the state of the request when it is not — it never guesses.
            reviewRequest: liveRequest
                ? {
                      id: String(liveRequest.id),
                      status: String(liveRequest.status),
                      reason: liveRequest.reason ?? null,
                      requestedAt: liveRequest.requestedAt ?? null,
                      assignedTo: liveRequest.assignedTo ?? null,
                      resolvedAt: liveRequest.resolvedAt ?? null,
                      // The reviewer's prose, shown to the candidate once it exists. This is
                      // the only field a human writes into this table, and it is written to
                      // be read by them.
                      resolutionNote: liveRequest.resolutionNote ?? null,
                  }
                : null,
            // The candidate's own standing, so the page can say plainly that asking changes
            // nothing about it. Stated by the server rather than assumed by the frontend.
            scoresUnchangedByRequest: true,
        });
    } catch (error) {
        console.error('[decisions/[sessionId]] read failed:', error);
        return NextResponse.json({ error: 'The decision record could not be read.' }, { status: 500 });
    }
}
