// ============================================
// complianceReport.ts — assembling the report
// Feature 4 — Fairness, Bias & Compliance Audit
// ============================================
//
// Turns a stored audit run into the document a compliance reader receives. Pure: it takes
// rows and returns a structure, so verify-fairness can assert what it says without a
// database, and so the PDF renderer and any future HTML or text renderer produce the same
// content from the same source.
//
// THE DISCLAIMERS ARE PART OF THE STRUCTURE, NOT OF THE TEMPLATE
//
// The most comfortable lie a report like this can tell is by omission — printing "NYC
// Local Law 144" in a heading and letting a reader conclude the audit satisfies it, when
// the statute requires an INDEPENDENT auditor and this audit was produced by the vendor
// about itself. So the disclaimers are assembled here, beside the citations they belong to,
// and every renderer draws them because they are in the data it was handed. A renderer
// cannot drop them without dropping the citation too.
//
// WHAT THE REPORT DOES NOT DO
//
// It does not conclude. There is no verdict field, no compliance status, no pass or fail.
// It reports what was measured, what could not be measured, what was left out, and what
// the numbers cannot say — and then stops, because the step after that is a person's.

import {
    BASE_CAVEATS,
    CLAUSE_CITATIONS,
    FAIRNESS_REGISTRY_VERSION,
    FOUR_FIFTHS_EXPLANATION,
    type ClauseCitation,
} from './contract';

export interface ComplianceReportInput {
    run: Record<string, any>;
    metrics: Array<Record<string, any>>;
    flags: Array<Record<string, any>>;
    /** The study's name, for the header. Falls back to the id. */
    studyName?: string | null;
    /** Who or what produced the score — the model, not the vendor. */
    systemDescription?: string | null;
    generatedAt: Date;
}

export interface ReportCohortRow {
    cohortValue: string;
    label: string;
    n: number;
    scoredN: number;
    /** Null when the study declares no cutoff, in which case the column reads "not computed". */
    selectedCount: number | null;
    selectionRate: string;
    referenceRate: string;
    adverseImpactRatio: string;
    zStatistic: string;
    pValue: string;
    chiSquare: string;
    effectSize: string;
    /** Set when no rate could be computed, in which case every figure above is "not computed". */
    notComputableReason: string | null;
    isReference: boolean;
}

export interface ReportCohortSection {
    cohortKey: string;
    cohortLabel: string;
    /** Why this key's reference cohort was chosen. Printed above the table. */
    referenceReason: string;
    referenceValue: string | null;
    rows: ReportCohortRow[];
}

export interface ReportFlag {
    severity: string;
    targetType: string;
    label: string | null;
    cohortValue: string | null;
    finding: string;
    whatItCannotSay: string;
    recommendation: string | null;
    statistic: string;
    threshold: string;
    pValue: string;
    computable: boolean;
    notComputableReason: string | null;
}

export interface ReportBlock {
    kind: 'title' | 'subtitle' | 'heading' | 'paragraph' | 'table' | 'bullets' | 'note' | 'spacer';
    text?: string;
    /** For 'table': the header row first, then body rows. */
    rows?: string[][];
    /** Column widths, as fractions, for a renderer that wants them. */
    widths?: number[];
    items?: string[];
}

export interface ComplianceReport {
    title: string;
    subtitle: string;
    generatedAt: string;
    studyName: string;
    /**
     * Which scoring system produced the scores this report examines, or null when the run's
     * decisions do not record one. Named on the document because a bias audit is an audit
     * *of something*: a report that does not say what it examined cannot be relied on by a
     * reader who arrives after the configuration has changed.
     */
    systemDescription: string | null;
    registryVersion: number;
    status: string;
    /** The run's error, when it did not succeed. */
    error: string | null;
    selectionThreshold: number | null;
    sampleSize: number;
    includedSessions: number;
    sections: ReportCohortSection[];
    flags: ReportFlag[];
    exclusions: Array<{ reason: string; count: number }>;
    caveats: string[];
    citations: ClauseCitation[];
    disclaimers: string[];
    fourFifthsExplanation: string;
    methodology: string[];
}

function text(value: unknown): string {
    return value === null || value === undefined ? '' : String(value);
}

