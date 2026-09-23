'use client';

// ============================================
// DeliveryJobsView.tsx — delivery analysis job health (Feature 2)
// ============================================
//
// The operator's window onto multimodal delivery analysis: did the analysis
// actually run for the answers that had a capture, and if not, why not.
//
// THE ONE DISTINCTION THIS SCREEN EXISTS TO MAKE
//
// A failed job and a measurement that found nothing look identical from the
// outside — both are an answer with no delivery evidence — but they are opposites:
//
//   · A FAILED job means the analysis could not run. The response may have been
//     deleted, or the payload was malformed beyond what the tolerant parser
//     repairs. It is a fault, it is fixable, and it is retryable.
//
//   · A MUTED MICROPHONE is a SUCCESSFUL analysis that measured nothing. The job
//     succeeded; the audio simply contained no speech. There is no bug, and
//     retrying it would produce the same true answer.
//
// So this screen counts failures only, and says plainly what it is not counting. An
// operator who cannot tell those two apart will hunt a bug that does not exist and
// miss the recording condition that is behaving exactly as designed.

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
    Activity, AlertTriangle, CheckCircle2, Clock, Info, Loader2, RefreshCw, ShieldAlert,
} from 'lucide-react';
import {
    AdminApi, type DeliveryJobHealth, type DeliveryRetryResult,
} from '@/lib/adminApi';
import { StatCard, tableWrap, th } from '@/components/adminViews';
import { formatDateTime } from '@/components/adminShared';

