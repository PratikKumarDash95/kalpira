// ============================================
// trendMath.ts — counting a theme over time, and knowing when not to
// ============================================
// Pure. No database, no network, no clock — every range is passed in, so a trend is
// a function of the data and the window rather than of when it was run.
//
// THE TWO KINDS OF NOTHING
//
// This is the module where "null, never 0" needs the most care, because here a zero
// is usually a real measurement and only sometimes a lie.
//
//   · A period with no occurrences of a theme is a real, meaningful zero. "Nobody
//     raised pricing in August" is a finding. It must be plotted as 0.
//
//   · A period the corpus does not cover — before the first interview was indexed,
//     or during a stretch that was never swept — has no count. It is not zero
//     occurrences; it is no observation. It must be *absent*, or the chart will draw
//     a flat line through a period nobody looked at and a reader will read it as
//     stability.
//
// So `buildSeries` reports `count` as a number for every period in the range, and
// separately reports whether the range was actually covered. The caller decides what
// to draw; what it cannot do is mistake one for the other, because the shape does not
// let it.

import { computed, refused } from '../measured';
import type { Measured, MeasuredNumber } from '../measured';
import {
    MIN_TREND_POINTS,
    STAGNATION_PERIODS,
    STAGNATION_SLOPE_BAND,
    TREND_REGRESSION_SLOPE,
} from './contract';

export type Granularity = 'month' | 'quarter';

/** A trend direction, or the refusal that there is not enough to say. */
export type Direction = 'rising' | 'flat' | 'falling';

/**
 * The bucket a date falls in, as a sortable key.
 *
 * Both forms — `2026-09` and `2026-Q3` — sort lexicographically in chronological
 * order, so periods can be ordered without parsing them back. UTC throughout:
 * a timestamp near midnight on the first of a month must not land in the previous
 * month because the server happens to run in a negative-offset timezone, which would
 * make a period's count depend on where the deployment is hosted.
 */
