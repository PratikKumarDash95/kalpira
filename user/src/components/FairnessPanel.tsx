'use client';

// ============================================
// FairnessPanel.tsx — the interviewer's per-study fairness view, and cohort tagging
// ============================================
//
// Two pieces of Feature 4, both of them shared by the candidate-hosted interviewer route
// and the standalone interviewer portal (`interviewer/tsconfig.json` aliases `@/*` to
// `user/src/*`, so this file serves both).
//
// WHAT THE PANEL IS, AND WHAT IT DELIBERATELY IS NOT
//
// It is a summary: whether an audit has been run on this study, when, whether it completed,
// what it could not examine, and how many findings it raised by severity. It is NOT the
// per-cohort figures. A breakdown of a study's candidates by cohort is not something to put
// in front of everyone who can see the study, so that stays on the admin console behind
// `/api/fairness/audit/[id]`. The panel links nowhere near it; it says where the analysis
// lives and who can run one.
//
// The one thing it must never do is let "no audit has been run" read as "no problems
// found". Those are opposite facts — one is an absence of evidence, the other is evidence —
// and a panel that renders both as an empty state destroys the distinction the entire
// feature is built on. So an unrun study says so in words, and a run that did not complete
// says that too, in its own wording, with its error.
//
// TAGGING
//
// The cohort tagging control, which is the other half of the design decision behind all of
// this: cohorts are DECLARED by the study and ASSIGNED by a person. Nothing here infers a
// cohort from anything about a candidate. The control offers exactly the keys and values the
// study declared, and the server refuses anything else — including a key naming a protected
// attribute — before it is ever stored.

import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import {
    AlertTriangle, Check, Info, Loader2, Scale, ShieldAlert, Tag, X,
} from 'lucide-react';

export interface CohortKeyDeclaration {
    key: string;
    label: string;
    values: string[];
}

interface FairnessSummary {
    studyId: string;
    declaration: {
        cohortKeys: CohortKeyDeclaration[];
        selectionThreshold: number | null;
    };
    declarationIssues: string[];
    undeclared: boolean;
    taggedSessions: number;
    assignmentCount: number;
    run: {
        id: string;
        status: string;
        startedAt: string | null;
        finishedAt: string | null;
        error: string | null;
        sampleSize: number;
        includedSessions: number;
        caveats: string[];
        exclusions: { reason: string; count: number }[];
    } | null;
    flagCounts: { high: number; medium: number; low: number; info: number };
    canRunAudit: boolean;
}

const STATUS_WORDING: Record<string, string> = {
    succeeded: 'completed',
    not_computable: 'completed but produced no cohort figures',
    running: 'is still running',
    failed: 'did not complete',
};

/**
 * The study's fairness summary.
 *
 * `refreshKey` lets the parent force a re-read after a run, without this component owning a
 * run control it is not allowed to use.
 */
