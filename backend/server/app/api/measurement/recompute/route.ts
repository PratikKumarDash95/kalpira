// ============================================
// POST /api/measurement/recompute
// Feature 1 — Competency Measurement Engine
//
// Re-estimates a candidate's ability from their full response history and writes
// the result to AbilityEstimate (current state) and AbilityHistory (trajectory).
//
// This is the write half of the engine; GET /api/measurement/ability reads what
// this produces. Call it when a session completes — or any time scores have
// changed and the profile should catch up.
//
// Body (all optional):
//   userId     whose abilities to recompute. Defaults to the caller.
//              Only an admin may recompute another user.
//   sessionId  the session that triggered this, recorded on the history row so a
//              jump in ability can be traced to the sitting that caused it.
//
// Idempotent: recomputing with the same history produces the same estimates
// (the estimator is deterministic), so a double-submit is harmless.
// ============================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthUser } from '@/lib/accessControl';
import { recomputeUserAbilities } from '@/lib/measurement/abilityService';

export const dynamic = 'force-dynamic';

const RecomputeRequestSchema = z.object({
    userId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
});

export async function POST(request: Request) {
    const authUser = await getAuthUser();
    if (!authUser) {
        return NextResponse.json({ error: 'Login required' }, { status: 401 });
    }

    let body: unknown = {};
    try {
        const text = await request.text();
        body = text ? JSON.parse(text) : {};
    } catch {
        return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }

    const parsed = RecomputeRequestSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            {
                error: 'Invalid recompute request',
                details: parsed.error.issues.map((issue) => ({
                    path: issue.path.join('.'),
                    message: issue.message,
                })),
            },
            { status: 400 }
        );
    }

    const userId = parsed.data.userId ?? authUser.id;

    if (userId !== authUser.id && authUser.role !== 'admin') {
        return NextResponse.json(
            { error: 'You can only recompute your own abilities' },
            { status: 403 }
        );
    }

    try {
        const result = await recomputeUserAbilities(userId, { sessionId: parsed.data.sessionId });

        return NextResponse.json({
            success: true,
            updated: result.updated,
            imprecise: result.imprecise,
            // Responses we could not attribute to a competency (no category and no
            // explicit competencyId). Reported rather than silently dropped, because
            // a rising number here means the question generator is not tagging output.
            unattributedResponses: result.skippedResponses,
            profile: result.profile,
        });
    } catch (error) {
        console.error('[measurement/recompute] failed:', error);
        return NextResponse.json({ error: 'Failed to recompute abilities' }, { status: 500 });
    }
}
