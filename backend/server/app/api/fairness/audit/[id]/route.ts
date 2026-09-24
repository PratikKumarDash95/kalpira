// GET /api/fairness/audit/[id] — one run: its cohort metrics, its flags, and its report
//
// Admin-only, matching the run route. The report is assembled here rather than left to the
// PDF route so the console renders the same object the PDF prints — one assembly, three
// renderings, no chance of the console and the document disagreeing about what was found.
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { presentRun, readAuditRun, reportForRun } from '@/lib/fairness/fairnessService';

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authError = await requireAdmin();
    if (authError) return authError;

    try {
        const { id: runId } = await params;

        const detail = await readAuditRun(runId);
        if (!detail) {
            return NextResponse.json({ error: 'No such audit run.' }, { status: 404 });
        }

        // Null when the run has no study to describe — a run whose study was deleted is
        // still readable, because the record of an audit that happened is itself the point.
        const report = await reportForRun(runId);

        return NextResponse.json({
            run: presentRun(detail.run),
            metrics: detail.metrics,
            flags: detail.flags,
            report,
        });
    } catch (error) {
        console.error('[fairness/audit/[id]] read failed:', error);
        return NextResponse.json({ error: 'The audit run could not be read.' }, { status: 500 });
    }
}
