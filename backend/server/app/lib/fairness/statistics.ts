// ============================================
// statistics.ts — the fairness maths, pure
// Feature 4 — Fairness, Bias & Compliance Audit
// ============================================
//
// Every function here is pure: no database, no network, no clock. verify-fairness.ts
// exercises all of it against hand-computed values.
//
// THE ONE RULE THAT SHAPES EVERY SIGNATURE BELOW
//
// No function returns a number it could not compute. Not `0`, not `NaN` passed along as
// though it were a value, not a silent fallback to a default. Each returns either a
// computed result or a refusal carrying the reason, and the caller cannot get at the
// number without first handling the refusal.
//
// This is not fastidiousness. Every figure below feeds a claim about a group of people, and
// the failure mode of a bare `0` is specific and bad: `0` is a legitimate value for a
// selection rate, a z-statistic, a chi-square and an effect size. So a function that
// returned `0` for "could not compute" would produce a number that is indistinguishable
// from a real measurement, flows into the four-fifths ratio as a real measurement, and
// appears in a compliance report as a real measurement. The project's non-negotiable is
// that a measurement is never fabricated; for a statistic that means the type has to make
// the fabricated answer unrepresentable, which is what `Measured<T>` does.
//
// WHY THE FLOORS ARE REFUSALS AND NOT WARNINGS
//
// A four-fifths ratio from a cohort of three is not a weak finding. It is a confident-looking
// number computed from nothing, and it is precisely the kind of number that ends a
// conversation about whether a process is fair — in whichever direction the reader already
// leaned. Below the floors these functions decline to produce a figure at all, and the
// reason string says how many people there were, so a reader sees "not computed: 3 scored
// answers in this cohort" where a warning would have let them see "0.33" and draw their own.

import {
    ALPHA,
    LARGE_EFFECT_SIZE,
    MIN_COHORT_N,
    MIN_ITEM_SCORED,
    MIN_SCORE_COVERAGE,
} from './contract';
// The refusal doctrine is the platform's rule rather than this feature's — Feature 5's
// trend and benchmark maths declines to produce a number for exactly the same reasons —
// so it lives in `../measured` and is re-exported here for every existing import site.
import { computed, refused } from '../measured';
import type { Computed, Refused, Measured, MeasuredNumber } from '../measured';

export { computed, refused };
export type { Computed, Refused, Measured, MeasuredNumber };

// --------------------------------------------
// The result type
// --------------------------------------------
//
// `Measured<T>`, `computed` and `refused` are imported and re-exported above; the
// explanation of why the discriminant is a string travels with the type in
// `../measured`, where Feature 5 reads it too.

// --------------------------------------------
// Elementary pieces
// --------------------------------------------

/**
 * Complementary error function (Numerical Recipes' Chebyshev fit).
 *
 * Accurate to a relative error of about 2e-15, measured against reference values, rather
 * than the ~1e-16 the fit would reach with its full complement of coefficients — the last
 * four of NR's 28 are dropped here. That remains far more precision than any p-value in
 * this module can use, where seven digits would do, but the figure is stated as measured
 * and not as the untruncated fit would give it, because a comment claiming full double
 * precision is a claim someone will eventually build on.
 *
 * Needed because both tests below are two-tailed and both reduce to it: the normal tail is
 * `erfc(|z| / sqrt(2))` and the chi-square with one degree of freedom is
 * `erfc(sqrt(x / 2))`. A p-value computed by a crude approximation would make the verify
 * fixtures assert against the approximation instead of against the mathematics, which
 * defeats the point of having fixtures.
 */
export function erfc(x: number): number {
    const z = Math.abs(x);
    const t = 2 / (2 + z);
    const ty = 4 * t - 2;

    const coefficients = [
        -1.3026537197817094, 6.4196979235649026e-1, 1.9476473204185836e-2,
        -9.561514786808631e-3, -9.46595344482036e-4, 3.66839497852761e-4,
        4.2523324806907e-5, -2.0278578112534e-5, -1.624290004647e-6,
        1.303655835580e-6, 1.5626441722e-8, -8.5238095915e-8,
        6.529054439e-9, 5.059343495e-9, -9.91364156e-10,
        -2.27365122e-10, 9.6467911e-11, 2.394038e-12,
        -6.886027e-12, 8.94487e-13, 3.13092e-13,
        -1.12708e-13, 3.81e-16, 7.106e-15,
    ];

    let d = 0;
    let dd = 0;
    for (let j = coefficients.length - 1; j > 0; j -= 1) {
        const temporary = d;
        d = ty * d - dd + coefficients[j];
        dd = temporary;
    }

    const answer = t * Math.exp(-z * z + 0.5 * (coefficients[0] + ty * d) - dd);
    return x >= 0 ? answer : 2 - answer;
}

