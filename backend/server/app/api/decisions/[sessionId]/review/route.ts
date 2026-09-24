// POST /api/decisions/[sessionId]/review — ask a human to look at this scoring
//
// The human-review path. Guarded by `resolveSessionAccess`, so the candidate can ask about
// their own session (and the study's owner or an admin can file on their behalf).
//
// WHAT THIS ROUTE MUST NOT DO
//
// It must not change anything. Not a score, not a session status, not a flag on the
// candidate. The non-negotiable for this product is that nothing auto-rejects a candidate,
// and the mirror of that is that nothing auto-corrects one either: a review request entered
// here creates a record that a person asked, and a person answers. Nothing in this file
// writes to "Response", "ScoreBreakdown", "InterviewSession" or the decision log.
//
// It is deliberately append-only in effect. A candidate may file once per interview (the
// table's partial unique index enforces the same thing at the database level), and filing
// twice returns the request that already exists rather than an error — a double tap is not
// a failure the candidate should have to interpret.
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import supabaseDb from '@/lib/supabaseDb';
import { assertTrustedOrigin } from '@/lib/csrf';
import { resolveSessionAccess } from '@/lib/sessionAccess';

export const dynamic = 'force-dynamic';

/** Bounded so a candidate cannot store a document in a field meant for a sentence. */
const MAX_REASON_LENGTH = 2000;

export async function POST(
    request: Request,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    const csrfError = assertTrustedOrigin(request);
    if (csrfError) return csrfError;

    try {
        const { sessionId } = await params;

        const access = await resolveSessionAccess(request, sessionId);
        if (access.state === 'denied') return access.response;

        const body = await request.json().catch(() => ({}));

        // Trimmed, then length-checked, then converted to null when empty. An empty string
        // is a stored non-answer, and the table's CHECK refuses one — so the conversion
        // happens here rather than being left to a constraint violation.
        const rawReason = typeof body?.reason === 'string' ? body.reason.trim() : '';
        if (rawReason.length > MAX_REASON_LENGTH) {
            return NextResponse.json(
                { error: `Please keep your reason under ${MAX_REASON_LENGTH} characters.` },
                { status: 400 }
            );
        }
        const reason = rawReason || null;

        // Optional: a specific answer. Accepted only when it actually belongs to this
        // session, so a review request cannot be pointed at another candidate's answer by
        // supplying its id.
        let responseId: string | null = null;
        if (typeof body?.responseId === 'string' && body.responseId.trim()) {
            const candidate = body.responseId.trim();
            const owned = await supabaseDb.response.findFirst({
                where: { id: candidate, sessionId },
            });
            if (!owned) {
                return NextResponse.json(
                    { error: 'That answer is not part of this interview.' },
                    { status: 400 }
                );
            }
            responseId = candidate;
        }

        // Already asked? Return the existing request. This is the idempotency the partial
        // unique index would otherwise enforce by throwing.
        const existing = (await supabaseDb.reviewRequest.findMany({
            where: { sessionId, status: { in: ['open', 'in_review'] } },
        })) as Array<Record<string, any>>;
        if (existing.length > 0) {
            const open = existing.find((row) => String(row.status) === 'open') ?? existing[0];
            return NextResponse.json({
                success: true,
                alreadyRequested: true,
                reviewRequest: {
                    id: String(open.id),
                    status: String(open.status),
                    reason: open.reason ?? null,
                    requestedAt: open.requestedAt ?? null,
                },
            });
        }

        await supabaseDb.reviewRequest.create({
            data: {
                id: randomUUID(),
                sessionId,
                // Taken from the session rather than from the request body: the caller does
                // not get to say which study their request belongs to, or which candidate it
                // is about.
                studyId: access.studyId,
                userId: access.ownerId,
                responseId,
                reason,
                status: 'open',
                requestedAt: new Date(),
                // `resolvedAt`, `resolvedBy` and `assignedTo` are left unset, as the table's
                // resolution CHECK requires for a non-terminal status. Nobody has answered
                // this yet, so nothing here claims anyone has.
            },
        });

        return NextResponse.json({
            success: true,
            alreadyRequested: false,
            reviewRequest: { sessionId, status: 'open', reason, requestedAt: new Date().toISOString() },
            // Said explicitly, because the candidate's first question is whether asking
            // costs them anything. It does not, and the response states so rather than
            // leaving the UI to reassure them on the server's behalf.
            scoresUnchanged: true,
        });
    } catch (error) {
        console.error('[decisions/[sessionId]/review] write failed:', error);
        return NextResponse.json(
            { error: 'Your review request could not be saved. Please try again.' },
            { status: 500 }
        );
    }
}
