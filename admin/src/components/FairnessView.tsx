'use client';

// ============================================
// FairnessView.tsx — fairness, bias & compliance audit (Feature 4)
// ============================================
//
// The operator's window onto one adverse-impact analysis of one study.
//
// THE ONE DISTINCTION THIS SCREEN EXISTS TO MAKE
//
// A cohort with a rate and a cohort without one look identical the moment either is
// rendered as a number. They are opposites:
//
//   · A RATE means the cohort cleared the floor: enough scored answers to compute a
//     selection rate, a ratio, a z and a chi-square, and to say how likely the gap is
//     under the null.
//
//   · NO RATE means it did not. Three candidates in a band will always produce a ratio
//     between 0 and 1 — a perfectly confident-looking figure computed from nothing. The
//     backend refuses to compute it and stores the reason it refused.
//
// So this screen never prints a substituted zero, a dash that could be read as one, or a
// bar of height nothing. A refused cohort says "not computed" and prints the reason. The
// same rule governs a failed run: it is not an empty result, and the panel for it says so
// rather than rendering zero flags as though zero were a finding.
//
// AND WHAT NO PART OF THIS SCREEN SAYS
//
// There is no verdict anywhere: no "biased", no "compliant", no pass. An adverse impact
// ratio is a screening statistic and four-fifths is a rule of thumb from US enforcement
// guidance, not a legal test. Every flag carries the sentence the backend requires it to
// carry — what it cannot say — and this view prints that sentence with the same weight as
// the finding. A statistic shown without its innocent explanation is an accusation.

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
    AlertTriangle, CheckCircle2, Download, FileText, FlaskConical, Info, Loader2,
    Scale, ShieldAlert, Users,
} from 'lucide-react';
import {
    AdminApi,
    type AdminStudy,
    type ComplianceReport,
    type FairnessAuditResult,
    type FairnessCohortMetric,
    type FairnessFlag,
    type FairnessRun,
} from '@/lib/adminApi';
import { StatCard, tableWrap, th } from '@/components/adminViews';
import { formatDateTime } from '@/components/adminShared';

// ─── Formatting: absent is never zero ───────────────────────────────────────
// Deliberately mirrors the server's own formatters, including the wording. A figure that
// was refused here and a figure that was refused in the PDF must say the same thing, or a
// reader comparing the two would think one of them had a value the other lacked.
const notComputed = 'not computed';

function pct(value: number | null): string {
    return value === null || !Number.isFinite(value) ? notComputed : `${(value * 100).toFixed(1)}%`;
}

function num(value: number | null, places = 2): string {
    return value === null || !Number.isFinite(value) ? notComputed : value.toFixed(places);
}

function pValue(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return notComputed;
    return value < 0.0001 ? '<0.0001' : value.toFixed(4);
}

const SEVERITY_BADGE: Record<string, string> = {
    high: 'badge-danger',
    medium: 'badge-warn',
    low: 'badge-brand',
    info: 'badge',
};

const STATUS_TONE: Record<string, { badge: string; label: string }> = {
    succeeded: { badge: 'badge-success', label: 'Completed' },
    // Not a success and not a failure: the run finished and there was nothing it could
    // compute. Rendered with its own wording so it cannot be skimmed as either.
    not_computable: { badge: 'badge-warn', label: 'Completed — nothing computable' },
    running: { badge: 'badge-brand', label: 'Running' },
    failed: { badge: 'badge-danger', label: 'Did not complete' },
};