/** Two-tailed p-value for a standard normal deviate. */
export function twoTailedNormalP(z: number): number {
    if (!Number.isFinite(z)) return Number.NaN;
    return erfc(Math.abs(z) / Math.SQRT2);
}

/**
 * Two-tailed p-value for a chi-square with one degree of freedom.
 *
 * With df = 1 the chi-square is the square of a standard normal, so this is exact rather
 * than an approximation off a table.
 */
export function chiSquarePValueOneDf(chiSquare: number): number {
    if (!Number.isFinite(chiSquare) || chiSquare < 0) return Number.NaN;
    return erfc(Math.sqrt(chiSquare / 2));
}

/** Arithmetic mean, or null for an empty vector. Never 0-by-default. */
export function mean(values: readonly number[]): number | null {
    const usable = values.filter((value) => Number.isFinite(value));
    if (usable.length === 0) return null;
    let total = 0;
    for (const value of usable) total += value;
    return total / usable.length;
}

/**
 * Sample standard deviation (n-1 denominator), or null when it is not defined.
 *
 * Null for fewer than two values rather than 0: a single observation has no spread, and
 * reporting 0 would make it look like a perfectly consistent cohort.
 */
export function sampleStdDev(values: readonly number[]): number | null {
    const usable = values.filter((value) => Number.isFinite(value));
    if (usable.length < 2) return null;
    const average = usable.reduce((total, value) => total + value, 0) / usable.length;
    const sumSquares = usable.reduce((total, value) => total + (value - average) ** 2, 0);
    return Math.sqrt(sumSquares / (usable.length - 1));
}

/** Rounds for storage. Six places is far past any interpretive precision here. */
function round(value: number, places = 6): number {
    if (!Number.isFinite(value)) return Number.NaN;
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
}

// --------------------------------------------
// The four-fifths rule
// --------------------------------------------

/**
 * The adverse-impact ratio: this cohort's selection rate over the reference cohort's.
 *
 * Refuses when either rate is missing, or when the reference rate is zero — a cohort
 * selected at 0 gives nothing to divide by, and the honest answer is that no ratio exists
 * rather than an infinity or a zero.
 */
export function fourFifthsRatio(
    rate: number | null | undefined,
    referenceRate: number | null | undefined
): MeasuredNumber {
    if (rate === null || rate === undefined || !Number.isFinite(rate)) {
        return refused('this cohort has no computable selection rate');
    }
    if (referenceRate === null || referenceRate === undefined || !Number.isFinite(referenceRate)) {
        return refused('the reference cohort has no computable selection rate to compare against');
    }
    if (referenceRate === 0) {
        return refused('the reference cohort selected nobody, so no ratio can be formed');
    }
    return computed(round(rate / referenceRate));
}

// --------------------------------------------
// Two-proportion z-test
// --------------------------------------------

export interface ProportionTest {
    z: number;
    pValue: number;
}

/**
 * Two-tailed two-proportion z-test with a pooled proportion.
 *
 * WHY TWO-TAILED
 *
 * The four-fifths rule is a screening device, and a cohort can fall on either side of the
 * reference. A one-tailed test would require choosing a direction in advance, and the
 * direction is the thing being tested — choosing it after seeing the data is how a
 * screening statistic becomes a fishing expedition. Two-tailed costs a little power and
 * buys the property that this test can report a cohort being selected at an unusually HIGH
 * rate, which is also worth knowing.
 *
 * WHY NO CONTINUITY CORRECTION HERE
 *
 * The chi-square beside it uses Yates'. This one does not, deliberately: the two are
 * reported together, and if both were corrected they would still disagree sometimes, but if
 * only one were, a reader comparing them would see a discrepancy that is an artefact of
 * which correction was applied rather than of the data. The convention for the z-test is no
 * correction and for Yates' chi-square is a correction; the report names which statistic a
 * reader is looking at so the difference is attributable.
 *
 * REFUSES when either group is below the cohort floor, or when the pooled proportion is
 * exactly 0 or 1 — in both cases the standard error is zero and the statistic is undefined.
 */
