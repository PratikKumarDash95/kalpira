// ============================================
// trendService.ts — a theme counted over time, with both kinds of nothing kept apart
// ============================================
// The orchestration half of `trendMath.ts`. That file decides what a series MEANS; this one
// decides which periods it covers, reads the occurrences, and stores the result as a snapshot.
//
// THE COVERAGE RULE, WHICH IS THE WHOLE FILE
//
// `trendMath.ts` states the problem: a period with no occurrences is a real zero, and a period
// nobody looked at is absent, and drawing them the same way is a lie about one of them. The
// store has to carry that distinction, so here is how it is decided.
//
//   A period is COVERED when at least one theme occurrence in the scope falls in it. It is
//   stored as its count, which is a number — usually 0, and 0 is the answer.
//
//   A period is NOT COVERED when the scope recorded nothing in it at all. It is stored as a
//   null value with the reason, and the reason says what is actually known: that no theme
//   occurrence was recorded in that period. It does not claim the period was never indexed,
//   because from this table that cannot be told apart from a period whose interviews named no
//   themes. Naming the ambiguity is the honest option; the alternative is to pick one of two
//   facts and state it with confidence.
//
// THE REPORTED SUMMARY IS FITTED OVER COVERED PERIODS ONLY
//
// A slope through a series is only a slope through the periods that were counted. Filling an
// uncovered period with 0 to make the series uniform would drag every trend line toward flat
// in proportion to how much of the corpus was never indexed — a defect that reads as stability.
// So `summarise` sees the covered counts alone, and the uncovered periods are reported beside
// the summary by name.
//
// WHO GETS A SERIES
//
// A cluster with at least one occurrence in the window. A cluster that had none is not a
// series of zeros — it is a theme the window says nothing about — and it is counted and
// reported as skipped rather than drawn flat across the chart.

import supabaseDb from '../supabaseDb';
import { computed, refused, present } from '../measured';
import type { Measured } from '../measured';
import {
    buildSeries,
    periodKey,
    periodRange,
    summarise,
    type Direction,
    type Granularity,
} from './trendMath';
import { TREND_CAVEATS } from './contract';
import { resolveScope, type ThemeScope } from './themeService';

export const DEFAULT_TREND_MONTHS = 12;
export const MAX_TREND_PERIODS = 60;

// --------------------------------------------
// Computing
// --------------------------------------------

export interface ComputeTrendsParams {
    scope: ThemeScope;
    scopeKey?: string | null;
    from: Date | string;
    to: Date | string;
    granularity?: Granularity;
    /** Only these clusters. Omitted, every cluster active in the window. */
    clusterIds?: string[] | null;
    /** Bounds one computation, newest clusters by activity first. */
    limit?: number;
}

export interface TrendOutcome {
    scope: ThemeScope;
    scopeKey: string;
    granularity: Granularity;
    from: string;
    to: string;
    periods: string[];
    /** Periods where the scope recorded nothing. Every one of them is stored as null. */
    uncoveredPeriods: string[];
    periodsCovered: number;
    clustersInScope: number;
    clustersComputed: number;
    /** Clusters with no occurrence in the window, so they have no series here. */
    clustersSkipped: number;
    pointsWritten: number;
    pointsUnchanged: number;
    pointsUnchangedNote: string | null;
    occurrencesUsed: number;
    occurrencesOutsideWindow: number;
    undatedOccurrences: number;
    caveats: string[];
}

/**
 * Counts a scope's themes per period and stores the series.
 *
 * Idempotent, and cheap to re-run: a period whose stored value and reason already match what
 * this computation produced is left untouched, so `computedAt` on a row means "when this
 * period's value was last established" rather than "when the sweep last ran". Rewriting every
 * row on every sweep would make the column meaningless and turn a no-op sweep into hundreds of
 * writes.
 *
 * A window that cannot be read as two dates, or that ends before it begins, is refused rather
 * than defaulted — a trend over a range the caller did not ask for is worse than no trend.
 */