export default function FairnessView({ studies }: { studies: AdminStudy[] }) {
    const [studyId, setStudyId] = useState<string>('');
    const [running, setRunning] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<FairnessAuditResult | null>(null);
    const [history, setHistory] = useState<FairnessRun[]>([]);
    const [openRun, setOpenRun] = useState<{
        run: FairnessRun;
        metrics: FairnessCohortMetric[];
        flags: FairnessFlag[];
        report: ComplianceReport | null;
    } | null>(null);
    const [loadingRun, setLoadingRun] = useState(false);

    const study = studies.find((entry) => entry.id === studyId) ?? null;

    /** Loads a study's run history. Called when a study is chosen and after a run. */
    const loadHistory = async (id: string) => {
        try {
            const { runs } = await AdminApi.fairnessRuns(id);
            setHistory(runs);
        } catch {
            // History is secondary: a study whose history cannot be read still gets a run
            // control, so this clears the list rather than failing the screen.
            setHistory([]);
        }
    };

    const openRunById = async (runId: string) => {
        setLoadingRun(true);
        setError(null);
        try {
            setOpenRun(await AdminApi.fairnessAudit(runId));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'That run could not be read.');
        } finally {
            setLoadingRun(false);
        }
    };

    const chooseStudy = async (id: string) => {
        setStudyId(id);
        setResult(null);
        setOpenRun(null);
        setError(null);
        setHistory([]);
        if (id) await loadHistory(id);
    };

    const runAudit = async () => {
        if (!studyId) return;
        setRunning(true);
        setError(null);
        setConfirming(false);
        try {
            const outcome = await AdminApi.runFairnessAudit(studyId);
            setResult(outcome);
            // Show the figures straight away when the run produced them, and refresh the
            // history so the new row is there rather than appearing only after a reload.
            if (outcome.detail && outcome.runId) {
                setOpenRun({
                    run: outcome.detail.run,
                    metrics: outcome.detail.metrics,
                    flags: outcome.detail.flags,
                    // Fetched rather than assembled here, because the report is the
                    // document that gets exported and must be the same object the PDF
                    // is rendered from.
                    report: null,
                });
                await openRunById(outcome.runId);
            }
            await loadHistory(studyId);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'The audit could not be run.');
        } finally {
            setRunning(false);
        }
    };

    return (
        <div className="space-y-5">
            {/* ── Which study ─────────────────────────────────────────────── */}
            <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] shadow-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 max-w-2xl">
                        <h2 className="flex items-center gap-2 font-semibold text-[color:var(--text)] text-sm">
                            <Scale size={15} /> Adverse-impact analysis
                        </h2>
                        <p className="mt-1 text-xs leading-relaxed text-[color:var(--muted)]">
                            Groups a study&rsquo;s scored interviews by the cohorts the study declared, and
                            compares each cohort&rsquo;s selection rate against a reference. Nothing here
                            infers a cohort from anything about a candidate: the study declares the keys
                            and an interviewer tags each candidate into one.
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            value={studyId}
                            onChange={(event) => chooseStudy(event.target.value)}
                            className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-soft)] px-3 py-2.5 text-sm text-[color:var(--text)]"
                        >
                            <option value="">Choose a study…</option>
                            {studies.map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                    {entry.name}
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={() => setConfirming(true)}
                            disabled={!studyId || running}
                            className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
                        >
                            {running ? <Loader2 size={16} className="animate-spin" /> : <FlaskConical size={16} />}
                            {running ? 'Running…' : 'Run audit'}
                        </button>
                    </div>
                </div>

                {/* A run reads every session in the study and every scored answer in it, so it
                    is confirmed rather than instant. */}
                {confirming && !running && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4"
                    >
                        <div className="flex items-start gap-3">
                            <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-400" />
                            <div className="min-w-0 flex-1">
                                <p className="text-sm text-[color:var(--text)]">
                                    Run a fairness audit on {study?.name ?? 'this study'}?
                                </p>
                                <p className="mt-1 text-xs text-[color:var(--muted)]">
                                    This reads every interview in the study and every verified answer in it, and
                                    stores a new audit run. It changes nothing about any candidate&rsquo;s scores
                                    and nothing about the study. The run is a record, and records are appended —
                                    an earlier run is never overwritten.
                                </p>
                                <div className="mt-3 flex gap-2">
                                    <button
                                        type="button"
                                        onClick={runAudit}
                                        className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-500"
                                    >
                                        Yes, run it
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setConfirming(false)}
                                        className="rounded-lg border border-[color:var(--line)] px-3 py-2 text-xs text-[color:var(--muted)] hover:text-[color:var(--text)]"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}

                {error && (
                    <p className="mt-3 flex items-center gap-2 text-xs text-[color:var(--danger)]">
                        <AlertTriangle size={14} /> {error}
                    </p>
                )}
            </div>

            {/* ── The run that just finished ──────────────────────────────── */}
            {result && <RunOutcome result={result} />}

            {/* ── Figures ─────────────────────────────────────────────────── */}
            {loadingRun && (
                <p className="flex items-center gap-2 text-xs text-[color:var(--muted)]">
                    <Loader2 size={14} className="animate-spin" /> Reading the run…
                </p>
            )}

            {openRun && !loadingRun && (
                <>
                    <CohortChart metrics={openRun.metrics} threshold={openRun.run.selectionThreshold} />
                    <CohortTable metrics={openRun.metrics} />
                    <FlagsPanel flags={openRun.flags} />
                    <ReportPanel
                        run={openRun.run}
                        report={openRun.report}
                        metrics={openRun.metrics}
                    />
                </>
            )}

            {/* ── Earlier runs ────────────────────────────────────────────── */}
            {studyId && (
                <div className={tableWrap}>
                    <div className="border-b border-[color:var(--line)] px-4 py-3">
                        <h2 className="font-semibold text-[color:var(--text)] text-sm">Earlier runs</h2>
                        <p className="mt-0.5 text-xs text-[color:var(--muted)]">
                            Every run is kept. A finding recorded under an old cutoff or an old cohort
                            declaration stays readable under the rules it was made with.
                        </p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-[color:var(--surface-soft)]">
                                <tr>
                                    <th className={th}>Started</th>
                                    <th className={th}>Status</th>
                                    <th className={th}>Considered</th>
                                    <th className={th}>Included</th>
                                    <th className={th}>Cutoff</th>
                                    <th className={th}></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[color:var(--line)]">
                                {history.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-[color:var(--muted)]">
                                            No audit has been run on this study.
                                        </td>
                                    </tr>
                                ) : (
                                    history.map((run) => (
                                        <tr key={run.id} className="hover:bg-[color:var(--surface-soft)]">
                                            <td className="px-4 py-3 text-xs text-[color:var(--muted)] whitespace-nowrap">
                                                {formatDateTime(run.startedAt)}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`badge ${(STATUS_TONE[run.status] ?? { badge: 'badge' }).badge}`}>
                                                    {(STATUS_TONE[run.status] ?? { label: run.status }).label}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-xs tabular-nums text-[color:var(--muted)]">
                                                {run.sampleSize}
                                            </td>
                                            <td className="px-4 py-3 text-xs tabular-nums text-[color:var(--muted)]">
                                                {run.includedSessions}
                                            </td>
                                            <td className="px-4 py-3 text-xs tabular-nums text-[color:var(--muted)]">
                                                {run.selectionThreshold ?? 'none declared'}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => openRunById(run.id)}
                                                    className="text-xs font-medium text-[color:var(--brand-strong)] hover:underline"
                                                >
                                                    View
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── What the run just did ──────────────────────────────────────────────────

function RunOutcome({ result }: { result: FairnessAuditResult }) {
    const tone = STATUS_TONE[result.status] ?? { badge: 'badge', label: result.status };

    return (
        <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] shadow-card p-5">
            <div className="flex flex-wrap items-center gap-3">
                <span className={`badge ${tone.badge}`}>{tone.label}</span>
                {result.runId && (
                    <span className="font-mono text-xs text-[color:var(--muted)]">
                        run {result.runId.slice(0, 8)}
                    </span>
                )}
            </div>

            {/* A run that did not succeed gets its own sentence, before any figure. The one
                thing this panel must never do is let a failure render as a quiet zero. */}
            {result.status !== 'succeeded' ? (
                <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                    <p className="text-sm text-[color:var(--text)]">
                        {result.status === 'failed'
                            ? 'This audit did not complete.'
                            : 'This audit completed but produced no cohort figures.'}
                    </p>
                    {result.reason && (
                        <p className="mt-1 text-xs text-[color:var(--muted)]">{result.reason}</p>
                    )}
                    <p className="mt-2 text-xs text-[color:var(--muted)]">
                        The absence of findings below is not a finding of fairness, and nothing in this
                        run should be read as one.
                    </p>
                </div>
            ) : (
                result.summary && (
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard
                            icon={Users}
                            label="Considered"
                            value={result.summary.sessionsConsidered}
                            sub={`${result.summary.sessionsIncluded} had a usable score`}
                            color="border-blue-500/20"
                            delay={0}
                        />
                        <StatCard
                            icon={CheckCircle2}
                            label="Verified answers"
                            value={result.summary.responsesVerified}
                            sub={`of ${result.summary.responsesConsidered} considered`}
                            color="border-emerald-500/20"
                            delay={0.05}
                        />
                        <StatCard
                            icon={AlertTriangle}
                            label="Untraceable"
                            value={result.summary.responsesUnverified}
                            sub="scores with no model decision behind them"
                            color="border-amber-500/20"
                            delay={0.1}
                        />
                        <StatCard
                            icon={Info}
                            label="Comparisons"
                            value={result.summary.comparisonCount}
                            sub="cohort-by-key tests run"
                            color="border-brand-500/20"
                            delay={0.15}
                        />
                    </div>
                )
            )}

            {result.caveats.length > 0 && <CaveatList caveats={result.caveats} />}
        </div>
    );
}

function CaveatList({ caveats }: { caveats: string[] }) {
    return (
        <div className="mt-4 rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-soft)] p-4">
            <p className="text-xs font-medium text-[color:var(--text)]">What this run could not examine</p>
            <ul className="mt-2 space-y-1.5">
                {caveats.map((caveat, index) => (
                    <li key={index} className="flex items-start gap-1.5 text-xs leading-relaxed text-[color:var(--muted)]">
                        <Info size={12} className="mt-0.5 shrink-0" />
                        <span>{caveat}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

// ─── The chart ──────────────────────────────────────────────────────────────
//
// Plain SVG, no charting dependency: `recharts` is a dependency of the candidate and
// interviewer apps but not this one, and a two-series bar chart does not justify adding it.
//
// A cohort with no rate is drawn as an empty slot with its reason, never as a bar of height
// zero — a zero-height bar at the bottom of a chart reads as "this cohort selected nobody",
// which is a measurement, and it is not one that was made.

function CohortChart({ metrics, threshold }: { metrics: FairnessCohortMetric[]; threshold: number | null }) {
    const computable = metrics.filter((metric) => metric.computable && metric.selectionRate !== null);
    const refused = metrics.filter((metric) => !metric.computable || metric.selectionRate === null);

    if (metrics.length === 0) return null;

    // The same value may appear under several cohort keys; each is its own bar, labelled by
    // key so two "North" bands under different keys are not read as one cohort.
    const bars = computable.map((metric) => ({
        label: `${metric.cohortKey}: ${metric.cohortValue}`,
        value: metric.selectionRate as number,
        reference: metric.referenceRate,
        ratio: metric.adverseImpactRatio,
    }));

    const width = Math.max(360, bars.length * 84 + 80);
    const height = 240;
    const padding = { top: 16, right: 16, bottom: 56, left: 48 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const barWidth = Math.min(56, (plotWidth / Math.max(1, bars.length)) * 0.6);
    const slot = plotWidth / Math.max(1, bars.length);

    const y = (value: number) => padding.top + plotHeight * (1 - Math.min(1, Math.max(0, value)));

    return (
        <div className={tableWrap}>
            <div className="border-b border-[color:var(--line)] px-4 py-3">
                <h2 className="font-semibold text-[color:var(--text)] text-sm">Selection rate by cohort</h2>
                <p className="mt-0.5 text-xs text-[color:var(--muted)]">
                    The solid line is each cohort&rsquo;s share selected. The dashed line is the reference
                    cohort&rsquo;s rate; the dotted line is four-fifths of it, the screening threshold the
                    four-fifths rule describes. Cohorts without enough scored answers are listed below
                    the chart rather than drawn.
                </p>
            </div>
            <div className="overflow-x-auto p-4">
                <svg width={width} height={height} role="img" aria-label="Selection rate by cohort">
                    {/* Gridlines at 0, 25, 50, 75, 100%. */}
                    {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
                        <g key={tick}>
                            <line
                                x1={padding.left}
                                x2={width - padding.right}
                                y1={y(tick)}
                                y2={y(tick)}
                                stroke="var(--line)"
                                strokeWidth={1}
                            />
                            <text x={padding.left - 8} y={y(tick) + 4} textAnchor="end" fontSize={10} fill="var(--muted)">
                                {Math.round(tick * 100)}%
                            </text>
                        </g>
                    ))}

                    {bars.map((bar, index) => {
                        const x = padding.left + slot * index + (slot - barWidth) / 2;
                        const top = y(bar.value);
                        return (
                            <g key={bar.label}>
                                <rect
                                    x={x}
                                    y={top}
                                    width={barWidth}
                                    height={padding.top + plotHeight - top}
                                    rx={4}
                                    fill="var(--brand)"
                                    opacity={0.85}
                                />
                                <text
                                    x={x + barWidth / 2}
                                    y={top - 4}
                                    textAnchor="middle"
                                    fontSize={10}
                                    fill="var(--text)"
                                >
                                    {pct(bar.value)}
                                </text>
                                {bar.reference !== null && Number.isFinite(bar.reference) && (
                                    <>
                                        <line
                                            x1={x - 6}
                                            x2={x + barWidth + 6}
                                            y1={y(bar.reference)}
                                            y2={y(bar.reference)}
                                            stroke="var(--text)"
                                            strokeWidth={1.5}
                                            strokeDasharray="4 3"
                                        />
                                        <line
                                            x1={x - 6}
                                            x2={x + barWidth + 6}
                                            y1={y(bar.reference * 0.8)}
                                            y2={y(bar.reference * 0.8)}
                                            stroke="var(--warn)"
                                            strokeWidth={1.5}
                                            strokeDasharray="2 3"
                                        />
                                    </>
                                )}
                                {/* Two lines, because a key and a value on one line is unreadable
                                    at this width and a truncated label is worse than none. */}
                                <text
                                    x={x + barWidth / 2}
                                    y={height - padding.bottom + 16}
                                    textAnchor="middle"
                                    fontSize={10}
                                    fill="var(--muted)"
                                >
                                    {shorten(bar.label.split(': ')[1] ?? bar.label, 12)}
                                </text>
                                <text
                                    x={x + barWidth / 2}
                                    y={height - padding.bottom + 28}
                                    textAnchor="middle"
                                    fontSize={9}
                                    fill="var(--muted)"
                                    opacity={0.7}
                                >
                                    {shorten(bar.label.split(': ')[0] ?? '', 14)}
                                </text>
                            </g>
                        );
                    })}
                </svg>
            </div>

            {refused.length > 0 && (
                <div className="border-t border-[color:var(--line)] px-4 py-3">
                    <p className="text-xs font-medium text-[color:var(--text)]">
                        Listed, not drawn — no rate could be computed
                    </p>
                    <ul className="mt-2 space-y-1.5">
                        {refused.map((metric) => (
                            <li key={metric.id} className="text-xs text-[color:var(--muted)]">
                                <span className="font-medium text-[color:var(--text)]">
                                    {metric.cohortKey}: {metric.cohortValue}
                                </span>{' '}
                                — {metric.notComputableReason ?? 'no reason was recorded, which is itself a fault'}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

function shorten(value: string, max: number): string {
    return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

// ─── The figures ────────────────────────────────────────────────────────────

function CohortTable({ metrics }: { metrics: FairnessCohortMetric[] }) {
    if (metrics.length === 0) {
        return (
            <div className={tableWrap}>
                <div className="px-4 py-8 text-center text-sm text-[color:var(--muted)]">
                    No cohort figures were computed for this run.
                </div>
            </div>
        );
    }

    return (
        <div className={tableWrap}>
            <div className="border-b border-[color:var(--line)] px-4 py-3">
                <h2 className="font-semibold text-[color:var(--text)] text-sm">Cohort figures</h2>
                <p className="mt-0.5 text-xs text-[color:var(--muted)]">
                    A ratio below 0.80 is the four-fifths screening line. It is a flag for a human to
                    look at, not a legal finding, and it is not computed at all where the cohort is too
                    thin to support it.
                </p>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-[color:var(--surface-soft)]">
                        <tr>
                            <th className={th}>Cohort</th>
                            <th className={th}>Candidates</th>
                            <th className={th}>Scored</th>
                            <th className={th}>Selected</th>
                            <th className={th}>Rate</th>
                            <th className={th}>Reference</th>
                            <th className={th}>Ratio</th>
                            <th className={th}>z</th>
                            <th className={th}>p</th>
                            <th className={th}>χ² (Yates)</th>
                            <th className={th}>Cohen&rsquo;s d</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[color:var(--line)]">
                        {metrics.map((metric) => (
                            <tr key={metric.id} className="hover:bg-[color:var(--surface-soft)]">
                                <td className="px-4 py-3 text-xs text-[color:var(--text)]">
                                    <span className="font-medium">{metric.cohortValue}</span>
                                    <span className="ml-2 text-[color:var(--muted)]">{metric.cohortKey}</span>
                                    {/* The refusal is printed in the row it belongs to, not in a
                                        footnote: a reader scanning the Ratio column must not be
                                        able to take this row for a cohort that passed. */}
                                    {!metric.computable && (
                                        <p className="mt-1 text-[11px] text-[color:var(--muted)]">
                                            {metric.notComputableReason ?? 'no reason recorded'}
                                        </p>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-xs tabular-nums text-[color:var(--muted)]">{metric.n}</td>
                                <td className="px-4 py-3 text-xs tabular-nums text-[color:var(--muted)]">
                                    {metric.scoredN}
                                    {metric.scoredN < metric.n && (
                                        <span className="ml-1 text-[10px] opacity-70">
                                            ({metric.n - metric.scoredN} unscored)
                                        </span>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-xs tabular-nums text-[color:var(--muted)]">
                                    {metric.computable ? metric.selectedCount : notComputed}
                                </td>
                                <td className="px-4 py-3 text-xs tabular-nums text-[color:var(--text)]">
                                    {pct(metric.selectionRate)}
                                </td>
                                <td className="px-4 py-3 text-xs tabular-nums text-[color:var(--muted)]">
                                    {pct(metric.referenceRate)}
                                </td>
                                <td className="px-4 py-3 text-xs tabular-nums">
                                    <span
                                        className={
                                            metric.adverseImpactRatio !== null && metric.adverseImpactRatio < 0.8
                                                ? 'font-medium text-[color:var(--warn)]'
                                                : 'text-[color:var(--text)]'
                                        }
                                    >
                                        {num(metric.adverseImpactRatio)}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-xs tabular-nums text-[color:var(--muted)]">
                                    {num(metric.zStatistic)}
                                </td>
                                <td className="px-4 py-3 text-xs tabular-nums text-[color:var(--muted)]">
                                    {pValue(metric.pValue)}
                                </td>
                                <td className="px-4 py-3 text-xs tabular-nums text-[color:var(--muted)]">
                                    {num(metric.chiSquare)}
                                </td>
                                <td className="px-4 py-3 text-xs tabular-nums text-[color:var(--muted)]">
                                    {num(metric.effectSize)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ─── The flags ──────────────────────────────────────────────────────────────

function FlagsPanel({ flags }: { flags: FairnessFlag[] }) {
    return (
        <div className={tableWrap}>
            <div className="border-b border-[color:var(--line)] px-4 py-3">
                <h2 className="font-semibold text-[color:var(--text)] text-sm">
                    Findings ({flags.length})
                </h2>
                <p className="mt-0.5 text-xs text-[color:var(--muted)]">
                    Each flag says what it found and what it cannot tell you. The second part is
                    required and is printed at the same weight as the first: a gap between cohorts is
                    also what a genuine difference in how the groups answered looks like, and nothing
                    here can tell those apart.
                </p>
            </div>
            <div className="divide-y divide-[color:var(--line)]">
                {flags.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-[color:var(--muted)]">
                        <p>No flag was raised.</p>
                        <p className="mx-auto mt-2 max-w-xl text-xs leading-relaxed">
                            This means no statistic crossed its reporting line on this data at this
                            sample size. It is not a finding that the process is fair: the tests can
                            only detect gaps large enough for the sample to show.
                        </p>
                    </div>
                ) : (
                    flags.map((flag) => (
                        <div key={flag.id} className="p-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className={`badge ${SEVERITY_BADGE[flag.severity] ?? 'badge'}`}>
                                    {flag.severity}
                                </span>
                                <span className="badge">{flag.targetType}</span>
                                {flag.cohortValue && (
                                    <span className="text-xs text-[color:var(--muted)]">
                                        {flag.cohortKey}: {flag.cohortValue}
                                    </span>
                                )}
                            </div>

                            <p className="mt-2 text-sm text-[color:var(--text)]">{flag.finding}</p>

                            <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-[color:var(--muted)]">
                                <Info size={12} className="mt-0.5 shrink-0" />
                                <span>
                                    <span className="font-medium text-[color:var(--text)]">
                                        What this cannot say:{' '}
                                    </span>
                                    {flag.whatItCannotSay}
                                </span>
                            </p>

                            {flag.recommendation && (
                                <p className="mt-1.5 text-xs text-[color:var(--muted)]">
                                    <span className="font-medium text-[color:var(--text)]">Look at: </span>
                                    {flag.recommendation}
                                </p>
                            )}

                            <p className="mt-2 text-[11px] tabular-nums text-[color:var(--muted)] opacity-80">
                                {!flag.computable && flag.notComputableReason
                                    ? `No statistic — ${flag.notComputableReason}`
                                    : `Statistic ${num(flag.statistic)} against a threshold of ${num(flag.threshold)}` +
                                      (flag.pValue !== null ? `, p = ${pValue(flag.pValue)}` : '')}
                            </p>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

// ─── The report ─────────────────────────────────────────────────────────────

function ReportPanel({
    run, report, metrics,
}: {
    run: FairnessRun;
    report: ComplianceReport | null;
    metrics: FairnessCohortMetric[];
}) {
    return (
        <div className={tableWrap}>
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[color:var(--line)] px-4 py-3">
                <div className="min-w-0 max-w-2xl">
                    <h2 className="flex items-center gap-2 font-semibold text-[color:var(--text)] text-sm">
                        <FileText size={15} /> Compliance report
                    </h2>
                    <p className="mt-0.5 text-xs text-[color:var(--muted)]">
                        Cites the clauses this analysis is designed against, each with what it does
                        not claim. An independent bias audit under NYC Local Law 144 requires an
                        independent auditor, which this is not; nothing here is a conformity
                        assessment.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <a
                        href={AdminApi.fairnessReportUrl(run.id)}
                        className="flex items-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-500"
                    >
                        <Download size={14} /> PDF
                    </a>
                    <a
                        href={AdminApi.fairnessCsvUrl(run.id)}
                        className="flex items-center gap-2 rounded-xl border border-[color:var(--line)] px-3 py-2 text-xs font-medium text-[color:var(--muted)] hover:text-[color:var(--text)]"
                    >
                        <Download size={14} /> CSV
                    </a>
                </div>
            </div>

            <div className="space-y-4 p-4">
                {/* What scored these answers. Read from the decision log, so it names the model
                    that actually ran rather than the one the study is configured with now. */}
                <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-soft)] p-3">
                    <p className="text-xs text-[color:var(--muted)]">
                        <span className="font-medium text-[color:var(--text)]">Scoring system: </span>
                        {report?.systemDescription ?? 'not recorded for this run'}
                    </p>
                    <p className="mt-1 text-xs text-[color:var(--muted)]">
                        <span className="font-medium text-[color:var(--text)]">Selection cutoff: </span>
                        {run.selectionThreshold === null
                            ? 'none declared — no candidate could be counted as selected'
                            : run.selectionThreshold}
                    </p>
                    <p className="mt-1 text-xs text-[color:var(--muted)]">
                        <span className="font-medium text-[color:var(--text)]">Cohort figures: </span>
                        {metrics.filter((metric) => metric.computable).length} computed,{' '}
                        {metrics.filter((metric) => !metric.computable).length} refused
                    </p>
                </div>

                {report ? (
                    <>
                        <div>
                            <p className="text-xs font-medium text-[color:var(--text)]">Clauses cited</p>
                            <ul className="mt-2 space-y-2">
                                {report.citations.map((citation) => (
                                    <li key={citation.id} className="text-xs leading-relaxed">
                                        <span className="font-medium text-[color:var(--text)]">
                                            {citation.instrument}, {citation.clause}
                                        </span>
                                        <span className="text-[color:var(--muted)]"> — {citation.usedFor}</span>
                                        <p className="mt-0.5 text-[color:var(--muted)] opacity-90">
                                            Does not claim: {citation.doesNotClaim}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div>
                            <p className="text-xs font-medium text-[color:var(--text)]">How the numbers were produced</p>
                            <ul className="mt-2 space-y-1.5">
                                {report.methodology.map((item, index) => (
                                    <li key={index} className="text-xs leading-relaxed text-[color:var(--muted)]">
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {report.exclusions.length > 0 && (
                            <div>
                                <p className="text-xs font-medium text-[color:var(--text)]">Excluded from this run</p>
                                <ul className="mt-2 space-y-1">
                                    {report.exclusions.map((exclusion, index) => (
                                        <li key={index} className="text-xs text-[color:var(--muted)]">
                                            {exclusion.reason} — {exclusion.count}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </>
                ) : (
                    <p className="text-xs text-[color:var(--muted)]">
                        The report could not be assembled for this run. The figures above were read
                        directly from the stored metrics and are unaffected.
                    </p>
                )}
            </div>
        </div>
    );
}