export function twoProportionZ(
    selectedA: number,
    nA: number,
    selectedB: number,
    nB: number
): Measured<ProportionTest> {
    if (![selectedA, nA, selectedB, nB].every((value) => Number.isInteger(value) && value >= 0)) {
        return refused('counts must be non-negative whole numbers');
    }
    if (selectedA > nA || selectedB > nB) {
        return refused('a selected count cannot exceed its group size');
    }
    if (nA < MIN_COHORT_N || nB < MIN_COHORT_N) {
        return refused(
            `both groups need at least ${MIN_COHORT_N} scored answers; this comparison has ${nA} and ${nB}`
        );
    }

    const pooled = (selectedA + selectedB) / (nA + nB);
    if (pooled === 0) {
        return refused('nobody in either group was selected, so there is no difference to test');
    }
    if (pooled === 1) {
        return refused('everybody in both groups was selected, so there is no difference to test');
    }

    const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
    if (!(standardError > 0)) {
        return refused('the standard error is zero, so the test is undefined');
    }

    const z = (selectedA / nA - selectedB / nB) / standardError;
    return computed({ z: round(z), pValue: round(twoTailedNormalP(z)) });
}

// --------------------------------------------
// Chi-square, 2x2
// --------------------------------------------

export interface ChiSquareTest {
    chiSquare: number;
    pValue: number;
    /** Always true today; recorded so a future uncorrected variant is distinguishable. */
    yatesCorrected: boolean;
    /** The smallest expected cell count, for the reader who wants to see the margin. */
    minExpected: number;
}

/**
 * Pearson chi-square for a 2x2 table, with Yates' continuity correction.
 *
 * Layout: `a` and `b` are the first group's selected and not-selected counts, `c` and `d`
 * the second group's. Rows need not be in any particular order.
 *
 * WHY YATES
 *
 * The uncorrected statistic overstates significance in a 2x2 table, and this feature will
 * usually be run on exactly the sample sizes where that matters most — a study with a few
 * dozen candidates per cohort. The correction pushes the statistic toward zero, which
 * pushes the p-value up, which makes the flag harder to raise. That is the direction an
 * accusation should have to fight against, so it is the correction this feature uses.
 *
 * REFUSES when any expected cell count is below 5, the standard condition for the
 * chi-square approximation to be meaningful. That is a refusal and not a note, because the
 * chi-square with a tiny expected cell is the statistic most likely to produce a spurious
 * significant result, and it is the one a reader is least equipped to discount.
 */
export function chiSquare2x2(a: number, b: number, c: number, d: number): Measured<ChiSquareTest> {
    const cells = [a, b, c, d];
    if (!cells.every((value) => Number.isInteger(value) && value >= 0)) {
        return refused('cell counts must be non-negative whole numbers');
    }

    const n = a + b + c + d;
    if (n === 0) return refused('the table is empty');

    const rowOne = a + b;
    const rowTwo = c + d;
    const columnOne = a + c;
    const columnTwo = b + d;
    if (rowOne === 0 || rowTwo === 0 || columnOne === 0 || columnTwo === 0) {
        return refused('a row or column is empty, so the table has no association to measure');
    }

    const expected = [
        (rowOne * columnOne) / n,
        (rowOne * columnTwo) / n,
        (rowTwo * columnOne) / n,
        (rowTwo * columnTwo) / n,
    ];
    const minExpected = Math.min(...expected);
    if (minExpected < 5) {
        return refused(
            `the smallest expected cell count is ${round(minExpected, 2)}, below the 5 the chi-square approximation needs`
        );
    }

    // Yates: subtract half the total from the absolute cross-product difference, floored at
    // zero so a table with less association than the correction allows yields 0 rather than
    // a negative sum of squares.
    const crossProduct = Math.abs(a * d - b * c);
    const corrected = Math.max(0, crossProduct - n / 2);
    const chiSquare = (n * corrected * corrected) / (rowOne * rowTwo * columnOne * columnTwo);

    return computed({
        chiSquare: round(chiSquare),
        pValue: round(chiSquarePValueOneDf(chiSquare)),
        yatesCorrected: true,
        minExpected: round(minExpected, 2),
    });
}

// --------------------------------------------
// Cohen's d
// --------------------------------------------

/**
 * Cohen's d between two groups, using the pooled standard deviation.
 *
 * WHY POOLED
 *
 * The pooled denominator is the standard definition and the right one here: the two groups
 * come from the same interview process and the same question set, so the assumption that
 * they share a spread is the assumption the process itself implies. It also makes the
 * statistic symmetric — d(A, B) is exactly -d(B, A) — which matters because the reference
 * cohort is a choice, and a statistic that changed magnitude when the reference changed
 * would make two runs of the same data look like two different findings.
 *
 * REFUSES when either group has fewer than two scored answers (no spread is defined), or
 * when the pooled standard deviation is zero — which happens when every score in both
 * groups is identical. In that case the groups either are identical, in which case there is
 * nothing to report, or differ only by a constant, which is not a distribution difference.
 */
