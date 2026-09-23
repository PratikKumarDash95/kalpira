'use client';

// ============================================
// CalibrationView.tsx — item bank inspection + re-fit (Feature 1)
// ============================================
//
// The operator's window onto the measurement instrument.
//
// Two things this screen has to get right, because both are easy to get wrong in
// an admin panel:
//
//  1. Calibration is a FITTING process, so it can be wrong. An item with
//     discrimination near zero measures nothing, and one fitted from six
//     responses is noise wearing parameters. Every row therefore carries why it
//     may not be usable, and an item with no concerns says so explicitly.
//
//  2. Re-fitting loads the whole response history into memory and is not
//     something to trigger by brushing past a button. It is behind an explicit
//     confirmation, and its result is reported as counts rather than as a
//     success tick — "12 calibrated, 8 skipped" is the actual outcome.
//
// Nothing here can change a candidate's stored scores. Calibration writes item
// parameters only; the bank cannot be edited by hand, because hand-edited
// psychometrics are not psychometrics.

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
    AlertTriangle, CheckCircle2, Gauge, Info, Loader2, RefreshCw, ShieldAlert, Sparkles,
} from 'lucide-react';
import { AdminApi, type CalibrationResult, type ItemBank, type ItemParameterRow } from '@/lib/adminApi';
import { StatCard, tableWrap, th } from '@/components/adminViews';
import { formatDateTime } from '@/components/adminShared';

type Filter = 'all' | 'usable' | 'concerns' | 'retired' | 'thin';

const FILTERS: Array<{ key: Filter; label: string }> = [
    { key: 'all', label: 'All items' },
    { key: 'usable', label: 'Usable' },
    { key: 'concerns', label: 'Needs attention' },
    { key: 'retired', label: 'Retired' },
    { key: 'thin', label: 'Small sample' },
];

function matchesFilter(item: ItemParameterRow, filter: Filter): boolean {
    switch (filter) {
        case 'usable':
            return item.usable && !item.isRetired;
        case 'concerns':
            return item.concerns.length > 0;
        case 'retired':
            return item.isRetired;
        case 'thin':
            return item.sampleSize < THIN_SAMPLE;
        default:
            return true;
    }
}

// Mirrors THIN_SAMPLE in the items route. Duplicated deliberately: the client
// filters the rows it already has, and a round trip to re-ask the server which
// rows are thin would be worse than restating one number.
const THIN_SAMPLE = 40;

/** Discrimination in words, so the number is not the only signal. */
function discriminationLabel(a: number | null): { text: string; tone: string } {
    if (a === null) return { text: 'not fitted', tone: 'text-slate-500' };
    if (a < 0.15) return { text: 'measures nothing', tone: 'text-red-400' };
    if (a < 0.5) return { text: 'weak', tone: 'text-amber-400' };
    if (a <= 2.5) return { text: 'good', tone: 'text-emerald-400' };
    return { text: 'very steep', tone: 'text-amber-400' };
}

function fmt(value: number | null, digits = 2): string {
    return value === null ? '—' : value.toFixed(digits);
}

