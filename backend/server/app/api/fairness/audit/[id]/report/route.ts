// GET /api/fairness/audit/[id]/report — the compliance report as a PDF
//
// Admin-only, like every other read of an audit run. This is the document that gets filed
// and forwarded, so it is also the one that must never be reachable by someone who merely
// holds the URL.
//
// The bytes come from `renderReportPdf()`, which walks the same block list the JSON read and
// the CSV export are built from. Three renderings, one assembly — a PDF that disagreed with
// the JSON about what a run found would mean one of them is a false record of an audit, and
// the copy that gets filed is usually the PDF.
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { reportForRun } from '@/lib/fairness/fairnessService';
import { renderReportPdf } from '@/lib/fairness/reportPdf';

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authError = await requireAdmin();
    if (authError) return authError;

    try {
        const { id: runId } = await params;

        const report = await reportForRun(runId);
        if (!report) {
            return NextResponse.json({ error: 'No such audit run.' }, { status: 404 });
        }

        const pdf = await renderReportPdf(report);

        return new Response(Buffer.from(pdf), {
            headers: {
                'Content-Type': 'application/pdf',
                // The run id names the file, so two downloads of the same run collide in a
                // downloads folder instead of each claiming to be "report (3).pdf".
                'Content-Disposition': `attachment; filename="fairness-audit-${runId}.pdf"`,
                'Content-Length': String(pdf.byteLength),
                // Belt and braces with the admin guard: a downloaded compliance report must
                // never be served from, or stored by, a shared cache.
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        // A failure here serves a JSON error rather than a truncated or empty PDF. A file
        // that opens to nothing looks like a report with no findings, and this feature
        // exists precisely so that "we found nothing" and "we produced nothing" cannot be
        // confused for one another.
        console.error('[fairness/audit/[id]/report] render failed:', error);
        return NextResponse.json({ error: 'The report could not be generated.' }, { status: 500 });
    }
}