export async function computeTrends(params: ComputeTrendsParams): Promise<Measured<TrendOutcome>> {
    const scopeRef = resolveScope(params.scope, params.scopeKey);
    if (scopeRef.state !== 'computed') return scopeRef;
    const { scope, scopeKey } = scopeRef.value;

    const granularity: Granularity = params.granularity === 'quarter' ? 'quarter' : 'month';

    const periods = periodRange(params.from, params.to, granularity);
    if (periods.length === 0) {
        return refused('the trend window could not be read as two dates, or it ended before it began');
    }
    if (periods.length > MAX_TREND_PERIODS) {
        return refused(
            `${periods.length} periods were asked for in one window, and a trend computation is capped at ${MAX_TREND_PERIODS} — a wider range is a question about a different corpus, not a longer chart`,
        );
    }

    const from = new Date(params.from);
    const to = new Date(params.to);

    const occurrenceRows = (await supabaseDb.themeOccurrence.findMany({
        where: { scope, scopeKey },
    })) as Array<Record<string, any>>;

    const clusterRows = (await supabaseDb.themeCluster.findMany({
        where: { scope, scopeKey },
    })) as Array<Record<string, any>>;

    const occurrenceDates: Date[] = [];
    const datesByCluster = new Map<string, Date[]>();

    for (const row of occurrenceRows) {
        const observedAt = readDate(row.observedAt);
        if (!observedAt) continue; // counted by `buildSeries` below, which reports them as undated
        occurrenceDates.push(observedAt);

        const clusterId = row.clusterId ? String(row.clusterId) : '';
        if (!clusterId) continue; // unclustered themes have no series to belong to
        const list = datesByCluster.get(clusterId);
        if (list) list.push(observedAt);
        else datesByCluster.set(clusterId, [observedAt]);
    }

    // The scope's own totals per period — this is what decides coverage. Counting them
    // separately from each cluster's series is the point: the periods a theme was silent in
    // are exactly the periods the scope was not.
    const scopeSeries = buildSeries(occurrenceDates, params.from, params.to, granularity);
    if (scopeSeries.state !== 'computed') return scopeSeries;

    const scopeTotals = new Map<string, number>();
    for (const period of scopeSeries.value.periods) scopeTotals.set(period.period, period.count);

    const periodSet = new Set(periods);
    const uncoveredPeriods = scopeSeries.value.periods.filter((period) => period.count === 0).map((p) => p.period);
    const covered = new Set(periods.filter((period) => !uncoveredPeriods.includes(period)));

    // A cluster is in the window when it raised at least one theme whose period is in it.
    // Occurrences outside the window are counted by `buildSeries` rather than here, so the two
    // figures a reader sees — "used" and "outside the window" — are the same arithmetic.
    const clusterIdsInWindow = new Set<string>();
    for (const [clusterId, dates] of datesByCluster) {
        for (const date of dates) {
            if (periodSet.has(periodKey(date, granularity))) {
                clusterIdsInWindow.add(clusterId);
                break;
            }
        }
    }

    const requested = params.clusterIds && params.clusterIds.length > 0 ? new Set(params.clusterIds) : null;
    const targets = clusterRows
        .filter((row) => clusterIdsInWindow.has(String(row.id)))
        .filter((row) => !requested || requested.has(String(row.id)));

    const outcome: TrendOutcome = {
        scope,
        scopeKey,
        granularity,
        from: from.toISOString(),
        to: to.toISOString(),
        periods,
        uncoveredPeriods,
        periodsCovered: periods.length - uncoveredPeriods.length,
        clustersInScope: clusterRows.length,
        clustersComputed: targets.length,
        clustersSkipped: clusterRows.length - targets.length,
        pointsWritten: 0,
        pointsUnchanged: 0,
        pointsUnchangedNote: null,
        occurrencesUsed: occurrenceDates.length,
        occurrencesOutsideWindow: scopeSeries.value.outside,
        undatedOccurrences: scopeSeries.value.undated,
        caveats: [...TREND_CAVEATS],
    };

    if (targets.length === 0) {
        outcome.caveats.push('No cluster raised a theme inside this window, so there is no series to show.');
        return computed(outcome);
    }

    const limit = Math.max(1, Math.min(params.limit ?? 200, 1000));
    const selected = targets.slice(0, limit);
    outcome.clustersComputed = selected.length;
    outcome.clustersSkipped = clusterRows.length - selected.length;

    // Existing rows for the scope, read once so an unchanged period is not rewritten.
    const stored = (await supabaseDb.trendSnapshot.findMany({
        where: { scope, scopeKey },
    })) as Array<Record<string, any>>;
    const storedByPoint = new Map<string, Record<string, any>>();
    for (const row of stored) {
        storedByPoint.set(pointKey(String(row.key ?? ''), String(row.period ?? '')), row);
    }

    const inserts: Array<Record<string, any>> = [];

    for (const cluster of selected) {
        const key = String(cluster.id);
        const label = String(cluster.label ?? '');
        const dates = datesByCluster.get(key) ?? [];

        const series = buildSeries(dates, params.from, params.to, granularity);
        if (series.state !== 'computed') continue;

        const countsByPeriod = new Map<string, number>();
        for (const period of series.value.periods) countsByPeriod.set(period.period, period.count);

        for (const period of periods) {
            const isCovered = covered.has(period);
            const value = isCovered ? (countsByPeriod.get(period) ?? 0) : null;
            const sampleCount = isCovered ? (scopeTotals.get(period) ?? 0) : null;
            const reason = isCovered
                ? null
                : 'no theme occurrence was recorded in this period, so the period was not counted — which is not the same as a period in which the theme was absent';

            const existingRow = storedByPoint.get(pointKey(key, period));

            if (existingRow) {
                const same =
                    numberOrNull(existingRow.value) === value &&
                    numberOrNull(existingRow.sampleCount) === sampleCount &&
                    stringOrNull(existingRow.notComputableReason) === reason &&
                    String(existingRow.label ?? '') === label;
                if (same) {
                    outcome.pointsUnchanged += 1;
                    continue;
                }
                await supabaseDb.trendSnapshot.update({
                    where: { id: String(existingRow.id) },
                    data: {
                        label,
                        value,
                        sampleCount,
                        notComputableReason: reason,
                        computedAt: new Date().toISOString(),
                    },
                });
                outcome.pointsWritten += 1;
                continue;
            }

            inserts.push({
                scope,
                scopeKey,
                key,
                label,
                period,
                value,
                sampleCount,
                notComputableReason: reason,
                computedAt: new Date().toISOString(),
            });
        }
    }

    if (inserts.length > 0) {
        await supabaseDb.trendSnapshot.createMany({ data: inserts });
        outcome.pointsWritten += inserts.length;
    }

    if (outcome.pointsUnchanged > 0) {
        outcome.pointsUnchangedNote = `${outcome.pointsUnchanged} stored ${outcome.pointsUnchanged === 1 ? 'period was' : 'periods were'} already correct and left untouched, so their computedAt still records when their value was established.`;
    }
    if (outcome.undatedOccurrences > 0) {
        outcome.caveats.push(
            `${outcome.undatedOccurrences} ${outcome.undatedOccurrences === 1 ? 'occurrence has' : 'occurrences have'} no readable date and could not be placed in any period.`,
        );
    }
    if (outcome.clustersSkipped > 0) {
        outcome.caveats.push(
            `${outcome.clustersSkipped} ${outcome.clustersSkipped === 1 ? 'cluster raised' : 'clusters raised'} no theme inside this window, so no series was computed for ${outcome.clustersSkipped === 1 ? 'it' : 'them'} — a cluster with no occurrences here is not a series of zeros.`,
        );
    }

    return computed(outcome);
}

