// ============================================
// POST /api/measurement/calibrate
// Feature 1 — Competency Measurement Engine
//
// Re-fits item parameters (a, b, c) from accumulated response history and retires
// items that cannot measure anything.
//
// Admin-only, and deliberately an explicit action rather than something on a
// schedule: the estimator loads the response history into memory (the Supabase
// wrapper filters in application code), so it should run when an operator asks
// for it, not on a request path.
//
// Body (all optional):
//   itemKeys       limit calibration to specific items (a single-item re-fit)
//   minSampleSize  override the minimum responses required to fit an item
//
// Safe to run repeatedly. Calibration only writes ItemParameter rows; it never
// touches a candidate's stored scores, and it never deletes a retired item's
// response history.
// ============================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminAuth';
import { assertTrustedOrigin } from '@/lib/csrf';
import { calibrateItemBank } from '@/lib/measurement/calibration';
import { MIN_SAMPLE_SIZE } from '@/lib/measurement/calibrationMath';

export const dynamic = 'force-dynamic';

const CalibrateRequestSchema = z.object({
    itemKeys: z.array(z.string().min(1)).max(500).optional(),
    minSampleSize: z.number().int().min(2).max(10_000).optional(),
});

// Admin-only, but still CSRF-able, and the fix is the same one line. The body is
// read with `request.text()` and an empty one is accepted (`{}` = calibrate the
// whole bank), so a cross-site form POST with no fields makes it all the way
// through — no preflight to refuse it, and the admin's own SameSite=None cookie
// attached. Admin rights raise the stakes here rather than lowering them: this
// rewrites item parameters that every candidate's score depends on.
export async function POST(request: Request) {
    const csrfError = assertTrustedOrigin(request);
    if (csrfError) return csrfError;

    const denied = await requireAdmin();
    if (denied) return denied;

    let body: unknown = {};
    try {
        const text = await request.text();
        body = text ? JSON.parse(text) : {};
    } catch {
        return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }

    const parsed = CalibrateRequestSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            {
                error: 'Invalid calibration request',
                details: parsed.error.issues.map((issue) => ({
                    path: issue.path.join('.'),
                    message: issue.message,
                })),
            },
            { status: 400 }
        );
    }

    try {
        const summary = await calibrateItemBank({
            itemKeys: parsed.data.itemKeys,
            minSampleSize: parsed.data.minSampleSize,
        });

        // An empty bank is a normal early state, not a failure — surfaced with an
        // explanation so an admin knows why nothing was calibrated.
        const note =
            summary.itemsConsidered === 0
                ? 'No item has any response history yet. Calibration needs answered sessions.'
                : summary.itemsSkipped > 0
                  ? `${summary.itemsSkipped} item(s) had fewer than ${summary.minSampleSize} responses and kept their previous parameters.`
                  : undefined;

        return NextResponse.json({
            success: true,
            summary,
            minimumSampleSize: MIN_SAMPLE_SIZE,
            note,
        });
    } catch (error) {
        console.error('[measurement/calibrate] failed:', error);
        return NextResponse.json({ error: 'Calibration failed' }, { status: 500 });
    }
}
