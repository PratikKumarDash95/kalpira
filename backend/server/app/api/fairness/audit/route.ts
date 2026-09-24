// POST /api/fairness/audit — run one audit for one study
// GET  /api/fairness/audit — a study's audit history
//
// Admin-only, which is not a formality. A run reads every session in a study and every
// scored answer in it, then stores per-cohort selection rates on the result. The
// interviewer's per-study view gets the thin summary instead (`/api/fairness/summary`),
// because a per-cohort breakdown of a study's candidates is not something to put in front
// of everyone who can see that study.
import { NextResponse } from 'next/server';
import { getAdminUser, requireAdmin } from '@/lib/adminAuth';
import { assertTrustedOrigin } from '@/lib/csrf';
import { listAuditRuns, presentRun, readAuditRun, runAudit } from '@/lib/fairness/fairnessService';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const csrfError = assertTrustedOrigin(request);
    if (csrfError) return csrfError;

    const authError = await requireAdmin();
    if (authError) return authError;

    try {
        const body = await request.json().catch(() => ({}));
        const studyId = typeof body?.studyId === 'string' ? body.studyId.trim() : '';
        if (!studyId) {
            return NextResponse.json({ error: 'A studyId is required.' }, { status: 400 });
        }

        const admin = await getAdminUser();
        // Recorded, never used to widen what is read. `runAudit` reads the study's own
        // rows regardless of who asked.
        const result = await runAudit({ studyId, actorId: admin?.id ?? null });

        // The run row is returned alongside the result so the console can render the
        // figures without a second round trip. A run that failed still has a row, and its
        // detail is returned too — the caller sees the failure, not an empty success.
        const detail = result.runId ? await readAuditRun(result.runId) : null;

        return NextResponse.json({
            ...result,
            detail: detail
                ? { run: presentRun(detail.run), metrics: detail.metrics, flags: detail.flags }
                : null,
        });
    } catch (error) {
        console.error('[fairness/audit] run failed:', error);
        // Not a "no findings" response. A run that could not be performed and a run that
        // found nothing are different facts, and this one is an error.
        return NextResponse.json({ error: 'The audit could not be run.' }, { status: 500 });
    }
}

export async function GET(request: Request) {
    const authError = await requireAdmin();
    if (authError) return authError;

    try {
        const studyId = new URL(request.url).searchParams.get('studyId')?.trim() ?? '';
        if (!studyId) {
            return NextResponse.json({ error: 'A studyId is required.' }, { status: 400 });
        }

        const runs = await listAuditRuns(studyId);
        return NextResponse.json({ studyId, runs: runs.map(presentRun) });
    } catch (error) {
        console.error('[fairness/audit] history failed:', error);
        return NextResponse.json({ error: 'The audit history could not be read.' }, { status: 500 });
    }
}