export function cohensD(
    meanA: number | null,
    sdA: number | null,
    nA: number,
    meanB: number | null,
    sdB: number | null,
    nB: number
): MeasuredNumber {
    if (meanA === null || meanB === null || sdA === null || sdB === null) {
        return refused('one of the groups has no computed mean and spread');
    }
    if (!Number.isFinite(meanA) || !Number.isFinite(meanB) || !Number.isFinite(sdA) || !Number.isFinite(sdB)) {
        return refused('a mean or spread is not a finite number');
    }
    if (nA < 2 || nB < 2) {
        return refused(`both groups need at least two scored answers; this comparison has ${nA} and ${nB}`);
    }

    const pooledVariance = ((nA - 1) * sdA * sdA + (nB - 1) * sdB * sdB) / (nA + nB - 2);
    const pooledSd = Math.sqrt(pooledVariance);
    if (!(pooledSd > 0)) {
        return refused('every score in both groups is identical, so the pooled spread is zero');
    }

    return computed(round((meanA - meanB) / pooledSd));
}

/**
 * The standardised mean gap between two cohorts on one item — the DIF-lite statistic.
 *
 * The item floor is higher than the cohort floor: a question answered by five people in
 * each cohort is already a thin basis for a claim about how that question treats a group,
 * and questions are examined in the dozens, so the multiple-comparison problem bites
 * hardest here.
 */
export function itemDifferential(
    scoresA: readonly number[],
    scoresB: readonly number[]
): MeasuredNumber {
    if (scoresA.length < MIN_ITEM_SCORED || scoresB.length < MIN_ITEM_SCORED) {
        return refused(
            `both cohorts need at least ${MIN_ITEM_SCORED} answers to this question; it has ${scoresA.length} and ${scoresB.length}`
        );
    }
    return cohensD(mean(scoresA), sampleStdDev(scoresA), scoresA.length, mean(scoresB), sampleStdDev(scoresB), scoresB.length);
}

// --------------------------------------------
// One cohort, measured
// --------------------------------------------

/** A cohort's own summary, before it is compared with anything. */
export interface CohortSummary {
    scoredN: number;
    /**
     * Null when the study declares no cutoff.
     *
     * Not zero: with no cutoff there is no bar for a candidate to clear, so "how many were
     * selected" has no answer. A stored 0 would read as a measurement of nobody, and this
     * module does not fabricate measurements. A zero is written only where it is one — a
     * known cutoff that nobody cleared.
     */
    selectedCount: number | null;
    /** Null when there is no selection threshold, or too few scored answers. */
    rate: number | null;
    meanScore: number | null;
    stdDev: number | null;
}

/**
 * Summarises one group of scores. No comparison happens here, so this is what the reference
 * cohort is reduced to before the other cohorts are measured against it.
 */
export function summariseCohort(
    scores: readonly number[],
    selectionThreshold: number | null
): CohortSummary {
    const usable = scores.filter((value) => Number.isFinite(value));
    const selectedCount =
        selectionThreshold === null ? null : usable.filter((value) => value >= selectionThreshold).length;
    // The rate is keyed off `selectedCount` rather than off the threshold a second time: the
    // two are null together, and going through the count keeps the one guard in one place.
    const rate =
        selectedCount === null || usable.length === 0 ? null : round(selectedCount / usable.length);
    return {
        scoredN: usable.length,
        selectedCount,
        rate,
        meanScore: mean(usable) === null ? null : round(mean(usable) as number),
        stdDev: sampleStdDev(usable) === null ? null : round(sampleStdDev(usable) as number),
    };
}

