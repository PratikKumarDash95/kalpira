// ============================================
// GET /api/measurement/items
// Feature 1 — Competency Measurement Engine
//
// The calibrated item bank: every item the engine has fitted parameters for, with
// the evidence behind each one. Admin-only, because item parameters are the
// answer key of a measurement instrument — they are not candidate-facing.
//
// WHY AN ADMIN NEEDS THIS
// Calibration is a FITTING process, and a fit can be wrong. An item with
// discrimination near zero measures nothing; one with a guessing parameter near
// the ceiling is answerable without knowledge; one fitted from the bare minimum
// of responses is still moving. None of that is visible from the calibrate
// endpoint's summary counts, so the bank is inspectable item by item and each row
// carries whether it is trustworthy.
//
// WHAT IS NOT IN THIS TABLE
// Only *fitted* items appear here — a row is written when an item reaches the
// sample-size floor, so every row has at least that many responses behind it.
// Items that have been answered but not yet fitted are therefore not listed, and
// cannot be counted from here: `resolveItemParametersForText` falls back to
// difficulty defaults without writing a row. Reporting an "awaiting fit" count
// would mean reporting a number that is always zero, so this endpoint does not
// pretend to know it.
//
// Query params:
//   retired=true|false   filter to retired or live items only
//   limit                cap the number of rows returned (default 200, max 1000)
// ============================================

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import supabaseDb from '@/lib/supabaseDb';
import {
    MAX_GUESSING,
    MIN_DISCRIMINATION,
    MIN_SAMPLE_SIZE,
    RETIREMENT_DISCRIMINATION,
} from '@/lib/measurement/calibrationMath';
import { itemLabel } from '@/lib/measurement/itemIdentity';

export const dynamic = 'force-dynamic';

/** Below this many responses a fit is directionally useful but not yet settled. */
const THIN_SAMPLE = MIN_SAMPLE_SIZE * 2;

export async function GET(request: Request) {
    const denied = await requireAdmin();
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const retiredParam = searchParams.get('retired');
    const limitRaw = Number(searchParams.get('limit'));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(1000, Math.floor(limitRaw)) : 200;

    try {
        const rows = await supabaseDb.itemParameter.findMany({
            orderBy: { sampleSize: 'desc' },
        });

        const filtered = rows.filter((row: any) => {
            if (retiredParam === null) return true;
            return Boolean(row.isRetired) === (retiredParam === 'true');
        });

        const items = filtered.slice(0, limit).map((row: any) => {
            const sampleSize = Number(row.sampleSize) || 0;
            const a = Number(row.a);
            const c = Number(row.c);

            // Why this row might not be usable, in the order an operator should
            // care about it. An item can be retired *and* thin; retirement is the
            // decision that matters, so it is reported first.
            const concerns: string[] = [];
            if (row.isRetired) concerns.push(row.retiredReason || 'retired');
            if (sampleSize < THIN_SAMPLE) concerns.push('sample still small');
            if (!row.isRetired && Number.isFinite(a) && a < MIN_DISCRIMINATION) {
                concerns.push('discrimination below the usable floor');
            }
            if (!row.isRetired && Number.isFinite(a) && a < RETIREMENT_DISCRIMINATION) {
                concerns.push('measures almost nothing — a retirement candidate');
            }
            if (Number.isFinite(c) && c >= MAX_GUESSING) {
                concerns.push('guessable without knowledge');
            }

            return {
                itemKey: row.itemKey,
                label: itemLabel(row.sampleText || ''),
                sampleText: row.sampleText || '',
                competencyId: row.competencyId ?? null,
                category: row.category ?? null,
                a: Number.isFinite(a) ? a : null,
                b: Number.isFinite(Number(row.b)) ? Number(row.b) : null,
                c: Number.isFinite(c) ? c : null,
                sampleSize,
                proportionCorrect:
                    row.proportionCorrect === null || row.proportionCorrect === undefined
                        ? null
                        : Number(row.proportionCorrect),
                isRetired: Boolean(row.isRetired),
                retiredReason: row.retiredReason ?? null,
                calibratedAt: row.calibratedAt ? new Date(row.calibratedAt).toISOString() : null,
                concerns,
                usable: concerns.length === 0,
            };
        });

        const all = rows as any[];
        const live = all.filter((row) => !row.isRetired);

        return NextResponse.json({
            items,
            // The numbers an operator needs before deciding whether to re-fit:
            // how big the bank is, how much of it is usable, and how much of it is
            // still on a thin sample that a few more answers could move.
            totals: {
                items: all.length,
                live: live.length,
                retired: all.length - live.length,
                thinSamples: live.filter((row) => (Number(row.sampleSize) || 0) < THIN_SAMPLE).length,
                withConcerns: all.filter((row) => {
                    if (row.isRetired) return true;
                    if ((Number(row.sampleSize) || 0) < THIN_SAMPLE) return true;
                    const a = Number(row.a);
                    return Number.isFinite(a) && a < MIN_DISCRIMINATION;
                }).length,
            },
            thresholds: {
                minSampleSize: MIN_SAMPLE_SIZE,
                thinSample: THIN_SAMPLE,
                minDiscrimination: MIN_DISCRIMINATION,
                retirementDiscrimination: RETIREMENT_DISCRIMINATION,
                maxGuessing: MAX_GUESSING,
            },
            returned: items.length,
            truncated: filtered.length > items.length,
        });
    } catch (error) {
        console.error('[measurement/items] failed:', error);
        return NextResponse.json({ error: 'Failed to load the item bank' }, { status: 500 });
    }
}