export default function DeliveryJobsView({
    health, onRetried,
}: {
    health: DeliveryJobHealth;
    onRetried: () => Promise<void> | void;
}) {
    const [confirming, setConfirming] = useState(false);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<DeliveryRetryResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const queued = health.counts.queued ?? 0;
    const running_ = health.counts.running ?? 0;
    const succeeded = health.counts.succeeded ?? 0;
    const failed = health.counts.failed ?? 0;
    const retryable = health.failed.filter((job) => job.retryable).length;

    const runRetry = async () => {
        setRunning(true);
        setError(null);
        setResult(null);
        try {
            const outcome = await AdminApi.retryDeliveryJobs({ limit: 25 });
            setResult(outcome);
            setConfirming(false);
            // Re-read so the table reflects the retried jobs rather than the
            // pre-retry snapshot the operator was looking at.
            await onRetried();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'The retry sweep failed.');
        } finally {
            setRunning(false);
        }
    };

    return (
        <div className="space-y-5">
            {/* ── Job state ──────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    icon={CheckCircle2}
                    label="Analysed"
                    value={succeeded}
                    sub="answers whose delivery was measured"
                    color="border-emerald-500/20"
                    delay={0}
                />
                <StatCard
                    icon={Clock}
                    label="Waiting"
                    value={queued + running_}
                    sub={running_ > 0 ? `${running_} running now` : 'queued for analysis'}
                    color="border-blue-500/20"
                    delay={0.05}
                />
                <StatCard
                    icon={AlertTriangle}
                    label="Failed"
                    value={failed}
                    sub="the analysis could not run"
                    color="border-red-500/20"
                    delay={0.1}
                />
                <StatCard
                    icon={RefreshCw}
                    label="Retryable now"
                    value={retryable}
                    sub={`of ${failed} failed · ${health.maxAttempts} attempts allowed`}
                    color="border-amber-500/20"
                    delay={0.15}
                />
            </div>

            {/* ── Retry, and what it is for ──────────────────────────────── */}
            <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] shadow-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 max-w-2xl">
                        <h2 className="font-semibold text-[color:var(--text)] text-sm">Retry failed analyses</h2>
                        <p className="mt-1 text-xs leading-relaxed text-[color:var(--muted)]">
                            Re-runs each failed analysis from the capture it still holds. A job is retryable
                            while it has attempts left and its payload has not been cleared, so this sweep
                            skips the ones that are out of attempts rather than reporting them as fixed.
                        </p>
                        <p className="mt-2 flex items-start gap-1.5 text-xs text-[color:var(--muted)]">
                            <Info size={13} className="mt-0.5 shrink-0" />
                            Retrying is idempotent. An answer that was already analysed is not adjusted twice —
                            the score movement is always measured against the score the text produced, never
                            against a previously adjusted one.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={() => setConfirming(true)}
                        disabled={running || retryable === 0}
                        className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
                    >
                        {running ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                        {running ? 'Retrying…' : 'Retry failed'}
                    </button>
                </div>

                {failed === 0 && (
                    <p className="mt-3 flex items-start gap-1.5 text-xs text-[color:var(--muted)]">
                        <Activity size={13} className="mt-0.5 shrink-0" />
                        Nothing has failed. Note that an answer which was analysed but had nothing to measure —
                        a muted microphone, or a question answered by typing — is counted above as analysed,
                        because it is. Absence of evidence is not a failure to analyse here.
                    </p>
                )}

                {/* A retry spends work on a candidate's behalf, so it is confirmed
                    rather than instant. */}
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
                                    Retry {Math.min(retryable, 25)} failed analysis
                                    {Math.min(retryable, 25) === 1 ? '' : 'es'} now?
                                </p>
                                <p className="mt-1 text-xs text-[color:var(--muted)]">
                                    Each one re-derives its metrics and re-applies its score movement. Answers that
                                    were already analysed are not touched, and no candidate sees a different
                                    result unless an analysis genuinely succeeds this time.
                                </p>
                                <div className="mt-3 flex gap-2">
                                    <button
                                        type="button"
                                        onClick={runRetry}
                                        className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-500"
                                    >
                                        Yes, retry them
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

                {result && (
                    <div className="mt-4 rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-soft)] p-4">
                        <p className="text-sm font-medium text-[color:var(--text)]">Retry finished</p>
                        <div className="mt-2 grid grid-cols-3 gap-x-6 gap-y-1 text-xs">
                            <Outcome label="Attempted" value={result.attempted} />
                            <Outcome label="Succeeded" value={result.succeeded} />
                            <Outcome label="Still failing" value={result.failed} />
                        </div>
                        {/* The reasons, not just the counts: a job that fails the same
                            way twice is a different problem from one that failed once. */}
                        {result.outcomes.filter((outcome) => outcome.status !== 'succeeded').length > 0 && (
                            <ul className="mt-3 space-y-1.5">
                                {result.outcomes
                                    .filter((outcome) => outcome.status !== 'succeeded')
                                    .slice(0, 8)
                                    .map((outcome) => (
                                        <li key={outcome.jobId} className="text-xs text-[color:var(--muted)]">
                                            <span className="font-medium text-[color:var(--text)]">
                                                {outcome.jobId.slice(0, 8)}
                                            </span>{' '}
                                            {outcome.status}
                                            {outcome.skippedReason ? ` — ${outcome.skippedReason}` : ''}
                                            {outcome.error ? ` — ${outcome.error}` : ''}
                                        </li>
                                    ))}
                            </ul>
                        )}
                    </div>
                )}
            </div>

            {/* ── Failures ───────────────────────────────────────────────── */}
            <div className={tableWrap}>
                <div className="border-b border-[color:var(--line)] px-4 py-3">
                    <h2 className="font-semibold text-[color:var(--text)] text-sm">Failed analyses</h2>
                    <p className="mt-0.5 text-xs text-[color:var(--muted)]">
                        Most recent {health.returned} jobs read; the failures among them are listed here.
                    </p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-[color:var(--surface-soft)]">
                            <tr>
                                <th className={th}>When</th>
                                <th className={th}>Session</th>
                                <th className={th}>Answer</th>
                                <th className={th}>Attempts</th>
                                <th className={th}>Reason</th>
                                <th className={th}>State</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[color:var(--line)]">
                            {health.failed.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-[color:var(--muted)]">
                                        No failed analyses.
                                    </td>
                                </tr>
                            ) : (
                                health.failed.map((job) => (
                                    <tr key={job.id} className="hover:bg-[color:var(--surface-soft)]">
                                        <td className="px-4 py-3 text-xs text-[color:var(--muted)] whitespace-nowrap">
                                            {job.createdAt ? formatDateTime(job.createdAt) : '—'}
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs text-[color:var(--text)]">
                                            {job.sessionId ? job.sessionId.slice(0, 8) : '—'}
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs text-[color:var(--text)]">
                                            {job.responseId ? job.responseId.slice(0, 8) : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-xs tabular-nums text-[color:var(--muted)]">
                                            {job.attempts} / {job.maxAttempts}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-[color:var(--muted)] max-w-md">
                                            {job.lastError ?? 'No reason recorded.'}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`badge ${job.retryable ? 'badge-warn' : 'badge-danger'}`}>
                                                {job.retryable ? 'Retryable' : 'Out of attempts'}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

function Outcome({ label, value }: { label: string; value: number }) {
    return (
        <span className="text-[color:var(--muted)]">
            {label}: <span className="font-medium tabular-nums text-[color:var(--text)]">{value}</span>
        </span>
    );
}