export default function CalibrationView({
    bank, onCalibrated,
}: {
    bank: ItemBank;
    onCalibrated: () => Promise<void> | void;
}) {
    const [filter, setFilter] = useState<Filter>('all');
    const [confirming, setConfirming] = useState(false);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<CalibrationResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const visible = useMemo(
        () => bank.items.filter((item) => matchesFilter(item, filter)),
        [bank.items, filter]
    );

    const runCalibration = async () => {
        setRunning(true);
        setError(null);
        setResult(null);
        try {
            const outcome = await AdminApi.calibrate();
            setResult(outcome);
            setConfirming(false);
            // Re-read the bank so the table reflects what was just fitted rather
            // than the pre-calibration snapshot the operator was looking at.
            await onCalibrated();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Calibration failed.');
        } finally {
            setRunning(false);
        }
    };

    return (
        <div className="space-y-5">
            {/* ── Bank state ─────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={Gauge} label="Items in bank" value={bank.totals.items} sub="fitted from answer history" color="border-brand-500/20" delay={0} />
                <StatCard icon={CheckCircle2} label="Live" value={bank.totals.live} sub={`${bank.totals.retired} retired`} color="border-emerald-500/20" delay={0.05} />
                <StatCard icon={AlertTriangle} label="Needs attention" value={bank.totals.withConcerns} sub="small samples or weak discrimination" color="border-amber-500/20" delay={0.1} />
                <StatCard icon={Sparkles} label="Small sample" value={bank.totals.thinSamples} sub={`under ${bank.thresholds.thinSample} responses — a re-fit could move these`} color="border-blue-500/20" delay={0.15} />
            </div>

            {/* ── What calibration does, and the action ──────────────────── */}
            <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] shadow-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 max-w-2xl">
                        <h2 className="font-semibold text-[color:var(--text)] text-sm">Re-fit item parameters</h2>
                        <p className="mt-1 text-xs leading-relaxed text-[color:var(--muted)]">
                            Estimates each item&apos;s difficulty, discrimination and guessing from the
                            accumulated response history, and retires items that cannot measure anything.
                            An item needs at least <strong>{bank.thresholds.minSampleSize}</strong> responses
                            before its parameters are fitted; below that it keeps its previous values and is
                            reported as skipped rather than fitted from noise.
                        </p>
                        <p className="mt-2 flex items-start gap-1.5 text-xs text-[color:var(--muted)]">
                            <Info size={13} className="mt-0.5 shrink-0" />
                            This reads the response history into memory, so it is an explicit action rather
                            than something on a schedule. It never modifies a candidate&apos;s stored scores,
                            and it is safe to run repeatedly.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={() => setConfirming(true)}
                        disabled={running || bank.totals.items === 0}
                        className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
                    >
                        {running ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                        {running ? 'Calibrating…' : 'Run calibration'}
                    </button>
                </div>

                {bank.totals.items === 0 && (
                    <p className="mt-3 text-xs text-[color:var(--muted)]">
                        The bank is empty. An item enters it once at least {bank.thresholds.minSampleSize}{' '}
                        responses have accumulated for it — normally after a few completed interviews. This
                        is a normal early state, not a fault.
                    </p>
                )}

                {/* A re-fit is not a destructive action, but it is a slow one that
                    rewrites the instrument, so it is confirmed rather than instant. */}
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
                                    Re-fit all {bank.totals.items} item{bank.totals.items === 1 ? '' : 's'} now?
                                </p>
                                <p className="mt-1 text-xs text-[color:var(--muted)]">
                                    Item parameters will be overwritten from the current response history, and
                                    items that no longer measure anything will be retired. Candidate scores are
                                    not affected.
                                </p>
                                <div className="mt-3 flex gap-2">
                                    <button
                                        type="button"
                                        onClick={runCalibration}
                                        className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-500"
                                    >
                                        Yes, re-fit the bank
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
                        <p className="text-sm font-medium text-[color:var(--text)]">Calibration finished</p>
                        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                            <Outcome label="Items considered" value={result.summary.itemsConsidered} />
                            <Outcome label="Fitted" value={result.summary.itemsCalibrated} />
                            <Outcome label="Skipped (small sample)" value={result.summary.itemsSkipped} />
                            <Outcome label="Newly retired" value={result.summary.itemsNewlyRetired} />
                            <Outcome label="Brought back" value={result.summary.itemsUnretired} />
                            <Outcome label="Unattributable answers" value={result.summary.unattributableResponses} />
                        </div>
                        {result.note && (
                            <p className="mt-2 text-xs text-[color:var(--muted)]">{result.note}</p>
                        )}
                        {result.summary.unattributableResponses > 0 && (
                            <p className="mt-2 flex items-start gap-1.5 text-xs text-[color:var(--muted)]">
                                <Info size={13} className="mt-0.5 shrink-0" />
                                An answer is unattributable when its question carries neither a competency nor
                                a category. A rising count here means question generation is not tagging its
                                output, and those answers cannot contribute to anyone&apos;s ability estimate.
                            </p>
                        )}
                    </div>
                )}
            </div>

            {/* ── The bank ───────────────────────────────────────────────── */}
            <div className="flex flex-wrap gap-2">
                {FILTERS.map((f) => {
                    const count =
                        f.key === 'all' ? bank.items.length : bank.items.filter((i) => matchesFilter(i, f.key)).length;
                    return (
                        <button
                            key={f.key}
                            type="button"
                            onClick={() => setFilter(f.key)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                                filter === f.key
                                    ? 'bg-[color:var(--brand-soft)] text-[color:var(--brand-strong)]'
                                    : 'text-[color:var(--muted)] hover:bg-[color:var(--surface-soft)] hover:text-[color:var(--text)]'
                            }`}
                        >
                            {f.label} <span className="opacity-60">{count}</span>
                        </button>
                    );
                })}
            </div>

            <div className={tableWrap}>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-[color:var(--line)] bg-[color:var(--surface-soft)]">
                                <th className={th}>Item</th>
                                <th className={th}>Difficulty</th>
                                <th className={th}>Discrimination</th>
                                <th className={`${th} hidden md:table-cell`}>Guessing</th>
                                <th className={th}>Responses</th>
                                <th className={th}>State</th>
                                <th className={`${th} hidden lg:table-cell`}>Fitted</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[color:var(--line)]">
                            {visible.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-[color:var(--muted)]">
                                        {bank.items.length === 0
                                            ? 'The item bank is empty — nothing has been answered yet.'
                                            : 'No item matches this filter.'}
                                    </td>
                                </tr>
                            )}
                            {visible.map((item) => {
                                const disc = discriminationLabel(item.a);
                                return (
                                    <tr key={item.itemKey} className="align-top hover:bg-[color:var(--surface-soft)]">
                                        <td className="max-w-[360px] px-4 py-3">
                                            <p className="text-sm text-[color:var(--text)]" title={item.sampleText}>
                                                {item.label || <span className="text-[color:var(--muted)]">unidentifiable text</span>}
                                            </p>
                                            <p className="mt-0.5 text-xs text-[color:var(--muted)]">
                                                {item.category || 'uncategorised'}
                                                {item.proportionCorrect !== null &&
                                                    ` · ${Math.round(item.proportionCorrect * 100)}% answered correctly`}
                                            </p>
                                        </td>
                                        <td className="px-4 py-3 tabular-nums text-[color:var(--text)]">{fmt(item.b)}</td>
                                        <td className="px-4 py-3">
                                            <span className="tabular-nums text-[color:var(--text)]">{fmt(item.a)}</span>
                                            <span className={`ml-2 text-xs ${disc.tone}`}>{disc.text}</span>
                                        </td>
                                        <td className={`${'px-4 py-3 tabular-nums text-[color:var(--text)]'} hidden md:table-cell`}>
                                            {fmt(item.c)}
                                        </td>
                                        <td className="px-4 py-3 tabular-nums text-[color:var(--text)]">
                                            {item.sampleSize}
                                            {item.sampleSize < bank.thresholds.thinSample && (
                                                <span className="ml-1 text-xs text-amber-400">thin</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            {item.isRetired ? (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--danger-soft)] px-2 py-0.5 text-xs text-[color:var(--danger)]">
                                                    <ShieldAlert size={11} /> retired
                                                </span>
                                            ) : item.usable ? (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-500">
                                                    <CheckCircle2 size={11} /> usable
                                                </span>
                                            ) : (
                                                <span
                                                    className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-500"
                                                    title={item.concerns.join('; ')}
                                                >
                                                    <AlertTriangle size={11} /> {item.concerns[0]}
                                                </span>
                                            )}
                                        </td>
                                        <td className={`${'px-4 py-3 text-xs text-[color:var(--muted)]'} hidden lg:table-cell`}>
                                            {item.calibratedAt ? formatDateTime(item.calibratedAt) : 'never'}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {bank.truncated && (
                <p className="text-xs text-[color:var(--muted)]">
                    Showing the {bank.returned} most-answered items. {bank.totals.items - bank.returned} more are
                    in the bank.
                </p>
            )}
        </div>
    );
}

function Outcome({ label, value }: { label: string; value: number }) {
    return (
        <p className="flex justify-between gap-2">
            <span className="text-[color:var(--muted)]">{label}</span>
            <span className="tabular-nums font-medium text-[color:var(--text)]">{value}</span>
        </p>
    );
}
