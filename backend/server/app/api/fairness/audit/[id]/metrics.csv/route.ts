// GET /api/fairness/audit/[id]/metrics.csv — the numbers, as a file
//
// Rendered from the same assembled report the JSON and the PDF use. That is deliberate:
// a CSV is the copy that gets pasted into a deck or a spreadsheet, where the surrounding
// page is gone and the figures travel alone. If it were built from the raw rows instead,
// it could disagree with the document it was downloaded from — and the version without
// the caveats is the one that would end up in the meeting.
//
// The figures are therefore emitted as the report's own formatted strings, not as parsed
// numbers. "not computed" has to be able to appear in a numeric column, and a spreadsheet
// that reads a refusal as 0 is the exact failure this feature exists to prevent.
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { reportForRun } from '@/lib/fairness/fairnessService';

export const dynamic = 'force-dynamic';

function escapeCsv(value: unknown): string {
    if (value === null || value === undefined) return '';
    const text = String(value);
    const escaped = text.replace(/"/g, '""');
    return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

function row(cells: unknown[]): string {
    return cells.map(escapeCsv).join(',');
}

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

        const lines: string[] = [];

        // ── Masthead ─────────────────────────────────────────────────────────
        lines.push(row(['Fairness audit — cohort metrics']));
        lines.push(row(['Study', report.studyName]));
        lines.push(row(['Run', runId]));
        lines.push(row(['Run status', report.status]));
        lines.push(row(['Generated', report.generatedAt]));
        lines.push(row(['Registry version', report.registryVersion]));
        lines.push(row(['Scoring system', report.systemDescription ?? 'not recorded for this run']));
        lines.push(
            row([
                'Selection cutoff',
                report.selectionThreshold === null
                    ? 'none declared — no candidate could be counted as selected'
                    : report.selectionThreshold,
            ])
        );
        lines.push(row(['Interviews considered', report.sampleSize]));
        lines.push(row(['Interviews included', report.includedSessions]));
        lines.push('');

        // ── The status line, before any figure ───────────────────────────────
        // First, because a reader who sorts or filters this file will still see it, and
        // because a failed or empty run must not be able to look like a clean one.
        if (report.status !== 'succeeded') {
            lines.push(row(['THIS RUN DID NOT PRODUCE FIGURES']));
            if (report.error) lines.push(row(['Error', report.error]));
            lines.push(
                row([
                    'The absence of findings in this file is not a finding of fairness, and nothing in it should be read as one.',
                ])
            );
            lines.push('');
        }

        // ── Cohort figures ───────────────────────────────────────────────────
        for (const section of report.sections) {
            lines.push(row([section.cohortLabel]));
            lines.push(row(['Reference cohort', section.referenceValue ?? 'not established']));
            lines.push(row(['Why', section.referenceReason]));
            lines.push(
                row([
                    'Cohort',
                    'Candidates',
                    'Scored',
                    'Selected',
                    'Selection rate',
                    'Reference rate',
                    'Adverse impact ratio',
                    'z',
                    'p',
                    'Chi-square (Yates)',
                    "Cohen's d",
                    'Not computable because',
                ])
            );
            for (const entry of section.rows) {
                lines.push(
                    row([
                        entry.isReference ? `${entry.cohortValue} (reference)` : entry.cohortValue,
                        entry.n,
                        entry.scoredN,
                        entry.selectedCount,
                        entry.selectionRate,
                        entry.referenceRate,
                        entry.adverseImpactRatio,
                        entry.zStatistic,
                        entry.pValue,
                        entry.chiSquare,
                        entry.effectSize,
                        entry.notComputableReason ?? '',
                    ])
                );
            }
            lines.push('');
        }
        if (report.sections.length === 0) {
            lines.push(row(['No cohort figures were computed for this run.']));
            lines.push('');
        }

        // ── Findings ─────────────────────────────────────────────────────────
        lines.push(row([`Findings (${report.flags.length})`]));
        if (report.flags.length === 0) {
            lines.push(
                row([
                    'No flag was raised. This means no statistic crossed its reporting line on this data at this sample size. It is not a finding that the process is fair.',
                ])
            );
        } else {
            lines.push(
                row([
                    'Severity',
                    'Applies to',
                    'Label',
                    'Cohort',
                    'Finding',
                    'What it cannot say',
                    'Recommendation',
                    'Statistic',
                    'Threshold',
                    'p',
                    'Not computable because',
                ])
            );
            for (const flag of report.flags) {
                lines.push(
                    row([
                        flag.severity,
                        flag.targetType,
                        flag.label ?? '',
                        flag.cohortValue ?? '',
                        flag.finding,
                        flag.whatItCannotSay,
                        flag.recommendation ?? '',
                        flag.statistic,
                        flag.threshold,
                        flag.pValue,
                        flag.notComputableReason ?? '',
                    ])
                );
            }
        }
        lines.push('');

        // ── Exclusions and caveats ───────────────────────────────────────────
        // Carried in full. These are the rows that explain why a cohort is missing or a
        // figure was refused, and without them the file reads as though every cohort in
        // the study were represented.
        if (report.exclusions.length) {
            lines.push(row(['Excluded from this run']));
            for (const exclusion of report.exclusions) {
                lines.push(row([exclusion.reason, exclusion.count]));
            }
            lines.push('');
        }
        if (report.caveats.length) {
            lines.push(row(['Caveats']));
            for (const caveat of report.caveats) lines.push(row([caveat]));
            lines.push('');
        }
        lines.push(row(['How these numbers were produced']));
        for (const item of report.methodology) lines.push(row([item]));
        lines.push('');
        lines.push(row(['What this file does not claim']));
        for (const disclaimer of report.disclaimers) lines.push(row([disclaimer]));

        const csv = lines.join('\r\n');

        return new Response(csv, {
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="fairness-audit-${runId}.csv"`,
                // Belt and braces with the admin guard: a downloaded report must never be
                // stored by a shared cache.
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        console.error('[fairness/audit/[id]/metrics.csv] render failed:', error);
        return NextResponse.json({ error: 'The metrics could not be exported.' }, { status: 500 });
    }
}