function num(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function fixed(value: unknown, places = 2): string {
    const parsed = num(value);
    return parsed === null ? 'not computed' : parsed.toFixed(places);
}

function percent(value: unknown): string {
    const parsed = num(value);
    return parsed === null ? 'not computed' : `${(parsed * 100).toFixed(1)}%`;
}

function pValue(value: unknown): string {
    const parsed = num(value);
    if (parsed === null) return 'not computed';
    return parsed < 0.0001 ? '<0.0001' : parsed.toFixed(4);
}

/**
 * A count that may not exist at all.
 *
 * `n` and `scoredN` are counts of candidates that are simply there, so they are printed
 * with `String`. A selected count is different: a study that declares no cutoff has no bar
 * for anyone to clear, so the number does not exist rather than being zero. The cell still
 * has to say something, "0" is the one answer that is certainly wrong, and the report's
 * existing phrase for an absent figure keeps the column reading consistently.
 */
function count(value: number | null): string {
    return value === null ? 'not computed' : String(value);
}

/**
 * The statements that make the report safe to read.
 *
 * Assembled rather than templated, and asserted non-empty by verify-fairness: a report
 * that cites a statute without stating the limits of its own claim is worse than no report,
 * because it invites a reader to rely on it.
 */
export function reportDisclaimers(): string[] {
    return [
        ...CLAUSE_CITATIONS.map((citation) => `${citation.instrument}, ${citation.clause}: ${citation.doesNotClaim}`),
        'This report describes the behaviour of a scoring system on one study\'s data. It is not legal advice, and no part of it should be read as a determination that any process is or is not lawful.',
        'A statistical association between a declared cohort and a score is not a finding of discrimination. Nothing in this report establishes intent, causation, or liability.',
        'Cohorts in this report were declared by the study and assigned by an interviewer. Kalpira does not collect, infer or store protected attributes, and no figure here describes one.',
    ];
}

/**
 * How the numbers were produced.
 *
 * Stated on the report because a reader cannot weigh a statistic whose definition they do
 * not know — and because two of these choices (two-tailed z, Yates-corrected chi-square)
 * make the flags harder to raise, which is a fact the reader is entitled to.
 */
export function reportMethodology(): string[] {
    return [
        'Selection: a candidate is counted as selected when their mean score across all their verified answers is at or above the study\'s declared cutoff.',
        'A candidate\'s score is the mean over their answers, and each answer\'s score is the mean over the five scored dimensions. Only answers whose scores trace to a recorded model decision are counted.',
        'Adverse impact ratio: the cohort\'s selection rate divided by the reference cohort\'s.',
        'Significance: a two-tailed two-proportion z-test with a pooled proportion, reported at alpha = 0.05. Two-tailed because a cohort may be advantaged as well as disadvantaged, and choosing the direction in advance would be choosing the result.',
        'Chi-square: Pearson\'s statistic for the 2x2 table with Yates\' continuity correction, reported only where every expected cell count is at least 5. The correction makes the statistic more conservative.',
        'Effect size: Cohen\'s d using the pooled standard deviation.',
        'Refusals: a cohort with fewer than 5 scored answers, or fewer than half its candidates scored, produces no rate at all rather than a caveated one. A ratio against a reference cohort that selected nobody is not formed.',
    ];
}

/** The citation list, with each entry's own disclaimer carried alongside it. */
export function reportCitations(): ClauseCitation[] {
    return [...CLAUSE_CITATIONS];
}

/**
 * Builds the report from a stored run.
 *
 * A run that FAILED produces a report that says so, with no figures — because the one
 * thing this document must never do is present an empty audit as a clean one.
 */
export function buildComplianceReport(input: ComplianceReportInput): ComplianceReport {
    const { run, metrics, flags } = input;
    const status = text(run.status) || 'unknown';
    const summary = (run.summaryJSON && typeof run.summaryJSON === 'object' ? run.summaryJSON : {}) as Record<string, any>;
    const referenceByKey = (summary.referenceByKey && typeof summary.referenceByKey === 'object'
        ? summary.referenceByKey
        : {}) as Record<string, { value?: string; reason?: string }>;

    const caveats = Array.isArray(run.caveatsJSON) ? run.caveatsJSON.map((entry: unknown) => text(entry)) : [...BASE_CAVEATS];
    const exclusions: Array<{ reason: string; count: number }> = Array.isArray(run.excludedJSON)
        ? run.excludedJSON.map((entry: any) => ({ reason: text(entry?.reason), count: Number(entry?.count ?? 0) }))
        : [];

    const declaration = (run.cohortDeclarationJSON && typeof run.cohortDeclarationJSON === 'object'
        ? run.cohortDeclarationJSON
        : {}) as Record<string, any>;
    const declaredKeys: Array<{ key: string; label: string; values: string[] }> = Array.isArray(declaration.cohortKeys)
        ? declaration.cohortKeys.map((entry: any) => ({
              key: text(entry?.key),
              label: text(entry?.label) || text(entry?.key),
              values: Array.isArray(entry?.values) ? entry.values.map((value: unknown) => text(value)) : [],
          }))
        : [];

    // Group the stored metrics by cohort key, in the order the study declared them.
    const byKey = new Map<string, Array<Record<string, any>>>();
    for (const metric of metrics) {
        const key = text(metric.cohortKey);
        const list = byKey.get(key) ?? [];
        list.push(metric);
        byKey.set(key, list);
    }

    const sections: ReportCohortSection[] = [];
    const orderedKeys = declaredKeys.length > 0
        ? declaredKeys
        : [...byKey.keys()].map((key) => ({ key, label: key, values: [] }));

    for (const declared of orderedKeys) {
        const rows = byKey.get(declared.key) ?? [];
        if (rows.length === 0) continue;

        const referenceValue = referenceByKey[declared.key]?.value ?? null;
        sections.push({
            cohortKey: declared.key,
            cohortLabel: declared.label,
            referenceValue,
            referenceReason:
                text(referenceByKey[declared.key]?.reason) ||
                'The reference cohort for this key was not recorded on the run.',
            rows: rows.map((metric) => {
                const value = text(metric.cohortValue);
                const computable = metric.computable === true;
                return {
                    cohortValue: value,
                    label: `${declared.label}: ${value}`,
                    n: Number(metric.n ?? 0),
                    scoredN: Number(metric.scoredN ?? 0),
                    // Not `?? 0`: a study with no cutoff has no selected count, and a row
                    // reading "Selected 0" beside a "not computed" rate is exactly the
                    // fabricated measurement this report must not carry.
                    selectedCount: num(metric.selectedCount),
                    selectionRate: computable ? percent(metric.selectionRate) : 'not computed',
                    referenceRate: computable ? percent(metric.referenceRate) : 'not computed',
                    adverseImpactRatio: computable ? fixed(metric.adverseImpactRatio) : 'not computed',
                    zStatistic: computable ? fixed(metric.zStatistic) : 'not computed',
                    pValue: computable ? pValue(metric.pValue) : 'not computed',
                    chiSquare: computable ? fixed(metric.chiSquare) : 'not computed',
                    effectSize: computable ? fixed(metric.effectSize) : 'not computed',
                    notComputableReason: computable ? null : text(metric.notComputableReason) || 'not computable',
                    isReference: referenceValue !== null && value === referenceValue,
                };
            }),
        });
    }

    const reportFlags: ReportFlag[] = flags.map((flag) => ({
        severity: text(flag.severity) || 'info',
        targetType: text(flag.targetType),
        label: flag.label ? text(flag.label) : null,
        cohortValue: flag.cohortValue ? text(flag.cohortValue) : null,
        finding: text(flag.finding),
        whatItCannotSay: text(flag.whatItCannotSay),
        recommendation: flag.recommendation ? text(flag.recommendation) : null,
        statistic: fixed(flag.statistic, 3),
        threshold: fixed(flag.threshold, 3),
        pValue: pValue(flag.pValue),
        computable: flag.computable !== false,
        notComputableReason: flag.notComputableReason ? text(flag.notComputableReason) : null,
    }));

    return {
        title: 'Fairness & Bias Audit',
        subtitle: 'Adverse-impact analysis of AI-assisted interview scoring',
        generatedAt: input.generatedAt.toISOString(),
        studyName: input.studyName ? text(input.studyName) : text(run.studyId),
        // Read from the decision log by the caller, never from the study's current
        // configuration: the configuration says what the study is set to NOW, and the log
        // says what actually scored each answer. Naming the configured model could name one
        // that never saw the data.
        //
        // Trimmed, and whitespace-only becomes null. Untrimmed, a description of spaces
        // survives `|| null` as a truthy value and the report prints a blank after the
        // label — a field that reads as answered while saying nothing, which is the exact
        // failure this whole feature is built to refuse.
        systemDescription: text(input.systemDescription).trim() || null,
        registryVersion: Number(run.registryVersion ?? FAIRNESS_REGISTRY_VERSION),
        status,
        error: run.error ? text(run.error) : null,
        selectionThreshold: num(run.selectionThreshold),
        sampleSize: Number(run.sampleSize ?? 0),
        includedSessions: Number(run.includedSessions ?? 0),
        sections,
        flags: reportFlags,
        exclusions,
        caveats,
        citations: reportCitations(),
        disclaimers: reportDisclaimers(),
        fourFifthsExplanation: FOUR_FIFTHS_EXPLANATION,
        methodology: reportMethodology(),
    };
}

/**
 * Flattens the report into renderable blocks.
 *
 * The PDF renderer (and anything else that draws this) consumes these rather than reaching
 * into the structure, so a renderer cannot accidentally omit the caveats or the
 * disclaimers: they are blocks like any other, generated here.
 */
export function reportBlocks(report: ComplianceReport): ReportBlock[] {
    const blocks: ReportBlock[] = [];

    blocks.push({ kind: 'title', text: report.title });
    blocks.push({ kind: 'subtitle', text: report.subtitle });
    blocks.push({
        kind: 'paragraph',
        text: `Study: ${report.studyName}  ·  Generated: ${report.generatedAt}  ·  Run status: ${report.status}  ·  Registry version: ${report.registryVersion}`,
    });
    // Emitted for every run status, because it describes what produced the scores rather
    // than what the analysis found. "Not recorded" is printed rather than omitted: on a
    // compliance document, an absent field and a field that says the value is unknown are
    // different claims, and only the second is true here.
    blocks.push({
        kind: 'paragraph',
        text: report.systemDescription
            ? `Scoring system: ${report.systemDescription}`
            : 'Scoring system: not recorded for this run.',
    });
    blocks.push({ kind: 'spacer' });

    if (report.status !== 'succeeded') {
        blocks.push({ kind: 'heading', text: 'This audit did not produce figures' });
        if (report.error) {
            blocks.push({ kind: 'paragraph', text: `The run did not complete: ${report.error}` });
        }
        // The safety sentence is emitted whether or not there is an error to print. A
        // failed run has no findings for the same reason an empty one does not, and a
        // reader who takes either for a clean bill of health has been misled by the
        // document's silence rather than by anything it said.
        blocks.push({
            kind: 'paragraph',
            text:
                'No cohort figures are reported. The absence of findings below is not a finding of fairness, and nothing in this report should be read as one.',
        });
        blocks.push({ kind: 'spacer' });
    }

    blocks.push({ kind: 'heading', text: 'What this report is' });
    if (report.status !== 'succeeded') {
        // Deliberately NOT the "an analysis of N interviews" sentence: this run produced no
        // figures, so describing what was analysed would assert an analysis that did not
        // happen. The counts are reported as what the run covered, not as what it found.
        blocks.push({
            kind: 'paragraph',
            text: `A record of an audit run on this study that did not complete successfully. It was to cover ${report.sampleSize} interview${report.sampleSize === 1 ? '' : 's'} grouped by cohorts the study declared. No cohort figures were produced.`,
        });
    } else {
        blocks.push({
            kind: 'paragraph',
            text:
                `An analysis of ${report.includedSessions} scored interview${report.includedSessions === 1 ? '' : 's'} in this study, out of ${report.sampleSize} considered, grouped by cohorts the study declared. ` +
                (report.selectionThreshold === null
                    ? 'The study declares no selection cutoff, so no candidate could be counted as selected and no selection rate exists. The distribution figures below are still reported.'
                    : `A candidate counts as selected at a score of ${report.selectionThreshold} or above.`),
        });
        blocks.push({ kind: 'paragraph', text: report.fourFifthsExplanation });
    }
    blocks.push({ kind: 'spacer' });

    blocks.push({ kind: 'heading', text: 'Cohort figures' });
    for (const section of report.sections) {
        blocks.push({ kind: 'subtitle', text: section.cohortLabel });
        blocks.push({ kind: 'note', text: section.referenceReason });
        blocks.push({
            kind: 'table',
            rows: [
                ['Cohort', 'Candidates', 'Scored', 'Selected', 'Rate', 'Reference rate', 'Ratio', 'z', 'p', 'chi-square (Yates)', "Cohen's d"],
                ...section.rows.map((row) => [
                    row.isReference ? `${row.cohortValue} (reference)` : row.cohortValue,
                    String(row.n),
                    String(row.scoredN),
                    count(row.selectedCount),
                    row.selectionRate,
                    row.referenceRate,
                    row.adverseImpactRatio,
                    row.zStatistic,
                    row.pValue,
                    row.chiSquare,
                    row.effectSize,
                ]),
            ],
            widths: [0.2, 0.08, 0.07, 0.08, 0.07, 0.1, 0.07, 0.07, 0.08, 0.09, 0.09],
        });
        for (const row of section.rows) {
            if (row.notComputableReason) {
                blocks.push({ kind: 'note', text: `${row.label}: no figures — ${row.notComputableReason}` });
            }
        }
    }
    if (report.sections.length === 0) {
        blocks.push({ kind: 'paragraph', text: 'No cohort figures were computed for this run.' });
    }
    blocks.push({ kind: 'spacer' });

    blocks.push({ kind: 'heading', text: `Findings (${report.flags.length})` });
    if (report.flags.length === 0) {
        blocks.push({
            kind: 'paragraph',
            text:
                'No flag was raised. This means no statistic crossed its reporting line on this data at this sample size. It is not a finding that the process is fair: the tests can only detect gaps large enough for the sample to show, and the caveats below say what could not be examined.',
        });
    }
    for (const flag of report.flags) {
        blocks.push({ kind: 'subtitle', text: `${flag.severity.toUpperCase()} · ${flag.targetType}${flag.cohortValue ? ` · ${flag.cohortValue}` : ''}` });
        blocks.push({ kind: 'paragraph', text: flag.finding });
        if (!flag.computable && flag.notComputableReason) {
            blocks.push({ kind: 'note', text: `Could not be computed: ${flag.notComputableReason}` });
        } else {
            blocks.push({
                kind: 'note',
                text: `Measured ${flag.statistic} against a line of ${flag.threshold}${flag.pValue !== 'not computed' ? `, p = ${flag.pValue}` : ''}.`,
            });
        }
        blocks.push({ kind: 'note', text: `What this cannot say: ${flag.whatItCannotSay}` });
        if (flag.recommendation) blocks.push({ kind: 'note', text: `Suggested next step: ${flag.recommendation}` });
    }
    blocks.push({ kind: 'spacer' });

    if (report.exclusions.length > 0) {
        blocks.push({ kind: 'heading', text: 'What was left out, and why' });
        blocks.push({
            kind: 'paragraph',
            text: 'These sessions were considered and excluded. An audit is only as good as what it says it does not cover.',
        });
        blocks.push({ kind: 'bullets', items: report.exclusions.map((entry) => `${entry.count} — ${entry.reason}`) });
        blocks.push({ kind: 'spacer' });
    }

    blocks.push({ kind: 'heading', text: 'How these numbers were produced' });
    blocks.push({ kind: 'bullets', items: report.methodology });
    blocks.push({ kind: 'spacer' });

    blocks.push({ kind: 'heading', text: 'Caveats' });
    blocks.push({ kind: 'bullets', items: report.caveats });
    blocks.push({ kind: 'spacer' });

    blocks.push({ kind: 'heading', text: 'Clauses cited, and what this report does not claim' });
    for (const citation of report.citations) {
        blocks.push({ kind: 'subtitle', text: `${citation.instrument} — ${citation.clause}` });
        blocks.push({ kind: 'note', text: `Cited for: ${citation.citedFor}` });
        blocks.push({ kind: 'note', text: `The duty: ${citation.duty}` });
        blocks.push({ kind: 'paragraph', text: `What this report does not claim: ${citation.doesNotClaim}` });
    }
    blocks.push({ kind: 'spacer' });

    blocks.push({ kind: 'heading', text: 'Disclaimers' });
    blocks.push({ kind: 'bullets', items: report.disclaimers });

    return blocks;
}

/** A plain-text rendering, for a log line, an e-mail, or a test. */
export function reportToText(report: ComplianceReport): string {
    const lines: string[] = [];
    for (const block of reportBlocks(report)) {
        switch (block.kind) {
            case 'title':
                lines.push(text(block.text).toUpperCase(), '='.repeat(text(block.text).length));
                break;
            case 'subtitle':
                lines.push('', text(block.text));
                break;
            case 'heading':
                lines.push('', `-- ${text(block.text)} ${'-'.repeat(Math.max(0, 46 - text(block.text).length))}`);
                break;
            case 'spacer':
                lines.push('');
                break;
            case 'bullets':
                for (const item of block.items ?? []) lines.push(`  · ${item}`);
                break;
            case 'table': {
                const rows = block.rows ?? [];
                for (const row of rows) lines.push(`  ${row.join(' | ')}`);
                break;
            }
            case 'note':
                lines.push(`  (${text(block.text)})`);
                break;
            default:
                lines.push(text(block.text));
        }
    }
    return lines.join('\n');
}