// --------------------------------------------
// Reading
// --------------------------------------------

/** A trend period as a reader consumes it: the value, or the reason there is none. */
export interface TrendPoint {
    period: string;
    value: number | null;
    notComputableReason: string | null;
    /** Occurrences of every theme in the scope that period — the denominator behind `value`. */
    sampleCount: number | null;
}

export interface TrendSeriesView {
    key: string;
    label: string;
    points: TrendPoint[];
    /** Only the counted periods, in order. This is what the summary was fitted over. */
    counts: number[];
    uncoveredPeriods: string[];
    total: number;
    latestPeriod: string | null;
    summary: TrendSummaryView;
    computedAt: string | null;
}

/** The series-level figures, each as a value or the reason it has none. */
export interface TrendSummaryView {
    points: number;
    total: number;
    slope: { value: number | null; notComputableReason: string | null };
    direction: { value: Direction | null; notComputableReason: string | null };
    percentChange: { value: number | null; notComputableReason: string | null };
    absoluteChange: { value: number | null; notComputableReason: string | null };
    stagnation: {
        value: { stalled: boolean; since: string | null; runLength: number } | null;
        notComputableReason: string | null;
    };
    regression: { value: { declining: boolean; slope: number } | null; notComputableReason: string | null };
    /** The periods the fit used. Fewer than the window means some were never counted. */
    fittedOver: string[];
}