/** Everything the CohortMetric row needs, and nothing the caller has to derive itself. */
export interface CohortMetricResult {
    cohortKey: string;
    cohortValue: string;
    n: number;
    scoredN: number;
    /**
     * Null when the study declares no cutoff — see `CohortSummary.selectedCount`. Whenever
     * `computable` is true this is a real count, since a computable cohort is one that had a
     * cutoff to be measured against.
     */
    selectedCount: number | null;
    selectionRate: number | null;
    referenceRate: number | null;
    meanScore: number | null;
    stdDev: number | null;
    adverseImpactRatio: number | null;
    zStatistic: number | null;
    pValue: number | null;
    chiSquare: number | null;
    effectSize: number | null;
    computable: boolean;
    /** Non-null in exactly the case where `computable` is false. */
    notComputableReason: string | null;
    /**
     * Why the four-fifths ratio specifically is absent, when the cohort as a whole is
     * computable.
     *
     * Not a column — it exists so the ratio flag can say *why* it could not be formed
     * rather than falling back to a generic message. A computable cohort whose ratio is
     * missing is a real and non-obvious case (a reference cohort that selected nobody),
     * and it is exactly the case where a reader would otherwise be left guessing.
     */
    ratioNotComputableReason: string | null;
}

export interface CohortInput {
    cohortKey: string;
    cohortValue: string;
    /** Candidates tagged into this cohort, whether or not they have a score. */
    n: number;
    /** The scores they have. May be shorter than `n` — several may have none. */
    scores: readonly number[];
}

/**
 * Measures one cohort against a reference cohort.
 *
 * THE ORDER OF THE REFUSALS IS THE POINT
 *
 * Each check below is a different way for the numbers to be unsupportable, and the reason
 * returned says which one it was — because "we could not compute this" is not useful to
 * the person reading a compliance report, and "3 of 14 candidates in this cohort have a
 * score" is.
 *
 * NOTE WHAT IS *NOT* A REFUSAL. A computable cohort can still have a null
 * `adverseImpactRatio`, `zStatistic`, `chiSquare` or `effectSize` — the cohort's own rate
 * is a real measurement even when the comparison against the reference is not possible
 * (a reference cohort that selected nobody, or too few answers for the chi-square's
 * expected cells). Those refusals belong to the individual test and are recorded on the
 * flag that would have used them, not on the cohort. Collapsing them into the cohort's
 * `computable` flag would throw away a rate that is genuinely known.
 */
export function computeCohortMetric(
    cohort: CohortInput,
    reference: CohortSummary | null,
    selectionThreshold: number | null
): CohortMetricResult {
    const summary = summariseCohort(cohort.scores, selectionThreshold);

    const base: CohortMetricResult = {
        cohortKey: cohort.cohortKey,
        cohortValue: cohort.cohortValue,
        n: cohort.n,
        scoredN: summary.scoredN,
        selectedCount: summary.selectedCount,
        selectionRate: null,
        referenceRate: reference ? reference.rate : null,
        meanScore: summary.meanScore,
        stdDev: summary.stdDev,
        adverseImpactRatio: null,
        zStatistic: null,
        pValue: null,
        chiSquare: null,
        effectSize: null,
        computable: false,
        notComputableReason: null,
        ratioNotComputableReason: null,
    };

    if (selectionThreshold === null) {
        base.meanScore = summary.meanScore;
        base.stdDev = summary.stdDev;
        base.notComputableReason =
            'this study declares no selection cutoff, so no answer can be counted as selected and no selection rate exists';
        return base;
    }

    if (summary.scoredN < MIN_COHORT_N) {
        base.notComputableReason = `only ${summary.scoredN} scored ${summary.scoredN === 1 ? 'answer' : 'answers'} in this cohort, below the ${MIN_COHORT_N} a rate needs`;
        return base;
    }

    if (cohort.n > 0 && summary.scoredN / cohort.n < MIN_SCORE_COVERAGE) {
        base.notComputableReason = `only ${summary.scoredN} of ${cohort.n} candidates in this cohort have a usable score, below the ${Math.round(MIN_SCORE_COVERAGE * 100)}% a rate needs`;
        return base;
    }

    if (reference === null || reference.rate === null) {
        base.selectionRate = summary.rate;
        base.notComputableReason =
            'the reference cohort has no computable selection rate, so this cohort has nothing to be compared against';
        return base;
    }

    // From here the cohort's own rate is known, and the comparisons are attempted
    // individually. A failure of any one of them leaves that figure null and does not
    // invalidate the rate.
    base.computable = true;
    base.notComputableReason = null;
    base.selectionRate = summary.rate;

    // THE REFERENCE COHORT GETS THE SAME FLOOR THE SUBJECT COHORT GOT.
    //
    // `summariseCohort` hands back a non-null rate for any cohort holding a single scored
    // answer, so without this check a reference of one or two people would serve as a basis
    // for comparison. Of the four statistics below, three carry their own floor and decline
    // on a thin reference — the z-test on MIN_COHORT_N, the chi-square on its expected
    // cells, Cohen's d on needing a spread. `fourFifthsRatio` takes two rates and never
    // sees an n, so it cannot refuse on size and would return a figure. That figure is the
    // headline number of the whole feature and it would be the ONLY one in the row, with
    // every test beside it printing "not computed" and so nothing left for a reader to
    // discount it by. A ratio against a reference of two is the exact number this module's
    // header declines to produce.
    //
    // This is a refusal of the RATIO and not of the cohort: the cohort's own selection rate
    // is a real measurement either way, and `CohortMetric_computable_check` couples
    // `computable` to that rate rather than to the comparison, so demoting the whole row
    // here would both discard a known figure and violate the constraint.
    const ratio =
        reference.scoredN < MIN_COHORT_N
            ? refused<number>(
                  `the reference cohort has only ${reference.scoredN} scored ${reference.scoredN === 1 ? 'answer' : 'answers'}, below the ${MIN_COHORT_N} a ratio needs`
              )
            : fourFifthsRatio(summary.rate, reference.rate);
    if (ratio.state === 'computed') {
        base.adverseImpactRatio = ratio.value;
    } else {
        base.ratioNotComputableReason = ratio.reason;
    }

    // Both counts are real numbers from here: `selectedCount` is null only when the study
    // declares no cutoff, and that case returned above. Bound to consts so the three tests
    // below read as arithmetic on counts rather than on nullable columns.
    const selected = summary.selectedCount as number;
    const referenceSelected = reference.selectedCount as number;

    const zTest = twoProportionZ(selected, summary.scoredN, referenceSelected, reference.scoredN);
    if (zTest.state === 'computed') {
        base.zStatistic = zTest.value.z;
        base.pValue = zTest.value.pValue;
    }

    const chiSquare = chiSquare2x2(
        selected,
        summary.scoredN - selected,
        referenceSelected,
        reference.scoredN - referenceSelected
    );
    if (chiSquare.state === 'computed') base.chiSquare = chiSquare.value.chiSquare;

    const effect = cohensD(
        summary.meanScore,
        summary.stdDev,
        summary.scoredN,
        reference.meanScore,
        reference.stdDev,
        reference.scoredN
    );
    if (effect.state === 'computed') base.effectSize = effect.value;

    return base;
}