export function StudyFairnessPanel({
    studyId, refreshKey = 0, onDeclaration,
}: {
    studyId: string;
    refreshKey?: number;
    /**
     * Reports the study's declared cohort keys up to the caller.
     *
     * The panel is the only thing that reads the summary, so the tagging control below it
     * is handed the declaration from here rather than asking the same endpoint again — two
     * readers of one question can disagree, and the control would then offer values the
     * panel had already reported as removed.
     */
    onDeclaration?: (keys: CohortKeyDeclaration[]) => void;
}) {
    const [summary, setSummary] = useState<FairnessSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            try {
                const res = await apiFetch(`/api/fairness/summary?studyId=${encodeURIComponent(studyId)}`);
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    if (!cancelled) setError(body.error || 'The fairness summary could not be read.');
                    return;
                }
                const data = (await res.json()) as FairnessSummary;
                if (!cancelled) {
                    setSummary(data);
                    setError(null);
                    // An undeclared study reports no keys rather than keeping stale ones: the
                    // tagging control must not offer a value the study has stopped declaring.
                    onDeclaration?.(data.declaration?.cohortKeys ?? []);
                }
            } catch {
                if (!cancelled) setError('Network error. Please try again.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
        // `onDeclaration` is deliberately not a dependency: the caller passes an inline
        // arrow, so including it would re-run this effect on every render and put the
        // summary into a fetch loop.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [studyId, refreshKey]);

    if (loading) {
        return (
            <div className="mb-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                <p className="flex items-center gap-2 text-xs text-slate-500">
                    <Loader2 size={14} className="animate-spin" /> Reading the fairness summary…
                </p>
            </div>
        );
    }

    // A panel that failed to load does not render as "nothing to report". It says it failed,
    // because silence here is indistinguishable from a clean bill of health.
    if (error || !summary) {
        return (
            <div className="mb-8 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
                <p className="flex items-center gap-2 text-sm font-medium text-amber-300">
                    <AlertTriangle size={16} /> Fairness summary unavailable
                </p>
                <p className="mt-1 text-xs text-slate-400">
                    {error ?? 'No summary was returned.'} This is not a statement about the study.
                </p>
            </div>
        );
    }

    const { run, flagCounts } = summary;
    const flagsRaised = flagCounts.high + flagCounts.medium + flagCounts.low + flagCounts.info;

    return (
        <div className="mb-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 max-w-2xl">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                        <Scale size={15} /> Fairness audit
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">
                        An adverse-impact analysis groups this study&rsquo;s scored interviews by the
                        cohorts the study declared. The per-cohort figures are admin-facing; this panel
                        reports whether an audit has been run and whether it found anything.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {summary.run && (
                        <span className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300">
                            {summary.run.includedSessions} of {summary.run.sampleSize} interviews included
                        </span>
                    )}
                    <span className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300">
                        {summary.taggedSessions} candidate{summary.taggedSessions === 1 ? '' : 's'} tagged
                    </span>
                </div>
            </div>

            {/* ── The run, or its absence ─────────────────────────────────── */}
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-800/40 p-4">
                {!run ? (
                    <>
                        <p className="text-sm text-slate-200">No audit has been run on this study.</p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-500">
                            That is an absence of evidence, not a finding. Nothing has been examined, so
                            nothing is known either way.
                        </p>
                    </>
                ) : (
                    <>
                        <div className="flex flex-wrap items-center gap-2">
                            <span
                                className={
                                    run.status === 'succeeded'
                                        ? 'rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300'
                                        : run.status === 'failed'
                                            ? 'rounded-xl border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300'
                                            : 'rounded-xl border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300'
                                }
                            >
                                Last run {STATUS_WORDING[run.status] ?? run.status}
                            </span>
                            {run.startedAt && (
                                <span className="text-xs text-slate-500">
                                    {new Date(run.startedAt).toLocaleString()}
                                </span>
                            )}
                        </div>

                        {run.error && (
                            <p className="mt-2 text-xs text-red-300">{run.error}</p>
                        )}

                        {run.status === 'succeeded' ? (
                            <p className="mt-2 text-xs text-slate-400">
                                {flagsRaised === 0
                                    ? 'No finding was raised. That means no statistic crossed its reporting line on this data at this sample size — it is not a finding that the process is fair.'
                                    : `${flagsRaised} finding${flagsRaised === 1 ? '' : 's'} raised: ` +
                                      `${flagCounts.high} high, ${flagCounts.medium} medium, ${flagCounts.low} low, ${flagCounts.info} informational. ` +
                                      'Each names what it cannot tell you, and each is for a person to look at — nothing is decided automatically.'}
                            </p>
                        ) : (
                            <p className="mt-2 text-xs leading-relaxed text-slate-400">
                                This run produced no cohort figures. The absence of findings in it is not
                                a finding of fairness, and nothing in it should be read as one.
                            </p>
                        )}

                        {run.caveats.length > 0 && (
                            <ul className="mt-3 space-y-1.5">
                                {run.caveats.map((caveat, index) => (
                                    <li key={index} className="flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
                                        <Info size={12} className="mt-0.5 shrink-0" />
                                        <span>{caveat}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </>
                )}
            </div>

            {/* ── What this panel cannot do, said plainly ─────────────────── */}
            <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
                <ShieldAlert size={12} className="mt-0.5 shrink-0" />
                <span>
                    {summary.canRunAudit
                        ? 'You can run an audit from the admin console, where the cohort figures are shown.'
                        : 'Running an audit and reading the cohort figures is an admin action. Ask an admin to run one for this study.'}
                </span>
            </p>

            {/* ── What is wrong with the declaration ─────────────────────── */}
            {summary.declarationIssues.length > 0 && (
                <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                    <p className="text-xs font-medium text-amber-300">Cohort declaration</p>
                    <ul className="mt-1 space-y-1">
                        {summary.declarationIssues.map((issue, index) => (
                            <li key={index} className="text-xs text-slate-400">{issue}</li>
                        ))}
                    </ul>
                </div>
            )}
            {summary.undeclared && summary.declarationIssues.length === 0 && (
                <p className="mt-3 text-xs text-slate-500">
                    This study has not declared any cohorts, so there is nothing for an audit to group
                    by. A cohort key is whatever the study chooses to record — an institution, a region,
                    an experience band. Never an attribute of the person.
                </p>
            )}
        </div>
    );
}

// ─── Tagging one candidate into a declared cohort ───────────────────────────

interface Assignment {
    id: string;
    cohortKey: string;
    cohortValue: string;
    assignedAt?: string | null;
}

/**
 * The tagging control for one candidate.
 *
 * Loads its own tags when the row is expanded rather than having them passed down, because
 * a study's candidate list does not carry them and fetching every candidate's tags to render
 * a list nobody has expanded would be a query per candidate for nothing.
 *
 * The offered values are exactly the study's declared ones. There is no free-text field,
 * deliberately: a control that let an interviewer type a cohort value would be a control
 * that could write "female" into the table, and no amount of service-layer validation makes
 * that a good idea when the alternative is not offering the field at all.
 */
export function CohortTagging({
    sessionId, declaration,
}: {
    sessionId: string;
    declaration: CohortKeyDeclaration[];
}) {
    const [assignments, setAssignments] = useState<Assignment[] | null>(null);
    const [saving, setSaving] = useState<string | null>(null);
    const [refusal, setRefusal] = useState<string | null>(null);
    const [saved, setSaved] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const res = await apiFetch(`/api/fairness/cohort?sessionId=${encodeURIComponent(sessionId)}`);
                if (!res.ok) { if (!cancelled) setAssignments([]); return; }
                const data = await res.json();
                if (!cancelled) setAssignments(data.assignments ?? []);
            } catch {
                // A tag list that cannot be read renders as empty with the control still
                // usable: the next save re-reads it, and a failed read is not a fact about
                // the candidate.
                if (!cancelled) setAssignments([]);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [sessionId]);

    const valueFor = (key: string): string =>
        assignments?.find((assignment) => assignment.cohortKey === key)?.cohortValue ?? '';

    const save = async (cohortKey: string, cohortValue: string) => {
        setSaving(cohortKey);
        setRefusal(null);
        setSaved(null);
        try {
            const res = await apiFetch('/api/fairness/cohort', {
                method: 'POST',
                body: JSON.stringify({ sessionId, cohortKey, cohortValue }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                // The server's own sentence, not a generic failure. It is written for the
                // interviewer to act on: it names the declaration the value did not match.
                setRefusal(data.error || 'That tag was refused.');
                return;
            }
            setAssignments(data.assignments ?? []);
            setSaved(cohortKey);
        } catch {
            setRefusal('Network error. The tag was not saved.');
        } finally {
            setSaving(null);
        }
    };

    const remove = async (cohortKey: string) => {
        setSaving(cohortKey);
        setRefusal(null);
        setSaved(null);
        try {
            const res = await apiFetch('/api/fairness/cohort', {
                method: 'DELETE',
                body: JSON.stringify({ sessionId, cohortKey }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setRefusal(data.error || 'That tag could not be removed.');
                return;
            }
            setAssignments(data.assignments ?? []);
            setSaved(cohortKey);
        } catch {
            setRefusal('Network error. The tag was not removed.');
        } finally {
            setSaving(null);
        }
    };

    if (declaration.length === 0) {
        return (
            <div className="rounded-xl border border-slate-800 bg-slate-800/40 p-4">
                <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
                    <Tag size={14} /> Cohort
                </p>
                <p className="mt-1 text-xs text-slate-500">
                    This study has declared no cohorts, so there is nothing to tag a candidate into.
                    Cohorts are declared on the study — never inferred from anything about the candidate.
                </p>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-slate-800 bg-slate-800/40 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <Tag size={14} /> Cohort
            </p>
            <p className="mt-1 text-xs text-slate-500">
                Which declared group this candidate belongs to. Used only to compare selection rates
                between groups; it never affects a score.
            </p>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {declaration.map((entry) => (
                    <label key={entry.key} className="block">
                        <span className="mb-1 block text-xs text-slate-400">{entry.label || entry.key}</span>
                        <div className="flex items-center gap-2">
                            <select
                                value={valueFor(entry.key)}
                                disabled={saving === entry.key}
                                onChange={(event) => {
                                    // "Not tagged" is a real action, not a reset that does
                                    // nothing: an interviewer who mis-clicked must be able to
                                    // undo it, and the untag endpoint is what makes the empty
                                    // option honest.
                                    const next = event.target.value;
                                    if (!next) {
                                        void remove(entry.key);
                                        return;
                                    }
                                    void save(entry.key, next);
                                }}
                                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 disabled:opacity-50"
                            >
                                <option value="">Not tagged</option>
                                {entry.values.map((value) => (
                                    <option key={value} value={value}>{value}</option>
                                ))}
                            </select>
                            {saving === entry.key && <Loader2 size={14} className="animate-spin text-slate-500" />}
                            {saved === entry.key && <Check size={14} className="text-emerald-400" />}
                        </div>
                    </label>
                ))}
            </div>

            {refusal && (
                <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-300">
                    <X size={13} className="mt-0.5 shrink-0" /> {refusal}
                </p>
            )}
            {assignments === null && (
                <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                    <Loader2 size={12} className="animate-spin" /> Reading existing tags…
                </p>
            )}
        </div>
    );
}