export interface TrendListing {
    scope: ThemeScope;
    scopeKey: string;
    series: TrendSeriesView[];
    total: number;
    caveats: string[];
}

/**
 * A scope's stored trends, summarised.
 *
 * The summary is fitted here rather than stored, from the periods that carry a value. The
 * stored rows are the snapshot — they are what was true when they were computed — and the
 * arithmetic over them is cheap and pure, so recomputing it on read costs nothing and cannot
 * drift from the values a reader is looking at.
 */
export async function listTrends(params: {
    scope: ThemeScope;
    scopeKey?: string | null;
    from?: Date | string | null;
    to?: Date | string | null;
    limit?: number;
}): Promise<Measured<TrendListing>> {
    const scopeRef = resolveScope(params.scope, params.scopeKey);
    if (scopeRef.state !== 'computed') return scopeRef;

    const rows = (await supabaseDb.trendSnapshot.findMany({
        where: { scope: scopeRef.value.scope, scopeKey: scopeRef.value.scopeKey },
    })) as Array<Record<string, any>>;

    const fromPeriod = params.from ? firstPeriodOf(params.from) : null;
    const toPeriod = params.to ? firstPeriodOf(params.to) : null;

    const byKey = new Map<string, Array<Record<string, any>>>();
    for (const row of rows) {
        const period = String(row.period ?? '');
        // Period keys sort lexicographically in chronological order, so a range filter is a
        // string comparison and needs no parsing. `2026-Q3` after `2026-09` is the one case
        // that would sort wrongly across granularities, which is why the filter compares
        // within the granularity the rows were written with.
        if (fromPeriod && period.length === fromPeriod.length && period < fromPeriod) continue;
        if (toPeriod && period.length === toPeriod.length && period > toPeriod) continue;

        const key = String(row.key ?? '');
        const list = byKey.get(key);
        if (list) list.push(row);
        else byKey.set(key, [row]);
    }

    const series: TrendSeriesView[] = [];
    for (const [key, points] of byKey) {
        const ordered = [...points].sort((left, right) =>
            String(left.period ?? '').localeCompare(String(right.period ?? '')),
        );

        const view: TrendPoint[] = ordered.map((row) => ({
            period: String(row.period ?? ''),
            value: numberOrNull(row.value),
            notComputableReason: stringOrNull(row.notComputableReason),
            sampleCount: numberOrNull(row.sampleCount),
        }));

        const counted = view.filter((point) => point.value !== null);
        const counts = counted.map((point) => point.value as number);
        const summary = summarise(counts);

        series.push({
            key,
            // The label is carried on every row rather than joined from the cluster, so a
            // snapshot keeps the name the cluster had when the trend was computed. A cluster
            // renamed later does not rewrite history.
            label: String(ordered[0].label ?? ''),
            points: view,
            counts,
            uncoveredPeriods: view.filter((point) => point.value === null).map((point) => point.period),
            total: counts.reduce((sum, value) => sum + value, 0),
            latestPeriod: counted.length > 0 ? counted[counted.length - 1].period : null,
            summary: {
                points: summary.points,
                total: summary.total,
                slope: present(summary.slope),
                direction: present(summary.direction),
                percentChange: present(summary.percentChange),
                absoluteChange: present(summary.absoluteChange),
                stagnation: present(summary.stagnation),
                regression: present(summary.regression),
                fittedOver: counted.map((point) => point.period),
            },
            computedAt: isoOrNull(ordered[0].computedAt),
        });
    }

    series.sort((left, right) => {
        if (right.total !== left.total) return right.total - left.total;
        return left.label < right.label ? -1 : left.label > right.label ? 1 : 0;
    });

    const limit = Math.max(1, Math.min(params.limit ?? 100, 500));
    return computed({
        scope: scopeRef.value.scope,
        scopeKey: scopeRef.value.scopeKey,
        series: series.slice(0, limit),
        total: series.length,
        caveats: [...TREND_CAVEATS],
    });
}