export function periodKey(at: Date | string | number, granularity: Granularity): string {
    const date = at instanceof Date ? at : new Date(at);
    const year = date.getUTCFullYear();
    if (granularity === 'quarter') {
        return `${year}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
    }
    return `${year}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** One period of a series. */
export interface Period {
    period: string;
    /** Occurrences in this period. A real zero when the period was covered. */
    count: number;
}

export interface Series {
    periods: Period[];
    granularity: Granularity;
    /** Length of the range in periods, whether or not any were observed. */
    length: number;
}

/**
 * The periods from `from` to `to` inclusive, in order.
 *
 * Every period in the range appears. A gap is not skipped — skipping it would let a
 * chart connect June to October with a straight line, which reads as a smooth change
 * across a period that was never counted.
 */
export function periodRange(from: Date | string | number, to: Date | string | number, granularity: Granularity): string[] {
    const start = from instanceof Date ? from : new Date(from);
    const end = to instanceof Date ? to : new Date(to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

    const step = granularity === 'quarter' ? 3 : 1;

    // Begin at the first month of the bucket the range starts in, not at the start
    // month itself. A range beginning in August starts inside Q3, and stepping from
    // August by quarters would reach October and skip the quarter it began in.
    const startMonth = granularity === 'quarter'
        ? Math.floor(start.getUTCMonth() / 3) * 3
        : start.getUTCMonth();

    const cursor = new Date(Date.UTC(start.getUTCFullYear(), startMonth, 1));
    const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));

    const periods: string[] = [];

    // Bounded so a reversed or absurd range terminates rather than looping. 1200
    // buckets is a century of months, or three centuries of quarters.
    for (let guard = 0; cursor.getTime() <= last.getTime() && guard < 1200; guard += 1) {
        periods.push(periodKey(cursor, granularity));
        cursor.setUTCMonth(cursor.getUTCMonth() + step);
    }

    return periods;
}

/**
 * Count occurrences into periods.
 *
 * `count` is always a number, and zero is a real answer — see the note at the top of
 * this file. Occurrences that fall outside the range are not silently dropped: the
 * returned `outside` count lets a caller notice that its window was wrong rather than
 * quietly reporting a smaller total.
 */
export function buildSeries(
    occurrences: Array<Date | string | number>,
    from: Date | string | number,
    to: Date | string | number,
    granularity: Granularity = 'month',
): Measured<Series & { outside: number; undated: number }> {
    const periods = periodRange(from, to, granularity);
    if (periods.length === 0) {
        return refused('the range could not be read as two dates, or it ended before it began');
    }

    const counts = new Map<string, number>();
    for (const period of periods) counts.set(period, 0);

    let outside = 0;
    let undated = 0;

    for (const occurrence of occurrences) {
        const date = occurrence instanceof Date ? occurrence : new Date(occurrence);
        if (Number.isNaN(date.getTime())) {
            undated += 1;
            continue;
        }
        const key = periodKey(date, granularity);
        if (!counts.has(key)) {
            outside += 1;
            continue;
        }
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return computed({
        periods: periods.map((period) => ({ period, count: counts.get(period) ?? 0 })),
        granularity,
        length: periods.length,
        outside,
        undated,
    });
}

/** The counts of a series, in order. */
export function toCounts(series: Series): number[] {
    return series.periods.map((period) => period.count);
}

/**
 * Least-squares slope of y against its index.
 *
 * x is the position in the series (0, 1, 2 …), not the calendar date. The spacing of
 * a series built by `buildSeries` is uniform by construction, so index and time are
 * proportional, and using the index keeps the slope in the unit a reader wants:
 * occurrences per period.
 *
 * Refused below three points. Two points always lie on a line, so the fit would
 * restate the data while appearing to be a finding about it.
 */
export function slope(counts: number[]): MeasuredNumber {
    if (counts.length < MIN_TREND_POINTS) {
        return refused(
            `${counts.length} ${counts.length === 1 ? 'period' : 'periods'} of data, and a slope needs at least ${MIN_TREND_POINTS} — two points always lie on a line`,
        );
    }
    if (!counts.every((value) => Number.isFinite(value))) {
        return refused('the series contained a value that is not a finite number');
    }

    const n = counts.length;
    const meanX = (n - 1) / 2;
    const meanY = counts.reduce((sum, value) => sum + value, 0) / n;

    let numerator = 0;
    let denominator = 0;
    for (let index = 0; index < n; index += 1) {
        numerator += (index - meanX) * (counts[index] - meanY);
        denominator += (index - meanX) ** 2;
    }

    // Denominator is zero only when every x is identical, which cannot happen for a
    // series of distinct indices. Guarded anyway so the function cannot return NaN.
    if (denominator === 0) {
        return refused('the series had no spread in time, so it has no slope');
    }

    return computed(numerator / denominator);
}

/**
 * Which way a series is going, given a band of flatness.
 *
 * The band is what stops every series from being a finding. A slope of +0.4
 * occurrences per month is not growth; over a year it is five occurrences, and
 * calling that a rise trains a reader to ignore the direction column entirely.
 */
export function direction(value: number, band: number = STAGNATION_SLOPE_BAND): Measured<Direction> {
    if (!Number.isFinite(value)) {
        return refused('the slope was not a finite number');
    }
    if (value > band) return computed('rising');
    if (value < -band) return computed('falling');
    return computed('flat');
}

/**
 * Change from the first period to the last, as a fraction.
 *
 * Refused when the first period is zero, and this refusal is the interesting one.
 * A theme that went from 0 to 4 occurrences has grown, but not by any percentage —
 * the ratio has no value, and code that computes it anyway returns Infinity or NaN,
 * both of which render as a figure. The refusal says what happened instead: there is
 * no baseline to measure against. The absolute change is a separate, always-available
 * number, and callers should show that.
 */
export function percentChange(counts: number[]): MeasuredNumber {
    if (counts.length < 2) {
        return refused(`${counts.length} of 2 periods needed to compare a first with a last`);
    }
    const first = counts[0];
    const last = counts[counts.length - 1];
    if (!Number.isFinite(first) || !Number.isFinite(last)) {
        return refused('the series contained a value that is not a finite number');
    }
    if (first === 0) {
        return refused(
            `the first period had no occurrences${last > 0 ? ` and the last had ${last}` : ''}, so there is no baseline to measure a change against`,
        );
    }
    return computed((last - first) / first);
}

/** The absolute change from first to last. Unlike a percentage, always defined. */
export function absoluteChange(counts: number[]): MeasuredNumber {
    if (counts.length < 2) {
        return refused(`${counts.length} of 2 periods needed to compare a first with a last`);
    }
    return computed(counts[counts.length - 1] - counts[0]);
}

/**
 * Whether a series has stopped moving.
 *
 * Requires `STAGNATION_PERIODS` consecutive periods whose period-on-period change is
 * inside the band. Consecutive matters: a series that is flat, jumps, and is flat
 * again is not stalled, it is noisy, and reporting the second flat stretch as
 * stagnation would describe the pause rather than the movement.
 */
export function detectStagnation(
    counts: number[],
    options: { band?: number; periods?: number } = {},
): Measured<{ stalled: boolean; since: string | null; runLength: number }> {
    const band = options.band ?? STAGNATION_SLOPE_BAND;
    const required = options.periods ?? STAGNATION_PERIODS;

    if (counts.length < required + 1) {
        return refused(
            `${counts.length} periods of data, and detecting a stall needs ${required + 1} — ${required} unchanged steps plus the step before them`,
        );
    }

    let run = 0;
    let longestRun = 0;
    let runStart = -1;
    let longestStart = -1;

    for (let index = 1; index < counts.length; index += 1) {
        const delta = Math.abs(counts[index] - counts[index - 1]);
        if (delta <= band) {
            if (run === 0) runStart = index - 1;
            run += 1;
            if (run > longestRun) {
                longestRun = run;
                longestStart = runStart;
            }
        } else {
            run = 0;
            runStart = -1;
        }
    }

    const stalled = longestRun >= required;
    return computed({
        stalled,
        since: stalled ? String(longestStart) : null,
        runLength: longestRun,
    });
}

/**
 * Whether a series is declining enough to act on.
 *
 * Both conditions must hold: the fitted slope must be below the threshold, and the
 * last period must be below the first. A slope alone can be pulled negative by one
 * early spike while the series is recovering, and a series that has recovered is not
 * a regression a reader needs to be told about.
 */
export function detectRegression(
    counts: number[],
    threshold: number = TREND_REGRESSION_SLOPE,
): Measured<{ declining: boolean; slope: number }> {
    const fitted = slope(counts);
    if (fitted.state !== 'computed') return fitted;

    const net = counts[counts.length - 1] - counts[0];
    return computed({ declining: fitted.value < threshold && net < 0, slope: fitted.value });
}

/** Everything a trends row needs, computed once. */
export interface TrendSummary {
    points: number;
    total: number;
    slope: MeasuredNumber;
    direction: Measured<Direction>;
    percentChange: MeasuredNumber;
    absoluteChange: MeasuredNumber;
    stagnation: Measured<{ stalled: boolean; since: string | null; runLength: number }>;
    regression: Measured<{ declining: boolean; slope: number }>;
}

/**
 * Summarise a series. Never throws and never returns a bare number: every derived
 * figure is a `Measured`, so a caller that wants to print one has to handle the case
 * where there is nothing to print.
 */
export function summarise(counts: number[]): TrendSummary {
    return {
        points: counts.length,
        total: counts.reduce((sum, value) => sum + value, 0),
        slope: slope(counts),
        direction: (() => {
            const fitted = slope(counts);
            return fitted.state === 'computed' ? direction(fitted.value) : fitted;
        })(),
        percentChange: percentChange(counts),
        absoluteChange: absoluteChange(counts),
        stagnation: detectStagnation(counts),
        regression: detectRegression(counts),
    };
}
