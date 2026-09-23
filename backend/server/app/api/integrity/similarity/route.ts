// ============================================
// GET  /api/integrity/similarity?studyId=…  — read a study's near-duplicate pairs
// POST /api/integrity/similarity             — compare a study's answers
// Feature 3 — Integrity & Authenticity Suite
// ============================================
//
// Similarity is the one layer that is not about a session. A leaked answer circulated
// to five candidates is one finding spanning five sessions, and it can only be found
// by comparing a study's answers against each other. So this is a study-scoped route
// rather than a session-scoped one, and only the study's owner or an admin may use it.
//
// WHY NOT GLOBALLY
//
// Two candidates in unrelated studies answering "tell me about yourself" will share
// phrasing by necessity. Comparing across studies would flag that, at scale, and the
// result would be a false positive on a mass of honest people. Similarity here means
// similar to someone who was asked the same questions.
//
// WHY GET IS NOT A CHEAP CALL
//
// It reads a study's stored pairs, which can be a large list for a big cohort, so it
// is bounded by `limit` and returns the strongest pairs first — the ones a reviewer
// would look at anyway. The route is `force-dynamic` because the pairs change as the
// POST runs.
//
// THE POST IS EXPENSIVE AND THAT IS DISCLOSED
//
// Comparing a study is quadratic in its candidate count, so this is not something a
// page load should trigger. It is an explicit action, and the response says how many
// answers were compared, how many were too short to compare, and that every figure is
// an estimate rather than an exact computation.
// ============================================

import { NextResponse } from 'next/server';
import { resolveStudyAccess } from '@/lib/integrity/guards';
import supabaseDb from '@/lib/supabaseDb';
import { SIMILARITY_THRESHOLD, runStudySimilarity } from '@/lib/integrity/integrityService';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export async function GET(request: Request) {
    try {
        const studyId = new URL(request.url).searchParams.get('studyId');
        if (!studyId) {
            return NextResponse.json({ error: 'studyId is required' }, { status: 400 });
        }

        const access = await resolveStudyAccess(studyId);
        if (access.state === 'denied') return access.response;

        const limit = Math.min(
            MAX_LIMIT,
            Math.max(1, Number(new URL(request.url).searchParams.get('limit') ?? DEFAULT_LIMIT) || DEFAULT_LIMIT)
        );

        const rows = (await supabaseDb.answerSimilarity.findMany({
            where: { studyId },
            orderBy: { similarity: 'desc' },
            take: limit,
        })) as Record<string, any>[];

        // Grouped by cluster, because that is the unit a reviewer acts on: six answers
        // in one group is one finding about a circulated answer, not fifteen pairwise
        // findings about six people.
        const clusters = new Map<string, { responseIds: Set<string>; strongest: number }>();
        for (const row of rows) {
            const clusterId = row.clusterId ? String(row.clusterId) : null;
            if (!clusterId) continue;
            const entry = clusters.get(clusterId) ?? { responseIds: new Set<string>(), strongest: 0 };
            entry.responseIds.add(String(row.responseAId));
            entry.responseIds.add(String(row.responseBId));
            entry.strongest = Math.max(entry.strongest, Number(row.similarity ?? 0));
            clusters.set(clusterId, entry);
        }

        return NextResponse.json({
            success: true,
            studyId,
            threshold: SIMILARITY_THRESHOLD,
            pairsReturned: rows.length,
            pairs: rows.map((row) => ({
                responseAId: String(row.responseAId),
                responseBId: String(row.responseBId),
                similarity: Number(row.similarity ?? 0),
                clusterId: row.clusterId ? String(row.clusterId) : null,
                shingleSize: Number(row.shingleSize ?? 5),
            })),
            clusters: [...clusters.entries()].map(([clusterId, entry]) => ({
                clusterId,
                responseIds: [...entry.responseIds],
                size: entry.responseIds.size,
                strongestSimilarity: entry.strongest,
            })),
            approximate: true,
        });
    } catch (error) {
        console.error('[integrity/similarity] Could not read similarity:', error);
        return NextResponse.json({ error: 'Could not read similarity' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const studyId = typeof body?.studyId === 'string' ? body.studyId : null;
        if (!studyId) {
            return NextResponse.json({ error: 'studyId is required' }, { status: 400 });
        }

        const access = await resolveStudyAccess(studyId);
        if (access.state === 'denied') return access.response;

        const outcome = await runStudySimilarity(studyId);

        return NextResponse.json({
            success: true,
            studyId,
            threshold: SIMILARITY_THRESHOLD,
            considered: outcome.considered,
            skippedTooShort: outcome.skippedTooShort,
            pairs: outcome.pairs.length,
            clusters: new Set(outcome.pairs.map((pair) => pair.clusterId).filter(Boolean)).size,
            stored: outcome.stored,
            approximate: true,
            caveats: outcome.caveats,
        });
    } catch (error) {
        console.error('[integrity/similarity] Could not compare the study:', error);
        return NextResponse.json({ error: 'Could not compare the study' }, { status: 500 });
    }
}