/** The trend rows for one cluster, in period order. */
export async function trendForCluster(clusterId: string, limit = MAX_TREND_PERIODS): Promise<TrendSeriesView | null> {
    const rows = (await supabaseDb.trendSnapshot.findMany({ where: { key: clusterId } })) as Array<Record<string, any>>;
    if (rows.length === 0) return null;

    const ordered = [...rows]
        .sort((left, right) => String(left.period ?? '').localeCompare(String(right.period ?? '')))
        .slice(-Math.max(1, Math.min(limit, MAX_TREND_PERIODS)));

    const points: TrendPoint[] = ordered.map((row) => ({
        period: String(row.period ?? ''),
        value: numberOrNull(row.value),
        notComputableReason: stringOrNull(row.notComputableReason),
        sampleCount: numberOrNull(row.sampleCount),
    }));
    const counted = points.filter((point) => point.value !== null);
    const counts = counted.map((point) => point.value as number);
    const summary = summarise(counts);

    return {
        key: clusterId,
        label: String(ordered[0].label ?? ''),
        points,
        counts,
        uncoveredPeriods: points.filter((point) => point.value === null).map((point) => point.period),
        total: counts.reduce((sum, value) => sum + value, 0),
        latestPeriod: counted.length > 0 ? counted[counted.length - 1].period : null,
        summary: {
            points: summary.points,
            total: summary.total,
            slope: present(summary.slope),
            direction: present(summary.direction),
            percentChange: present(summary.percentChange),
            absoluteChange: present(summary.absoluteChange),
            stagnation: present(summary.stagnation),
            regression: present(summary.regression),
            fittedOver: counted.map((point) => point.period),
        },
        computedAt: isoOrNull(ordered[0].computedAt),
    };
}

/** A window ending now and reaching back `months`, rounded to whole months. */
export function defaultTrendWindow(months = DEFAULT_TREND_MONTHS, now: Date = new Date()): { from: Date; to: Date } {
    const span = Math.max(1, Math.min(months, MAX_TREND_PERIODS));
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (span - 1), 1));
    return { from, to: now };
}

// --------------------------------------------
// Small readers
// --------------------------------------------

function pointKey(key: string, period: string): string {
    return `${key}::${period}`;
}

/** The period a window boundary falls in, for filtering stored rows. */
function firstPeriodOf(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** A date from a column the shim has normalised, or null. */
function readDate(value: unknown): Date | null {
    if (value === null || value === undefined || value === '') return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date;
}

function isoOrNull(value: unknown): string | null {
    return readDate(value)?.toISOString() ?? null;
}

/** A stored double, or null. A NaN in the column reads as absent rather than as a number. */
function numberOrNull(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}