// --------------------------------------------
// Flag evaluation
// --------------------------------------------

export interface FlagEvaluation {
    raised: boolean;
    statistic: number | null;
    threshold: number;
    pValue: number | null;
    /** Null when the test ran. Present when it was attempted and could not be computed. */
    notComputableReason: string | null;
}

/**
 * Evaluates one definition against a measured value.
 *
 * Returns `raised: false` with a `notComputableReason` when the value is null, so "we
 * looked and there is no gap" and "we could not look" stay distinguishable at the flag
 * level as well as the metric level.
 */
export function evaluateFlag(
    definition: { kind: 'ratio' | 'p-value' | 'effect-size'; threshold: number },
    statistic: number | null,
    pValue: number | null,
    notComputableReason: string | null
): FlagEvaluation {
    if (statistic === null || !Number.isFinite(statistic)) {
        return {
            raised: false,
            statistic: null,
            threshold: definition.threshold,
            pValue: pValue === null ? null : pValue,
            notComputableReason: notComputableReason ?? 'the statistic could not be computed',
        };
    }

    let raised: boolean;
    if (definition.kind === 'p-value') {
        // A p-value flag fires when the value is BELOW the threshold. Nothing to fire on
        // without one, so a missing p-value is a refusal rather than a negative.
        if (pValue === null || !Number.isFinite(pValue)) {
            return {
                raised: false,
                statistic,
                threshold: definition.threshold,
                pValue: null,
                notComputableReason: notComputableReason ?? 'the significance test could not be computed',
            };
        }
        raised = pValue < definition.threshold;
    } else if (definition.kind === 'ratio') {
        // Below the threshold is the concerning direction.
        raised = statistic < definition.threshold;
    } else {
        // Effect size: either direction is worth reporting, so compare magnitudes.
        raised = Math.abs(statistic) >= definition.threshold;
    }

    return {
        raised,
        statistic,
        threshold: definition.threshold,
        pValue,
        notComputableReason: null,
    };
}

/** The alpha the p-value flags are read against, re-exported so callers need one import. */
export const SIGNIFICANCE_ALPHA = ALPHA;

/** The effect size at which a distribution gap is reported, re-exported for the same reason. */
export const NOTABLE_EFFECT_SIZE = LARGE_EFFECT_SIZE;
