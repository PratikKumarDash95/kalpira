// ============================================
// benchmarkMath.ts — percentiles, and the floor that suppresses them
// ============================================
// Pure. No database, no network, no clock.
//
// A percentile is unlike every other number in this feature. A similarity ranks two
// passages; a slope describes a series; a percentile describes *other people*. "You
// are at the 90th percentile" is a claim about the pool you were measured against,
// and when that pool is small the claim stops being about a group and starts being
// about identifiable individuals.
//
// So the floor here is a publication rule, not a statistical one, and it is enforced
// in this module rather than left to a caller. A p90 over three candidates, combined
// with a role and a study, narrows to a person. The refusal below the floor is the
// feature; the arithmetic above it is the easy part.
//
// This is also why the refusal states the count and the floor. "Not computed" invites
// a reader to assume a bug; "not computed: 3 candidates in this pool, and a benchmark
// is published from at least 5" tells them the system is protecting someone.

import { computed, refused } from '../measured';
import type { Measured } from '../measured';
import {
    BENCHMARK_PERCENTILES,
    MIN_BENCHMARK_COHORT,
} from './contract';

/**
 * The p-th percentile of an unsorted list, by linear interpolation between ranks.
 *
 * The interpolated definition (the same one R's `quantile(type = 7)` and NumPy
 * default to) rather than "nearest rank": with small pools, nearest-rank turns a
 * percentile into one of the sample values, so p50 and p75 can return the same
 * number and the reported spread collapses. Interpolation at least places the
 * estimate between observations.
 *
 * This does not make a small pool trustworthy, and it is not offered as a fix for
 * one — `summariseCohort` refuses those outright. It only keeps the arithmetic from
 * adding a second, avoidable distortion on top of a pool that is already adequate.
 */
export function percentile(values: number[], p: number): Measured<number> {
    if (!Array.isArray(values) || values.length === 0) {
        return refused('the pool was empty, so it has no percentiles');
    }
    if (!Number.isFinite(p) || p < 0 || p > 100) {
        return refused(`the requested percentile was ${p}, and a percentile must be between 0 and 100`);
    }
    if (!values.every((value) => Number.isFinite(value))) {
        return refused('the pool contained a value that is not a finite number');
    }

    const sorted = [...values].sort((left, right) => left - right);
    if (sorted.length === 1) return computed(sorted[0]);

    const rank = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(rank);
    const upper = Math.ceil(rank);
    if (lower === upper) return computed(sorted[lower]);

    const weight = rank - lower;
    return computed(sorted[lower] * (1 - weight) + sorted[upper] * weight);
}

/** The four percentiles a benchmark reports, or why it reports none. */
export interface CohortBenchmark {
    cohortSize: number;
    minCohortN: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
}

/**
 * Summarise a peer pool, or refuse to.
 *
 * The floor counts *scores*, not people, and the caller is responsible for passing
 * one score per person — a candidate with three sessions in the pool would be
 * counted three times, and a "pool of five" that is really two people is exactly the
 * de-anonymisation the floor exists to prevent. The service layer enforces one row
 * per user before calling this.
 */
export function summariseCohort(
    scores: number[],
    minCohortN: number = MIN_BENCHMARK_COHORT,
): Measured<CohortBenchmark> {
    if (!Array.isArray(scores)) {
        return refused('the pool was not a list of scores');
    }
    const usable = scores.filter((score) => Number.isFinite(score));

    if (usable.length < minCohortN) {
        return refused(
            `${usable.length} ${usable.length === 1 ? 'candidate' : 'candidates'} in this pool, and a benchmark is published from at least ${minCohortN} — below that a percentile describes individuals rather than a group`,
        );
    }

    // The pool cleared the floor, so each of these is computed. Each refusal is
    // returned as it comes rather than substituted: a benchmark with three of its
    // four percentiles is not a benchmark.
    const p25 = percentile(usable, 25);
    if (p25.state !== 'computed') return p25;
    const p50 = percentile(usable, 50);
    if (p50.state !== 'computed') return p50;
    const p75 = percentile(usable, 75);
    if (p75.state !== 'computed') return p75;
    const p90 = percentile(usable, 90);
    if (p90.state !== 'computed') return p90;

    return computed({
        cohortSize: usable.length,
        minCohortN,
        p25: p25.value,
        p50: p50.value,
        p75: p75.value,
        p90: p90.value,
    });
}

/**
 * Where one score sits in a pool, as a percentile rank in [0, 100].
 *
 * The share of the pool at or below the value, with half the ties counted — so a
 * score equal to every other score lands at 50, not at 100. Counting ties fully
 * would let the median candidate be told they are at the top of their pool.
 *
 * Refused for an empty pool. Unlike `summariseCohort` there is no floor here: this
 * describes the caller's own position and discloses nothing about anyone else, and
 * refusing to tell someone where they stand because too few peers exist would
 * withhold their own information from them. The caller labels it "not enough peers
 * to compare against" rather than presenting it as a stable benchmark.
 */
export function percentileRank(value: number, pool: number[]): Measured<number> {
    if (!Number.isFinite(value)) {
        return refused('the score was not a finite number');
    }
    const usable = (pool ?? []).filter((score) => Number.isFinite(score));
    if (usable.length === 0) {
        return refused('there were no peer scores to rank against');
    }

    let below = 0;
    let equal = 0;
    for (const score of usable) {
        if (score < value) below += 1;
        else if (score === value) equal += 1;
    }

    return computed(((below + equal / 2) / usable.length) * 100);
}

/**
 * Which of the reported percentiles a score sits at or above, for display.
 *
 * Returns null when the pool was suppressed, so the caller cannot render a band
 * label beside a benchmark that was never published.
 */
export function bandFor(value: number, benchmark: CohortBenchmark): 'p90+' | 'p75' | 'p50' | 'p25' | 'below p25' | null {
    if (!Number.isFinite(value)) return null;
    if (value >= benchmark.p90) return 'p90+';
    if (value >= benchmark.p75) return 'p75';
    if (value >= benchmark.p50) return 'p50';
    if (value >= benchmark.p25) return 'p25';
    return 'below p25';
}

/** The percentile labels a benchmark reports, for a table header. */
export function benchmarkPercentileLabels(): string[] {
    return BENCHMARK_PERCENTILES.map((p) => `p${p}`);
}
