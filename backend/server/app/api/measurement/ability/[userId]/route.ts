// ============================================
// GET /api/measurement/ability/:userId
// Feature 1 — Competency Measurement Engine
//
// Returns a candidate's measured ability profile: per-competency ability with its
// standard error, confidence interval, prerequisite discounts, and the ordered
// list of what to work on next.
//
// Read-only. It returns the estimates written by the last recomputation rather
// than recomputing on the fly, so a GET never writes to the database. To refresh
// the estimates, POST /api/measurement/recompute.
//
// Authorisation: the candidate themselves, or an admin.
// ============================================

import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/accessControl';
import { getAbilityHistory, getAbilityProfile } from '@/lib/measurement/abilityService';

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    context: { params: Record<string, string> }
) {
    const authUser = await getAuthUser();
    if (!authUser) {
        return NextResponse.json({ error: 'Login required' }, { status: 401 });
    }

    const userId = context.params?.userId;
    if (!userId) {
        return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const isSelf = authUser.id === userId;
    const isAdmin = authUser.role === 'admin';
    if (!isSelf && !isAdmin) {
        return NextResponse.json(
            { error: 'You can only view your own ability profile' },
            { status: 403 }
        );
    }

    const { searchParams } = new URL(request.url);
    const includeHistory = searchParams.get('history') === 'true';
    const competencyId = searchParams.get('competencyId') || undefined;

    const historyLimitRaw = Number(searchParams.get('historyLimit'));
    const historyLimit =
        Number.isFinite(historyLimitRaw) && historyLimitRaw > 0
            ? Math.min(500, Math.floor(historyLimitRaw))
            : 100;

    try {
        const profile = await getAbilityProfile(userId);

        // Nothing measured yet is a normal state for a new candidate, not an
        // error — it is reported as such so the UI can explain what unlocks it.
        const response: Record<string, unknown> = {
            profile,
            hasMeasurements: profile.measuredCount > 0,
        };

        if (includeHistory) {
            response.history = await getAbilityHistory(userId, { competencyId, limit: historyLimit });
        }

        return NextResponse.json(response);
    } catch (error) {
        console.error('[measurement/ability] failed:', error);
        return NextResponse.json({ error: 'Failed to load ability profile' }, { status: 500 });
    }
}
