// ============================================
// GET  /api/delivery/jobs  — analysis job health
// POST /api/delivery/jobs  — retry the jobs that failed
// Feature 2 — Multimodal Delivery Analysis
//
// This is the endpoint the job table exists for. Without it, an analysis that
// failed is a line in a server log that nobody reads, and the affected answer is
// quietly missing its delivery evidence with no way to tell why or to fix it.
//
// WHY THIS IS ADMIN-ONLY
// A failed job is an operational fault, and retrying one spends work on a
// candidate's behalf. Neither belongs to the candidate, and neither is something
// they can act on.
//
// WHAT "FAILED" MEANS HERE
// A job fails when the analysis could not run — usually because the response it
// belongs to was deleted, or because a payload was malformed beyond what the
// tolerant parser repairs. It does NOT fail when a metric could not be measured:
// a muted microphone is a successful analysis that measured nothing, and it is
// recorded as such. Keeping those two apart is the whole point of the retry surface
// — one is a bug worth fixing, the other is a fact about the recording.
// ============================================

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import supabaseDb from '@/lib/supabaseDb';
import { MAX_ATTEMPTS, JOB_KIND, retryPendingDeliveryJobs } from '@/lib/delivery/deliveryService';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const denied = await requireAdmin();
    if (denied) return denied;

    try {
        const limit = Math.min(
            200,
            Math.max(1, Number(new URL(request.url).searchParams.get('limit') ?? 50) || 50)
        );

        const jobs = await supabaseDb.analysisJob.findMany({
            where: { kind: JOB_KIND },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });

        const rows = jobs as Record<string, any>[];
        const counts = rows.reduce<Record<string, number>>((accumulator, job) => {
            const status = String(job.status ?? 'unknown');
            accumulator[status] = (accumulator[status] ?? 0) + 1;
            return accumulator;
        }, {});

        const failed = rows
            .filter((job) => job.status === 'failed')
            .map((job) => ({
                id: String(job.id),
                responseId: job.responseId ?? null,
                sessionId: job.sessionId ?? null,
                attempts: Number(job.attempts ?? 0),
                maxAttempts: Number(job.maxAttempts ?? MAX_ATTEMPTS),
                lastError: job.lastError ?? null,
                createdAt: job.createdAt ?? null,
                // Only a job that still holds its payload can be re-run; one that
                // has been retried to exhaustion is listed so the fault is visible
                // rather than quietly swept.
                retryable:
                    Number(job.attempts ?? 0) < Number(job.maxAttempts ?? MAX_ATTEMPTS) &&
                    Boolean(job.payload),
            }));

        return NextResponse.json({
            success: true,
            counts,
            failed,
            returned: rows.length,
            maxAttempts: MAX_ATTEMPTS,
        });
    } catch (error) {
        console.error('[delivery/jobs] Failed to read job health:', error);
        return NextResponse.json({ error: 'Could not read analysis jobs' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const denied = await requireAdmin();
    if (denied) return denied;

    try {
        const body = await request.json().catch(() => ({}));
        const limit = Math.min(50, Math.max(1, Number(body?.limit ?? 10) || 10));

        const outcomes = await retryPendingDeliveryJobs(limit);

        return NextResponse.json({
            success: true,
            attempted: outcomes.length,
            succeeded: outcomes.filter((outcome) => outcome.status === 'succeeded').length,
            failed: outcomes.filter((outcome) => outcome.status === 'failed').length,
            outcomes: outcomes.map((outcome) => ({
                jobId: outcome.jobId,
                status: outcome.status,
                error: outcome.error,
                skippedReason: outcome.skippedReason,
            })),
        });
    } catch (error) {
        console.error('[delivery/jobs] Retry sweep failed:', error);
        return NextResponse.json({ error: 'Could not retry analysis jobs' }, { status: 500 });
    }
}
