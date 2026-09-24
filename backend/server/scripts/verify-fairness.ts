// ============================================
// verify-fairness.ts — correctness checks for the fairness core
//
// Feature 4 produces numbers that will be read as claims about groups of people, and
// those numbers are verified here rather than assumed. Like verify-delivery.ts,
// verify-measurement.ts and verify-integrity.ts this runs with no database, no browser and
// no network.
//
//   npm run verify:fairness        (from backend/)
//
// Exits non-zero on any failure.
//
// THE CHECKS THAT MATTER MOST ARE THE ONES ABOUT REFUSING
//
// Sections 1 and 2 confirm the statistics compute what they claim, and section 2 goes
// further: it feeds the same generator a biased fixture and its unbiased twin, and requires
// a flag from the first and NO flag from the second. A check that only asserted "a flag
// appeared" would pass against a module that flags everything, which is the failure mode
// that discredits an audit tool fastest.
//
// Section 3 is the one to read. Every refusal below is a case where a plausible-looking
// number could have been produced and must not be: a rate from three people, a ratio
// against a cohort that selected nobody, an effect size from identical scores. Section 4
// then asserts the property underneath all of them — that no code path returns a value for
// a quantity it could not compute — and section 5 asserts the feature's other hard promise:
// that a protected attribute cannot be entered as a cohort at all.
// ============================================

import assert from 'node:assert/strict';
import {
    ALPHA,
    BASE_CAVEATS,
    BIAS_FLAGS,
    CLAUSE_CITATIONS,
    FAIRNESS_REGISTRY_VERSION,
    FOUR_FIFTHS_EXPLANATION,
    FOUR_FIFTHS_THRESHOLD,
    LARGE_EFFECT_SIZE,
    MIN_COHORT_N,
    MIN_ITEM_SCORED,
    biasFlagDefinition,
    notableFlagKeys,
} from '../app/lib/fairness/contract';
import {
    chiSquare2x2,
    cohensD,
    computeCohortMetric,
    erfc,
    evaluateFlag,
    fourFifthsRatio,
    itemDifferential,
    mean,
    sampleStdDev,
    summariseCohort,
    twoProportionZ,
    twoTailedNormalP,
    type CohortMetricResult,
    type Measured,
    type Refused,
} from '../app/lib/fairness/statistics';
import {
    MAX_COHORT_KEYS,
    describeDeclaration,
    parseCohortDeclaration,
    protectedAttributeIn,
    splitCohortKeyTokens,
    validateAssignment,
} from '../app/lib/fairness/cohort';
import {
    SCORE_DIMENSIONS,
    SCORE_MATCH_TOLERANCE,
    fromStoredDecision,
    hashInput,
    isMeasuredResponse,
    readScoreSet,
    redactOutput,
    scoreSourceFor,
    verifyScores,
    type ScoreSet,
} from '../app/lib/fairness/decisionLog';
import * as decisionLogModule from '../app/lib/fairness/decisionLog';
import {
    buildComplianceReport,
    reportBlocks,
    reportDisclaimers,
    reportToText,
} from '../app/lib/fairness/complianceReport';
import { renderReportPdf } from '../app/lib/fairness/reportPdf';
import { PDFDocument } from 'pdf-lib';
import zlib from 'node:zlib';

// --------------------------------------------
// Harness
// --------------------------------------------

let passed = 0;
const failures: string[] = [];

function record(name: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
    console.log(`  FAIL ${name}`);
    console.log(`       ${message}`);
}

const pending: Promise<void>[] = [];

function test(name: string, fn: () => void | Promise<void>) {
    let result: void | Promise<void>;
    try {
        result = fn();
    } catch (error) {
        record(name, error);
        return;
    }

    if (result && typeof (result as Promise<void>).then === 'function') {
        pending.push(
            (result as Promise<void>).then(
                () => {
                    passed += 1;
                    console.log(`  ok   ${name}`);
                },
                (error) => record(name, error)
            )
        );
        return;
    }

    passed += 1;
    console.log(`  ok   ${name}`);
}

function section(title: string) {
    console.log(`\n${title}`);
}

/** Deterministic PRNG, so a failure is reproducible. */
function mulberry32(seed: number) {
    return function random() {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Asserts two numbers agree to within `tolerance`, with a message naming both. */
function close(actual: number | null, expected: number, tolerance: number, what: string) {
    assert.ok(actual !== null, `${what}: expected ${expected}, got null`);
    assert.ok(
        Math.abs((actual as number) - expected) <= tolerance,
        `${what}: expected ${expected} ± ${tolerance}, got ${actual}`
    );
}

/**
 * Asserts a measurement was refused, and returns it narrowed.
 *
 * Written as a real control-flow edge rather than an `assert.equal(result.state, ...)`
 * because this backend compiles with `strict: false`, where the compiler narrows a union
 * only on an actual branch. The `assert.fail` returns `never`, so the branch is provably
 * unreachable afterwards and `result` is a `Refused` at the return.
 */
function refused<T>(result: Measured<T>, what: string): Refused {
    if (result.state !== 'refused') assert.fail(`${what}: expected a refusal, but a value was computed`);
    return result;
}

/** Asserts a measurement was computed, and returns its value. */
function computedValue<T>(result: Measured<T>, what: string): T {
    if (result.state !== 'computed') assert.fail(`${what}: expected a value, but it was refused: ${result.reason}`);
    return result.value;
}

// --------------------------------------------
// 1. The statistics compute what they claim
// --------------------------------------------

section('1. The statistics compute what they claim');

test('the error function matches known values', () => {
    // erfc(0) = 1, and erfc is 2 - erfc(-x). These anchor the p-values below: if the
    // approximation were wrong, every significance result in this feature would be wrong
    // in the same direction and the fixtures would happily agree with it.
    close(erfc(0), 1, 1e-12, 'erfc(0)');
    close(erfc(1), 0.157299207050285, 1e-12, 'erfc(1)');
    close(erfc(-1), 2 - 0.157299207050285, 1e-12, 'erfc(-1)');
    close(erfc(2), 0.004677734981047, 1e-12, 'erfc(2)');
    close(erfc(3), 2.209049699858544e-5, 1e-12, 'erfc(3)');

    // Two-tailed normal tail: the 1.96 convention is 0.05.
    close(twoTailedNormalP(1.959963984540054), 0.05, 1e-9, 'p at 1.96');
    close(twoTailedNormalP(-1.959963984540054), 0.05, 1e-9, 'p at -1.96 (two-tailed)');
    close(twoTailedNormalP(0), 1, 1e-12, 'p at 0');
});

test('mean and sample standard deviation refuse an undefined spread', () => {
    close(mean([1, 2, 3, 4]), 2.5, 1e-12, 'mean');
    assert.equal(mean([]), null, 'mean of nothing must be null, never 0');
    close(sampleStdDev([2, 4, 4, 4, 5, 5, 7, 9]), 2.138089935299395, 1e-12, 'sample sd');
    // A single observation has no spread. Reporting 0 would make a one-person cohort look
    // perfectly consistent.
    assert.equal(sampleStdDev([42]), null, 'sd of one value must be null, never 0');
    assert.equal(sampleStdDev([]), null, 'sd of nothing must be null');
    // Non-finite entries are dropped rather than poisoning the result into NaN.
    close(mean([1, Number.NaN, 3]), 2, 1e-12, 'mean ignores NaN');
});

test('the four-fifths ratio is the rate over the reference rate', () => {
    const half = computedValue(fourFifthsRatio(0.4, 0.8), 'four-fifths 0.4/0.8');
    close(half, 0.5, 1e-12, 'ratio 0.4/0.8');
    assert.ok(half < FOUR_FIFTHS_THRESHOLD, '0.5 must breach four-fifths');

    const pass = computedValue(fourFifthsRatio(0.72, 0.8), 'four-fifths 0.72/0.8');
    close(pass, 0.9, 1e-12, 'ratio 0.72/0.8');
    assert.ok(pass >= FOUR_FIFTHS_THRESHOLD, '0.9 must not breach four-fifths');

    // A cohort doing BETTER than the reference is above 1 and is not a violation.
    const above = computedValue(fourFifthsRatio(0.8, 0.4), 'four-fifths 0.8/0.4');
    close(above, 2, 1e-12, 'ratio 0.8/0.4');
});

test('the two-proportion z-test matches a hand-computed value', () => {
    // 20/100 = 0.2 against 40/100 = 0.4.
    //   pooled p = 60/200 = 0.3
    //   SE = sqrt(0.3 · 0.7 · (1/100 + 1/100)) = sqrt(0.0042) = 0.064807407…
    //   z  = (0.2 − 0.4) / 0.064807407 = −3.086066…
    //   p  = erfc(|z| / √2) = 2·(1 − Φ(3.086066)) = 0.0020288…
    const result = computedValue(twoProportionZ(20, 100, 40, 100), 'two-proportion z');
    close(result.z, -3.086066, 1e-5, 'z statistic');
    close(result.pValue, 0.002029, 1e-5, 'two-tailed p-value');
    assert.ok(result.pValue < ALPHA, 'this gap must be significant at 0.05');

    // Two-tailed, so the same gap in either direction gives the same p.
    const mirrored = computedValue(twoProportionZ(40, 100, 20, 100), 'mirrored two-proportion z');
    close(mirrored.z, 3.086066, 1e-5, 'mirrored z statistic');
    close(mirrored.pValue, result.pValue, 1e-12, 'mirrored p-value');
});

test('identical proportions produce no evidence of a gap', () => {
    const result = computedValue(twoProportionZ(60, 100, 60, 100), 'identical proportions');
    close(result.z, 0, 1e-12, 'z statistic for identical rates');
    close(result.pValue, 1, 1e-12, 'p-value for identical rates');
});

test('the chi-square matches a hand-computed value and is Yates-corrected', () => {
    // The same table as above: 20/80 against 40/60, n = 200.
    //   expected cells: 30, 70, 30, 70 — all ≥ 5
    //   |ad − bc| = |20·60 − 80·40| = 2000,  n/2 = 100,  corrected = 1900
    //   χ² = 200 · 1900² / (100 · 100 · 60 · 140) = 722000000 / 84000000 = 8.595238…
    //   p  = erfc(sqrt(8.595238 / 2)) = 2·(1 − Φ(√8.595238)) = 0.00337…
    const result = computedValue(chiSquare2x2(20, 80, 40, 60), 'chi-square');
    close(result.chiSquare, 8.595238, 1e-5, 'chi-square statistic');
    close(result.pValue, 0.003374, 1e-5, 'chi-square p-value');
    assert.equal(result.yatesCorrected, true, 'Yates correction must be applied');
    close(result.minExpected, 30, 1e-9, 'smallest expected cell');

    // The correction must make the statistic SMALLER than the uncorrected value, which is
    // the whole reason for using it — otherwise the correction is decoration.
    const n = 200;
    const uncorrected = (n * (20 * 60 - 80 * 40) ** 2) / (100 * 100 * 60 * 140);
    assert.ok(
        result.chiSquare < uncorrected,
        `Yates (${result.chiSquare}) must be below the uncorrected ${uncorrected}`
    );
});

test("Cohen's d matches hand-computed values and is symmetric", () => {
    // Equal means, equal spreads: d = 0.
    close(computedValue(cohensD(70, 10, 30, 70, 10, 30), "Cohen's d identical"), 0, 1e-12, 'd for identical groups');

    // One pooled SD apart: d = 1 exactly.
    close(computedValue(cohensD(70, 10, 30, 60, 10, 30), "Cohen's d one SD"), 1, 1e-12, 'd for one pooled SD');

    //   pooled var = (24·144 + 24·225) / 48 = 8856/48 = 184.5,  sd = 13.583075…
    //   d = 6 / 13.583075 = 0.441726…
    close(computedValue(cohensD(70, 12, 25, 64, 15, 25), "Cohen's d unequal"), 0.441726, 1e-5, 'd with unequal spreads');

    // Symmetry matters because the reference cohort is a choice: a statistic whose
    // magnitude moved when the reference moved would make one dataset look like two
    // different findings.
    const forward = computedValue(cohensD(70, 12, 25, 64, 15, 25), 'forward d');
    const backward = computedValue(cohensD(64, 15, 25, 70, 12, 25), 'backward d');
    close(backward, -forward, 1e-12, 'd must be antisymmetric');
});

test('the item differential applies the question floor', () => {
    const a = [80, 82, 84, 86, 88, 90];
    const b = [60, 62, 64, 66, 68, 70];
    const value = computedValue(itemDifferential(a, b), 'item differential');
    // The property that matters is that the gap is large and positive; the exact value
    // depends on the pooled spread of these two vectors.
    assert.ok(value > 1, `expected a gap above one SD, got ${value}`);

    refused(itemDifferential([80, 82, 84, 86], b), 'item differential below the floor');
    assert.equal(MIN_ITEM_SCORED, 5);
});

// --------------------------------------------
// 2. A seeded biased fixture is flagged, and its unbiased twin is not
// --------------------------------------------

section('2. A seeded biased fixture is flagged, and its unbiased twin is not');

const FIXTURE_THRESHOLD = 60;
const FIXTURE_TOTAL = 200;

/**
 * Exactly `selected` scores at or above the threshold and the rest below it, jittered from
 * a seeded generator so the fixture is deterministic and reproducible.
 */
function scoresWithSelection(selected: number, total: number, random: () => number): number[] {
    const scores: number[] = [];
    for (let i = 0; i < selected; i += 1) {
        scores.push(FIXTURE_THRESHOLD + random() * (100 - FIXTURE_THRESHOLD));
    }
    for (let i = selected; i < total; i += 1) {
        scores.push(random() * (FIXTURE_THRESHOLD - 1));
    }
    return scores;
}

/**
 * Runs the cohort-level flag evaluation over one fixture and returns the flag keys raised
 * against cohort B.
 *
 * This mirrors what fairnessService does, in miniature: summarise the reference cohort,
 * measure B against it, then evaluate each registry definition. Kept here so the verify
 * script exercises the actual definitions from the registry rather than a copy of them.
 */
function flaggedKeysAgainst(selectedA: number, selectedB: number): string[] {
    const random = mulberry32(20260924);
    const scoresA = scoresWithSelection(selectedA, FIXTURE_TOTAL, random);
    const scoresB = scoresWithSelection(selectedB, FIXTURE_TOTAL, random);

    const reference = summariseCohort(scoresA, FIXTURE_THRESHOLD);
    const metric = computeCohortMetric(
        { cohortKey: 'region', cohortValue: 'B', n: FIXTURE_TOTAL, scores: scoresB },
        reference,
        FIXTURE_THRESHOLD
    );

    const raised: string[] = [];

    const ratioDefinition = biasFlagDefinition('adverseImpactRatio');
    const pDefinition = biasFlagDefinition('selectionRateSignificantGap');
    const effectDefinition = biasFlagDefinition('scoreDistributionGap');
    assert.ok(ratioDefinition && pDefinition && effectDefinition);

    const evaluations: Array<{
        key: string;
        definition: { kind: 'ratio' | 'p-value' | 'effect-size'; threshold: number };
        statistic: number | null;
        pValue: number | null;
        reason: string | null;
    }> = [
        {
            key: 'adverseImpactRatio',
            definition: ratioDefinition,
            statistic: metric.adverseImpactRatio,
            pValue: metric.pValue,
            reason: metric.ratioNotComputableReason,
        },
        {
            key: 'selectionRateSignificantGap',
            definition: pDefinition,
            statistic: metric.zStatistic,
            pValue: metric.pValue,
            reason: null,
        },
        {
            key: 'scoreDistributionGap',
            definition: effectDefinition,
            statistic: metric.effectSize,
            pValue: null,
            reason: null,
        },
    ];

    for (const entry of evaluations) {
        if (evaluateFlag(entry.definition, entry.statistic, entry.pValue, entry.reason).raised) {
            raised.push(entry.key);
        }
    }

    return raised;
}

test('the biased fixture selects at half the reference rate and raises every cohort flag', () => {
    // 120 of 200 (60%) against 60 of 200 (30%): ratio exactly 0.5.
    const random = mulberry32(20260924);
    const scoresA = scoresWithSelection(120, FIXTURE_TOTAL, random);
    const scoresB = scoresWithSelection(60, FIXTURE_TOTAL, random);
    const reference = summariseCohort(scoresA, FIXTURE_THRESHOLD);

    close(reference.rate, 0.6, 1e-12, 'reference selection rate');
    const metric = computeCohortMetric(
        { cohortKey: 'region', cohortValue: 'B', n: FIXTURE_TOTAL, scores: scoresB },
        reference,
        FIXTURE_THRESHOLD
    );

    assert.equal(metric.computable, true, `fixture B must be computable: ${metric.notComputableReason}`);
    close(metric.selectionRate, 0.3, 1e-12, 'cohort B selection rate');
    close(metric.adverseImpactRatio, 0.5, 1e-12, 'adverse impact ratio');
    assert.ok(
        (metric.adverseImpactRatio as number) < FOUR_FIFTHS_THRESHOLD,
        'a 2:1 gap must breach the four-fifths line'
    );
    assert.ok(metric.pValue !== null && metric.pValue < ALPHA, 'a 120-vs-60 gap must be significant');
    assert.ok(
        metric.effectSize !== null && Math.abs(metric.effectSize) >= LARGE_EFFECT_SIZE,
        'a 60%-vs-30% selection gap must show a large distribution gap'
    );

    const raised = flaggedKeysAgainst(120, 60);
    for (const key of ['adverseImpactRatio', 'selectionRateSignificantGap', 'scoreDistributionGap']) {
        assert.ok(raised.includes(key), `expected ${key} to be raised; raised: ${raised.join(', ') || 'none'}`);
    }
});

test('the unbiased twin of the same fixture raises nothing', () => {
    // The same generator, the same total, the same threshold — only the selection counts
    // change, so that both cohorts select 120 of 200. A module that flagged everything, or
    // that keyed off sample size, would pass the check above and fail this one.
    const raised = flaggedKeysAgainst(120, 120);
    assert.deepEqual(raised, [], `an unbiased fixture must raise nothing, raised: ${raised.join(', ')}`);

    const random = mulberry32(20260924);
    const scoresA = scoresWithSelection(120, FIXTURE_TOTAL, random);
    const scoresB = scoresWithSelection(120, FIXTURE_TOTAL, random);
    const metric = computeCohortMetric(
        { cohortKey: 'region', cohortValue: 'B', n: FIXTURE_TOTAL, scores: scoresB },
        summariseCohort(scoresA, FIXTURE_THRESHOLD),
        FIXTURE_THRESHOLD
    );

    close(metric.adverseImpactRatio, 1, 1e-12, 'unbiased ratio');
    assert.ok(metric.pValue !== null && metric.pValue > ALPHA, 'an unbiased fixture must not be significant');
    // It must still be COMPUTABLE, though. A refusal here would mean the module had simply
    // declined to look, which would also produce an empty flag list.
    assert.equal(metric.computable, true, 'the unbiased fixture must still be computable');
    assert.ok(metric.selectionRate !== null, 'the unbiased fixture must still report a rate');
});

test('a moderately biased fixture is caught by the ratio and not only by a gross one', () => {
    // 120 of 200 (60%) against 84 of 200 (42%): ratio 0.7 — below four-fifths but a long
    // way from the 2:1 fixture above. The screen has to work at the margin, not just on
    // the obvious case.
    const random = mulberry32(20260924);
    const scoresA = scoresWithSelection(120, FIXTURE_TOTAL, random);
    const scoresB = scoresWithSelection(84, FIXTURE_TOTAL, random);
    const metric = computeCohortMetric(
        { cohortKey: 'region', cohortValue: 'B', n: FIXTURE_TOTAL, scores: scoresB },
        summariseCohort(scoresA, FIXTURE_THRESHOLD),
        FIXTURE_THRESHOLD
    );

    close(metric.adverseImpactRatio, 0.7, 1e-12, 'moderate ratio');
    assert.ok((metric.adverseImpactRatio as number) < FOUR_FIFTHS_THRESHOLD, '0.7 must breach four-fifths');
    assert.ok(flaggedKeysAgainst(120, 84).includes('adverseImpactRatio'), 'the moderate fixture must be flagged');
});

test('a cohort selected MORE often than the reference is reported, not hidden', () => {
    // The ratio is above 1, so four-fifths is not breached — but the z-test is two-tailed
    // precisely so that a cohort advantaged rather than disadvantaged is still visible.
    const random = mulberry32(20260924);
    const scoresA = scoresWithSelection(60, FIXTURE_TOTAL, random);
    const scoresB = scoresWithSelection(140, FIXTURE_TOTAL, random);
    const metric = computeCohortMetric(
        { cohortKey: 'region', cohortValue: 'B', n: FIXTURE_TOTAL, scores: scoresB },
        summariseCohort(scoresA, FIXTURE_THRESHOLD),
        FIXTURE_THRESHOLD
    );

    assert.ok((metric.adverseImpactRatio as number) > 1, 'B is selected more often than the reference');
    assert.ok(metric.pValue !== null && metric.pValue < ALPHA, 'the advantage must still be significant');
    const raised = flaggedKeysAgainst(60, 140);
    assert.ok(!raised.includes('adverseImpactRatio'), 'four-fifths must not fire above 1');
    assert.ok(raised.includes('selectionRateSignificantGap'), 'the significance flag must still fire');
});

// --------------------------------------------
// 3. Refusal
// --------------------------------------------

section('3. Refusal — the numbers that must NOT be produced');

test('a cohort below the size floor gets no selection rate', () => {
    const reference = summariseCohort([80, 85, 90, 95, 70, 75], FIXTURE_THRESHOLD);
    const metric = computeCohortMetric(
        { cohortKey: 'region', cohortValue: 'B', n: 3, scores: [80, 90, 70] },
        reference,
        FIXTURE_THRESHOLD
    );

    assert.equal(metric.computable, false, 'three candidates must not produce a rate');
    assert.equal(metric.selectionRate, null, 'the rate must be null, not a number');
    assert.equal(metric.adverseImpactRatio, null, 'the ratio must be null, not a number');
    assert.ok(
        (metric.notComputableReason ?? '').includes('3'),
        `the reason must state the count, got: ${metric.notComputableReason}`
    );
    assert.ok((metric.notComputableReason ?? '').includes(String(MIN_COHORT_N)));
});

test('a cohort whose scored answers fall below the coverage floor is refused', () => {
    // Twenty candidates tagged, six scored. The rate would look ordinary and would be
    // about the six, not the twenty the reader is thinking of.
    const metric = computeCohortMetric(
        { cohortKey: 'region', cohortValue: 'B', n: 20, scores: [80, 90, 70, 85, 95, 60] },
        summariseCohort([80, 85, 90, 95, 70, 75], FIXTURE_THRESHOLD),
        FIXTURE_THRESHOLD
    );

    assert.equal(metric.computable, false);
    assert.equal(metric.selectionRate, null);
    assert.ok((metric.notComputableReason ?? '').includes('6 of 20'), `got: ${metric.notComputableReason}`);
});

test('a cohort with no scored answers at all is refused, with a null mean', () => {
    const metric = computeCohortMetric(
        { cohortKey: 'region', cohortValue: 'B', n: 12, scores: [] },
        summariseCohort([80, 85, 90, 95, 70, 75], FIXTURE_THRESHOLD),
        FIXTURE_THRESHOLD
    );

    assert.equal(metric.computable, false);
    assert.equal(metric.selectionRate, null);
    assert.equal(metric.meanScore, null, 'a cohort with no scores has no mean — not 0');
    assert.equal(metric.stdDev, null, 'a cohort with no scores has no spread — not 0');
    assert.equal(metric.selectedCount, 0, 'the count of selected IS knowable: zero');
});

test('a study with no declared cutoff cannot compute selection rates', () => {
    const scores = [80, 85, 90, 95, 70, 75];
    const metric = computeCohortMetric(
        { cohortKey: 'region', cohortValue: 'B', n: 50, scores },
        null,
        null
    );

    assert.equal(metric.computable, false);
    assert.equal(metric.selectionRate, null);
    assert.ok(
        (metric.notComputableReason ?? '').toLowerCase().includes('cutoff'),
        `the reason must name the missing cutoff, got: ${metric.notComputableReason}`
    );

    // THE COUNT IS ABSENT, NOT ZERO.
    //
    // With no cutoff there is no bar for a candidate to clear, so "how many were selected"
    // has no answer. Of the two wrong answers available, 0 is the more insidious: it is a
    // plausible-looking figure that a report would print as a real measurement, beside a
    // rate that honestly says "not computed". The same doctrine governs the null mean and
    // spread above — a quantity that does not exist is stored as null.
    assert.equal(metric.selectedCount, null, 'no cutoff means no selected count — not 0');

    // Pinned to the missing cutoff and not to the scores: the same six scores under a real
    // threshold produce a real count, and the same score set with no threshold produces
    // nothing. The difference is the cutoff alone.
    assert.equal(summariseCohort(scores, null).selectedCount, null, 'no threshold, no count');
    assert.equal(
        summariseCohort(scores, FIXTURE_THRESHOLD).selectedCount,
        6,
        'a real threshold makes the count exist, and here it is a real six'
    );
});

test('a reference cohort that selected nobody yields a rate but no ratio', () => {
    // The important case for the shape of this result: the cohort's OWN rate is a real
    // measurement and must survive, while the comparison against the reference is
    // impossible and must not be invented. Collapsing the two would throw away a number
    // that is genuinely known.
    const reference = summariseCohort([10, 20, 30, 40, 50, 55], FIXTURE_THRESHOLD);
    close(reference.rate, 0, 1e-12, 'reference rate is a real zero');

    const metric = computeCohortMetric(
        { cohortKey: 'region', cohortValue: 'B', n: 10, scores: [80, 85, 90, 95, 70, 75, 65, 88, 92, 61] },
        reference,
        FIXTURE_THRESHOLD
    );

    assert.equal(metric.computable, true, 'this cohort IS computable');
    close(metric.selectionRate, 1, 1e-12, 'and its rate is real');
    assert.equal(metric.adverseImpactRatio, null, 'but no ratio can be formed against a zero');
    assert.ok(
        (metric.ratioNotComputableReason ?? '').includes('selected nobody'),
        `the ratio reason must be specific, got: ${metric.ratioNotComputableReason}`
    );

    const definition = biasFlagDefinition('adverseImpactRatio');
    assert.ok(definition);
    const evaluation = evaluateFlag(
        definition,
        metric.adverseImpactRatio,
        metric.pValue,
        metric.ratioNotComputableReason
    );
    assert.equal(evaluation.raised, false);
    assert.ok(
        (evaluation.notComputableReason ?? '').includes('selected nobody'),
        'the flag must carry the real reason, not a generic one'
    );
});

test('a thin reference cohort yields a rate but no ratio', () => {
    // THE REFERENCE COHORT IS A DENOMINATOR, AND A DENOMINATOR NEEDS A FLOOR.
    //
    // `summariseCohort` hands back a non-null rate for any cohort holding a single scored
    // answer, and the reference arrives from the caller — a study may declare one, and the
    // declared path checks only that the cohort exists. So without a floor here, two people
    // could serve as the basis of comparison for every other cohort in the key.
    //
    // What that produces is not a wrong figure on the reference row. It is a manufactured
    // violation on every OTHER row: with two people in the reference, both above the
    // cutoff, the reference rate is a clean 1.0, so every other cohort's ratio becomes its
    // own rate divided by 1.0 and any cohort under 0.8 raises an adverse-impact flag. The
    // ratio is the only one of the four statistics that survives a thin reference — the
    // z-test refuses on MIN_COHORT_N and the chi-square on its expected cells — so the flag
    // would arrive with a null p-value and a null effect size beside it, and nothing in the
    // row by which a reader could discount it.
    const reference = summariseCohort([90, 95], FIXTURE_THRESHOLD);
    assert.equal(reference.scoredN, 2, 'the reference cohort is below the floor');
    close(reference.rate, 1, 1e-12, 'the thin reference rate is a real measurement');

    // 7 of 10 above the cutoff. Against the reference's 1.0 that is a ratio of 0.7.
    const scores = [80, 85, 90, 95, 70, 75, 65, 20, 30, 40];
    const metric = computeCohortMetric(
        { cohortKey: 'region', cohortValue: 'B', n: 10, scores },
        reference,
        FIXTURE_THRESHOLD
    );

    // First, the figure that must not be produced, shown to be producible. `fourFifthsRatio`
    // takes two rates and never sees an n, so it cannot refuse on size on its own — this is
    // the whole reason the floor has to live at the cohort level.
    const wouldBe = fourFifthsRatio(0.7, reference.rate as number);
    assert.equal(wouldBe.state, 'computed', 'the bare statistic has no size floor to stop it');
    if (wouldBe.state === 'computed') {
        assert.ok(
            wouldBe.value < FOUR_FIFTHS_THRESHOLD,
            'and the figure it would have returned breaches four-fifths'
        );
    }

    // The cohort's own rate is a real measurement and survives; only the comparison is
    // refused. The two must not be collapsed.
    assert.equal(metric.computable, true, 'this cohort IS computable');
    close(metric.selectionRate, 0.7, 1e-12, 'and its own rate is real');
    assert.equal(metric.adverseImpactRatio, null, 'but no ratio is formed against a two-person reference');
    assert.ok(
        (metric.ratioNotComputableReason ?? '').includes(String(MIN_COHORT_N)),
        `the ratio reason must name the floor, got: ${metric.ratioNotComputableReason}`
    );
    assert.ok(
        (metric.ratioNotComputableReason ?? '').includes('reference'),
        `the reason must name the thin side as the reference, got: ${metric.ratioNotComputableReason}`
    );

    // A cohort cannot breach four-fifths on a ratio that was never formed.
    const definition = biasFlagDefinition('adverseImpactRatio');
    assert.ok(definition);
    const evaluation = evaluateFlag(
        definition,
        metric.adverseImpactRatio,
        metric.pValue,
        metric.ratioNotComputableReason
    );
    assert.equal(evaluation.raised, false, 'the thin-reference flag must not be manufactured');
});

test('identical scores in both cohorts yield a rate but no effect size or z', () => {
    // Every score the same means the pooled spread is zero and the pooled proportion is 1.
    // Both tests are undefined; the rate is not.
    const flat = [70, 70, 70, 70, 70, 70];
    const metric = computeCohortMetric(
        { cohortKey: 'region', cohortValue: 'B', n: 6, scores: flat },
        summariseCohort(flat, FIXTURE_THRESHOLD),
        FIXTURE_THRESHOLD
    );

    assert.equal(metric.computable, true);
    close(metric.selectionRate, 1, 1e-12, 'everyone was selected');
    close(metric.adverseImpactRatio, 1, 1e-12, 'the ratio is still 1');
    assert.equal(metric.effectSize, null, 'zero pooled spread has no effect size — not 0');
    assert.equal(metric.zStatistic, null, 'a pooled proportion of 1 has no z-statistic');
    assert.equal(metric.pValue, null);
});

test('the tests refuse individually when their own conditions fail', () => {
    const small = refused(twoProportionZ(3, 4, 5, 6), 'two-proportion z below the floor');
    assert.ok(small.reason.includes(String(MIN_COHORT_N)), `got: ${small.reason}`);

    const emptyTable = refused(chiSquare2x2(1, 1, 1, 1), 'chi-square with tiny expected cells');
    assert.ok(emptyTable.reason.includes('5'), `got: ${emptyTable.reason}`);

    const zeroSpread = refused(cohensD(70, 0, 10, 60, 0, 10), "Cohen's d with zero spread");
    assert.ok(zeroSpread.reason.includes('zero'), `got: ${zeroSpread.reason}`);

    refused(cohensD(70, 10, 1, 60, 10, 1), "Cohen's d with one observation each");
    refused(fourFifthsRatio(0.5, null), 'four-fifths with no reference');
    refused(fourFifthsRatio(0.5, 0), 'four-fifths against a zero rate');

    // A refusal must carry words, not just a flag.
    for (const refusal of [small, emptyTable, zeroSpread]) {
        assert.ok(refusal.reason.trim().length > 10, `a refusal needs a real reason, got: "${refusal.reason}"`);
    }
});

// --------------------------------------------
// 4. No fabrication
// --------------------------------------------

section('4. No fabrication');

test('a refusal carries no value at all, so a caller cannot read one', () => {
    const refusals = [
        fourFifthsRatio(null, 0.8),
        fourFifthsRatio(0.4, 0),
        twoProportionZ(1, 2, 3, 4),
        chiSquare2x2(1, 1, 1, 1),
        cohensD(70, 10, 1, 60, 10, 1),
        itemDifferential([80, 82], [60, 62]),
    ];

    for (const refusal of refusals) {
        assert.equal(refusal.state, 'refused');
        // The load-bearing assertion: not "the value is not zero" but "there is no value
        // property". A caller cannot accidentally read a fabricated number out of this.
        assert.ok(!('value' in refusal), 'a refusal must not carry a value property');
    }
});

test('a refused metric never reports a numeric rate', () => {
    const reference = summariseCohort([80, 85, 90, 95, 70, 75], FIXTURE_THRESHOLD);
    const refusals: CohortMetricResult[] = [
        computeCohortMetric({ cohortKey: 'k', cohortValue: 'v', n: 3, scores: [80, 90, 70] }, reference, FIXTURE_THRESHOLD),
        computeCohortMetric({ cohortKey: 'k', cohortValue: 'v', n: 50, scores: [80, 90, 70] }, null, null),
        computeCohortMetric({ cohortKey: 'k', cohortValue: 'v', n: 10, scores: [] }, reference, FIXTURE_THRESHOLD),
    ];

    for (const metric of refusals) {
        assert.equal(metric.computable, false);
        assert.equal(metric.selectionRate, null, 'a refused cohort must not carry a rate');
        assert.equal(metric.adverseImpactRatio, null);
        assert.ok((metric.notComputableReason ?? '').trim().length > 10, 'a refusal must explain itself');
    }
});

test('the computable flag and the selection rate never disagree', () => {
    // This is the invariant the CohortMetric CHECK constraint enforces in the database.
    // Asserting it here means a violation is caught in the pure module rather than as a
    // failed insert at runtime.
    const reference = summariseCohort([80, 85, 90, 95, 70, 75], FIXTURE_THRESHOLD);
    const cases: CohortMetricResult[] = [
        computeCohortMetric({ cohortKey: 'k', cohortValue: 'a', n: 6, scores: [80, 90, 70, 65, 85, 95] }, reference, FIXTURE_THRESHOLD),
        computeCohortMetric({ cohortKey: 'k', cohortValue: 'b', n: 3, scores: [80, 90, 70] }, reference, FIXTURE_THRESHOLD),
        computeCohortMetric({ cohortKey: 'k', cohortValue: 'c', n: 10, scores: [] }, reference, FIXTURE_THRESHOLD),
        computeCohortMetric({ cohortKey: 'k', cohortValue: 'd', n: 6, scores: [80, 90, 70, 65, 85, 95] }, null, null),
        computeCohortMetric({ cohortKey: 'k', cohortValue: 'e', n: 6, scores: [80, 90, 70, 65, 85, 95] }, reference, 60),
    ];

    for (const metric of cases) {
        const hasRate = metric.selectionRate !== null;
        const hasReason = metric.notComputableReason !== null;
        assert.equal(
            metric.computable,
            hasRate,
            `computable (${metric.computable}) must equal "has a rate" (${hasRate}) for ${metric.cohortValue}`
        );
        assert.equal(
            metric.computable,
            !hasReason,
            `computable (${metric.computable}) must equal "has no reason" (${!hasReason}) for ${metric.cohortValue}`
        );
    }
});

test('a flag with no statistic is a refusal, never a silent negative', () => {
    const definition = biasFlagDefinition('adverseImpactRatio');
    assert.ok(definition);

    const refusedFlag = evaluateFlag(definition, null, null, 'the reference cohort selected nobody');
    assert.equal(refusedFlag.raised, false);
    assert.equal(refusedFlag.notComputableReason, 'the reference cohort selected nobody');

    const computed = evaluateFlag(definition, 0.5, 0.2, null);
    assert.equal(computed.raised, true, '0.5 is below four-fifths');
    assert.equal(computed.notComputableReason, null, 'a computed flag carries no refusal reason');

    const notRaised = evaluateFlag(definition, 0.95, 0.9, null);
    assert.equal(notRaised.raised, false);
    assert.equal(notRaised.notComputableReason, null, 'a real negative is not a refusal');

    // An effect-size flag fires in either direction; a ratio flag only below.
    const effect = biasFlagDefinition('scoreDistributionGap');
    assert.ok(effect);
    assert.equal(evaluateFlag(effect, 1.2, null, null).raised, true, 'a large positive gap is reportable');
    assert.equal(evaluateFlag(effect, -1.2, null, null).raised, true, 'and so is a large negative one');
    assert.equal(evaluateFlag(effect, 0.1, null, null).raised, false);

    // A p-value flag needs a p-value; without one it is a refusal, not a pass.
    const pFlag = biasFlagDefinition('selectionRateSignificantGap');
    assert.ok(pFlag);
    const noP = evaluateFlag(pFlag, 2.5, null, null);
    assert.equal(noP.raised, false);
    assert.ok((noP.notComputableReason ?? '').trim().length > 0, 'a missing p-value must be explained');
});

test('every flag in the registry names its own innocent reading', () => {
    assert.ok(BIAS_FLAGS.length > 0);
    const seen = new Set<string>();

    for (const definition of BIAS_FLAGS) {
        assert.ok(!seen.has(definition.key), `duplicate flag key: ${definition.key}`);
        seen.add(definition.key);

        // The field this feature exists to get right. A flag without it is an accusation
        // against a group of people with no stated limits.
        assert.ok(
            definition.whatItCannotSay.trim().length > 40,
            `${definition.key}: whatItCannotSay is empty or too short to be useful`
        );
        assert.ok(definition.recommendation.trim().length > 20, `${definition.key}: needs a real recommendation`);
        assert.ok(definition.description.trim().length > 0, `${definition.key}: needs a description`);
        assert.ok(Number.isFinite(definition.threshold), `${definition.key}: needs a finite threshold`);
        assert.ok(
            definition.whatItCannotSay.toLowerCase().includes('cannot'),
            `${definition.key}: must be phrased as a limit`
        );
    }

    // No definition may carry a verdict. A table that can record "biased: yes" will
    // eventually be read as one, so the fields simply do not exist.
    for (const definition of BIAS_FLAGS) {
        for (const forbidden of ['verdict', 'compliant', 'compliance', 'action', 'resolution', 'approved']) {
            assert.ok(
                !Object.prototype.hasOwnProperty.call(definition, forbidden),
                `${definition.key} must not carry a "${forbidden}" field`
            );
        }
    }

    assert.ok(notableFlagKeys().length > 0);
    assert.ok(FAIRNESS_REGISTRY_VERSION >= 1);
    // Every target type the migration's CHECK constraint allows must be reachable, or the
    // report's "where in the pipeline" claim has a level nothing can produce.
    for (const targetType of ['cohort', 'item', 'dimension', 'stage']) {
        assert.ok(
            BIAS_FLAGS.some((definition) => definition.targetType === targetType),
            `no flag targets "${targetType}", which the schema allows and the report describes`
        );
    }
});

test('every clause citation states what it does NOT claim', () => {
    assert.ok(CLAUSE_CITATIONS.length > 0);
    for (const citation of CLAUSE_CITATIONS) {
        assert.ok(citation.doesNotClaim.trim().length > 60, `${citation.id}: the disclaimer is the point of the citation`);
        assert.ok(citation.citedFor.trim().length > 0, `${citation.id}: must say what it is cited for`);
        assert.ok(citation.duty.trim().length > 0, `${citation.id}: must state the duty`);
        // Each disclaimer must actually disclaim something, not just add reassuring words.
        assert.ok(
            /not |no |neither |nothing /i.test(citation.doesNotClaim),
            `${citation.id}: the disclaimer must be a denial, got: "${citation.doesNotClaim}"`
        );
    }
    assert.ok(CLAUSE_CITATIONS.some((c) => c.id === 'nyc-ll144'));
    assert.ok(CLAUSE_CITATIONS.some((c) => c.id === 'eu-ai-act-annex-iii'));
    assert.ok(CLAUSE_CITATIONS.some((c) => c.id === 'gdpr-article-22'));
});

test('the base caveats say something, and the four-fifths explanation names its own limit', () => {
    assert.ok(BASE_CAVEATS.length >= 4);
    for (const caveat of BASE_CAVEATS) {
        assert.ok(caveat.trim().length > 40, `a caveat is too short to carry weight: "${caveat}"`);
    }
    // The explanation must travel with the number: it is the only thing stopping a reader
    // taking a ratio as a finding.
    assert.ok(FOUR_FIFTHS_EXPLANATION.includes('0.8'));
    assert.ok(/screening|rule of thumb/i.test(FOUR_FIFTHS_EXPLANATION));
    assert.ok(/no notion of sample size|sample size/i.test(FOUR_FIFTHS_EXPLANATION));
});

// --------------------------------------------
// 5. No protected attribute can enter as a cohort
// --------------------------------------------

section('5. No protected attribute can enter as a cohort');

test('the protected-attribute check matches tokens, not substrings', () => {
    // The false-positive guard. A substring check on "age" would reject "language",
    // "coverage" and "stage" — and a denylist that rejects legitimate vocabulary is one
    // somebody works around rather than fixes.
    assert.equal(protectedAttributeIn('language'), null, '"language" must not trip the age rule');
    assert.equal(protectedAttributeIn('coverage'), null);
    assert.equal(protectedAttributeIn('stage'), null);
    assert.equal(protectedAttributeIn('experienceBand'), null);
    assert.equal(protectedAttributeIn('region'), null);
    assert.equal(protectedAttributeIn('institution'), null);
    assert.equal(protectedAttributeIn('cohort'), null);

    // And the real ones, including through camelCase.
    assert.equal(protectedAttributeIn('gender'), 'gender');
    assert.equal(protectedAttributeIn('genderIdentity'), 'gender');
    assert.equal(protectedAttributeIn('candidateAge'), 'age');
    assert.equal(protectedAttributeIn('dateOfBirth'), 'birth');
    assert.equal(protectedAttributeIn('nationality'), 'nationality');
    assert.equal(protectedAttributeIn('ethnicity'), 'ethnicity');
    assert.equal(protectedAttributeIn('disabilityStatus'), 'disability');
    assert.equal(protectedAttributeIn('marital_status'), 'marital');

    assert.deepEqual(splitCohortKeyTokens('experienceBand'), ['experience', 'band']);
    assert.deepEqual(splitCohortKeyTokens('experience_band'), ['experience', 'band']);
});

test('a declaration naming a protected attribute is refused, not stored', () => {
    const config = JSON.stringify({
        fairness: {
            cohortKeys: [
                { key: 'gender', label: 'Gender', values: ['a', 'b'] },
                { key: 'region', label: 'Region', values: ['north', 'south'] },
            ],
            selectionThreshold: 60,
        },
    });

    const { declaration, issues } = parseCohortDeclaration(config);
    assert.equal(declaration.cohortKeys.length, 1, 'only the legitimate key may survive');
    assert.equal(declaration.cohortKeys[0].key, 'region');
    assert.ok(
        issues.some((issue) => issue.includes('gender') && /protected attribute/i.test(issue)),
        `the refusal must say why, got: ${issues.join(' | ')}`
    );

    // And the refusal holds at the tagging boundary too, with its own message.
    const validation = validateAssignment(declaration, 'gender', 'a');
    assert.equal(validation.state, 'refused');
    if (validation.state === 'refused') {
        assert.ok(/protected attribute/i.test(validation.reason), validation.reason);
    }
});

test('a declaration that cannot be parsed yields an empty one and never throws', () => {
    // `configJSON` is free text a study author wrote. A malformed value is a fact about
    // their configuration, not a reason for an audit route to return a 500 — and certainly
    // not a reason to analyse a half-parsed schema as though it were complete.
    for (const bad of ['', '   ', '{not json', 'null', '"a string"', '[]']) {
        const result = parseCohortDeclaration(bad);
        assert.equal(result.undeclared, true, `"${bad}" must yield an undeclared result`);
        assert.equal(result.declaration.cohortKeys.length, 0);
    }

    const malformed = parseCohortDeclaration('{not json');
    assert.ok(malformed.issues.length > 0, 'a malformed config must be reported, not silently ignored');

    // No fairness block at all is not an error — it is simply undeclared.
    const plain = parseCohortDeclaration(JSON.stringify({ researchQuestion: 'x' }));
    assert.equal(plain.undeclared, true);
    assert.equal(plain.issues.length, 0);
});

test('an out-of-range cutoff and a sub-floor cohort size are reported and corrected', () => {
    const { declaration, issues } = parseCohortDeclaration(
        JSON.stringify({
            fairness: {
                cohortKeys: [{ key: 'region', values: ['north', 'south'] }],
                selectionThreshold: 140,
                minCohortSize: 2,
            },
        })
    );

    assert.equal(declaration.selectionThreshold, null, 'a cutoff outside 0–100 must not be used');
    assert.equal(declaration.minCohortSize, MIN_COHORT_N, 'the floor must not be lowered');
    assert.ok(issues.some((issue) => /cutoff/i.test(issue)), `got: ${issues.join(' | ')}`);
    assert.ok(issues.some((issue) => /minimum cohort size/i.test(issue)), `got: ${issues.join(' | ')}`);

    // A study may RAISE the floor; that is respected.
    const raised = parseCohortDeclaration(
        JSON.stringify({
            fairness: {
                cohortKeys: [{ key: 'region', values: ['north', 'south'] }],
                minCohortSize: 25,
            },
        })
    );
    assert.equal(raised.declaration.minCohortSize, 25);
});

test('an undeclared value is refused, and the declaration stays bounded', () => {
    const { declaration } = parseCohortDeclaration(
        JSON.stringify({
            fairness: { cohortKeys: [{ key: 'region', label: 'Region', values: ['north', 'south'] }] },
        })
    );

    assert.equal(validateAssignment(declaration, 'region', 'north').state, 'accepted');
    const offensive = validateAssignment(declaration, 'region', 'unsure');
    assert.equal(offensive.state, 'refused');
    if (offensive.state === 'refused') {
        assert.ok(/not one of the values/i.test(offensive.reason), offensive.reason);
    }
    assert.equal(validateAssignment(declaration, 'nowhere', 'north').state, 'refused');

    // A study cannot declare its way to an unbounded schema.
    const many = parseCohortDeclaration(
        JSON.stringify({
            fairness: {
                cohortKeys: Array.from({ length: 10 }, (_, index) => ({
                    key: `key${index}`,
                    values: ['a', 'b'],
                })),
            },
        })
    );
    assert.ok(
        many.declaration.cohortKeys.length <= MAX_COHORT_KEYS,
        `expected at most ${MAX_COHORT_KEYS} keys, got ${many.declaration.cohortKeys.length}`
    );
    assert.ok(many.issues.some((issue) => /cohort keys/i.test(issue)));

    assert.ok(describeDeclaration(declaration).includes('Region'));
    assert.ok(describeDeclaration({ ...declaration, cohortKeys: [] }).includes('has not declared any cohorts'));
});

// --------------------------------------------
// 6. Provenance is append-only
// --------------------------------------------

section('6. Provenance is append-only');

const LOGGED: ScoreSet = {
    technicalScore: 80,
    communicationScore: 70,
    confidenceScore: 60,
    logicScore: 75,
    depthScore: 65,
};

test('the decision-log module exports no way to change or remove a row', () => {
    // The strongest available guarantee, asserted structurally rather than promised in a
    // comment: there is no update, delete or remove function to call. A reviewer history
    // that can be rewritten is not a history, and the way to guarantee nobody rewrites it
    // is to give nobody a function that can.
    const forbidden = Object.keys(decisionLogModule).filter((name) =>
        /update|delete|remove|patch|rewrite|overwrite|purge|clear|set[A-Z]|edit/i.test(name)
    );
    assert.deepEqual(
        forbidden,
        [],
        `the decision log must expose no mutating export; found: ${forbidden.join(', ')}`
    );

    // It must still be able to append and read.
    for (const required of ['appendScoredDecision', 'appendLinkedDecision', 'findScoredDecision', 'sessionDecisions']) {
        assert.ok(
            typeof (decisionLogModule as Record<string, unknown>)[required] === 'function',
            `expected ${required} to be exported`
        );
    }
});

test('a partial score set is not measured, rather than filled in', () => {
    // The most common way to fabricate a measurement is not to invent a number — it is to
    // accept an incomplete set and let a default fill the gap.
    const complete = readScoreSet({ ...LOGGED });
    assert.equal(complete.state, 'measured');

    for (const missing of SCORE_DIMENSIONS) {
        const partial: Record<string, unknown> = { ...LOGGED };
        delete partial[missing];
        const read = readScoreSet(partial);
        assert.equal(read.state, 'not_measured', `a set missing ${missing} must not be measured`);
        if (read.state === 'not_measured') {
            assert.ok(read.reason.includes(missing), `the reason must name the missing dimension, got: ${read.reason}`);
        }
    }

    assert.equal(readScoreSet(null).state, 'not_measured');
    assert.equal(readScoreSet({ ...LOGGED, depthScore: 'high' }).state, 'not_measured');
    assert.equal(readScoreSet({ ...LOGGED, depthScore: 140 }).state, 'not_measured', 'outside 0–100 is not a score');
});

test('a claimed score set that was never logged is recorded as unverified, never matched', () => {
    // The case this feature exists for: scores arrive from a client and no model decision
    // can be traced to them. They are persisted — the interview must not break — but they
    // are labelled, and the label is the honest one.
    const forged: ScoreSet = {
        technicalScore: 100,
        communicationScore: 100,
        confidenceScore: 100,
        logicScore: 100,
        depthScore: 100,
    };

    const untraced = verifyScores({ found: false, loggedScores: null }, forged);
    assert.equal(untraced.verification, 'unverified', 'an untraceable claim is never a match');
    assert.ok(untraced.reason.length > 20, 'the row must say why it is unverified');
    assert.deepEqual(untraced.persist, forged, 'the scores are not thrown away, they are labelled');
    assert.equal(untraced.mismatch, null, 'nothing was compared, so nothing diverged');
});

test('a traced decision with no model scores is recorded as not measured', () => {
    const result = verifyScores({ found: true, loggedScores: null }, null);
    assert.equal(result.verification, 'no_scores');
    assert.equal(result.persist, null, 'not measured means null, never five zeroes');
});

test('a mismatch is recorded as evidence and the MODEL scores are persisted', () => {
    const inflated: ScoreSet = {
        technicalScore: 100,
        communicationScore: 70,
        confidenceScore: 60,
        logicScore: 75,
        depthScore: 65,
    };

    const result = verifyScores({ found: true, loggedScores: LOGGED }, inflated);
    assert.equal(result.verification, 'mismatch');
    assert.deepEqual(result.persist, LOGGED, 'the model\'s scores are what gets stored');
    assert.ok(result.mismatch !== null, 'the divergence must be preserved');
    if (result.mismatch) {
        assert.deepEqual(result.mismatch.claimed, inflated);
        assert.deepEqual(result.mismatch.logged, LOGGED);
        assert.equal(result.mismatch.deltas.technicalScore, 20);
        assert.equal(result.mismatch.deltas.depthScore, 0);
    }
});

test('a matching claim and an absent claim both persist the model scores', () => {
    const exact = verifyScores({ found: true, loggedScores: LOGGED }, { ...LOGGED });
    assert.equal(exact.verification, 'match');
    assert.deepEqual(exact.persist, LOGGED);
    assert.equal(exact.mismatch, null);

    const absent = verifyScores({ found: true, loggedScores: LOGGED }, null);
    assert.equal(absent.verification, 'match', 'asserting nothing is not asserting something different');
    assert.deepEqual(absent.persist, LOGGED);
    assert.equal(absent.mismatch, null);

    // Float round-tripping is inside the tolerance; a real difference is not.
    const rounded = verifyScores({ found: true, loggedScores: LOGGED }, { ...LOGGED, depthScore: 65.005 });
    assert.equal(rounded.verification, 'match');
    const off = verifyScores({ found: true, loggedScores: LOGGED }, { ...LOGGED, depthScore: 65 + SCORE_MATCH_TOLERANCE * 2 });
    assert.equal(off.verification, 'mismatch');
});

test('a linked row with no scored row reports no provenance rather than a guess', () => {
    const linkedRow = {
        id: 'l1',
        decisionId: 'd1',
        phase: 'linked',
        sessionId: 's1',
        responseId: 'r1',
        modelId: null,
        provider: null,
        promptVersion: null,
        inputHash: null,
        scoresJSON: null,
        verification: 'unverified',
        outputJSON: { note: 'no recorded model decision matched this answer' },
        decidedAt: new Date('2026-09-24T10:00:00Z'),
    };

    const record = fromStoredDecision(null, linkedRow);
    assert.equal(record.scores, null, 'no scores may be invented from a missing decision');
    assert.equal(record.modelId, null, 'no model may be named when none was recorded');
    assert.equal(record.promptVersion, null);
    assert.equal(record.verification, 'unverified');
    assert.equal(record.sessionId, 's1');
    assert.ok((record.note ?? '').length > 0);

    // And with both rows present, the provenance comes from the scored row and the
    // outcome from the linked one.
    const scoredRow = {
        id: 's1',
        decisionId: 'd1',
        phase: 'scored',
        sessionId: null,
        responseId: null,
        modelId: 'gemini-2.5-flash',
        provider: 'gemini',
        promptVersion: 'interview-v1',
        inputHash: 'abc123',
        scoresJSON: { ...LOGGED },
        verification: null,
        outputJSON: null,
        decidedAt: new Date('2026-09-24T09:59:00Z'),
    };
    const paired = fromStoredDecision(scoredRow, linkedRow);
    assert.equal(paired.modelId, 'gemini-2.5-flash');
    assert.equal(paired.promptVersion, 'interview-v1');
    assert.deepEqual(paired.scores, LOGGED);
    assert.equal(paired.verification, 'unverified');
});

test('the input hash is stable for the same input and moves when the input does', () => {
    const base = {
        studyId: 'study-1',
        messages: [
            { role: 'system', content: 'You are an interviewer.' },
            { role: 'user', content: 'Tell me about a system you designed.' },
        ],
    };

    const first = hashInput(base);
    const second = hashInput({ ...base, messages: [...base.messages] });
    assert.equal(first, second, 'the same input must hash the same way');
    assert.match(first, /^[0-9a-f]{64}$/, 'sha256 in hex');

    // Property order must not matter, or the hash cannot recognise a repeated input.
    const reordered = hashInput({
        messages: base.messages.map((message) => ({ content: message.content, role: message.role })),
        studyId: base.studyId,
    });
    assert.equal(reordered, first, 'key order must not change the hash');

    assert.notEqual(hashInput({ ...base, studyId: 'study-2' }), first, 'a different study is different input');
    assert.notEqual(
        hashInput({ ...base, messages: [{ role: 'user', content: 'something else' }] }),
        first,
        'different messages are different input'
    );
    assert.notEqual(hashInput({ ...base, promptVersion: 'interview-v2' }), first, 'a new prompt version is different input');
});

test('the stored output is a summary, never the candidate\'s own words', () => {
    // "Zero new PII columns" is only true if the log does not become a second copy of the
    // transcript. The raw model response carries the interviewer's prose - which quotes the
    // candidate - and the profile values extracted from the candidate's own words. Storing
    // that would collect their data twice, for an audit purpose they never agreed to, while
    // every column-level check still passed.
    const raw = {
        message: 'You mentioned you led the migration at Northwind - tell me about the rollback.',
        questionAddressed: 1,
        phaseTransition: 'exploration',
        shouldConclude: false,
        profileUpdates: [
            { fieldId: 'employer', value: 'Northwind Ltd', status: 'extracted' },
            { fieldId: 'yearsOfExperience', value: '7 years', status: 'extracted' },
        ],
        scores: { technical: 80, communication: 70, confidence: 60, logic: 75, depth: 65 },
    };

    const redacted = redactOutput(raw);
    assert.ok(redacted, 'a redacted output must be produced');

    // The load-bearing assertions: none of the candidate's content survives.
    const serialised = JSON.stringify(redacted);
    assert.ok(!serialised.includes('Northwind'), 'the extracted employer must not be stored');
    assert.ok(!serialised.includes('7 years'), 'the extracted value must not be stored');
    assert.ok(!serialised.includes('rollback'), 'the model prose must not be stored');
    assert.ok(!serialised.includes('migration'), 'no fragment of the prose may survive');

    // The structure - the part that makes the decision checkable - is kept.
    assert.equal(redacted.profileFieldsUpdated, 2, 'the COUNT of profile updates is kept, not the values');
    assert.equal(redacted.messageLength, raw.message.length, 'the message LENGTH is kept, not the message');
    assert.equal(redacted.scoresReturned, true);
    assert.equal(redacted.questionAddressed, 1);
    assert.equal(redacted.phaseTransition, 'exploration');
    assert.equal(redacted.shouldConclude, false);

    // Absent or malformed output is null rather than an invented shape.
    assert.equal(redactOutput(null), null);
    assert.equal(redactOutput(undefined), null);
    assert.equal(redactOutput('a string'), null);

    // A response with no scores says so.
    const noScores = redactOutput({ message: 'Hi', profileUpdates: [] });
    assert.ok(noScores);
    assert.equal(noScores.scoresReturned, false);
    assert.equal(noScores.profileFieldsUpdated, 0);
});

test('the provenance label and the persisted scores can never disagree', () => {
    // This is the invariant `Response_score_source_measured_check` enforces in the
    // database. Asserting it here means a violation surfaces in the pure module rather
    // than as a failed insert halfway through an interview.
    const present: ScoreSet = {
        technicalScore: 80,
        communicationScore: 70,
        confidenceScore: 60,
        logicScore: 75,
        depthScore: 65,
    };

    // Nothing to persist implies 'not_measured', whatever was concluded about provenance.
    for (const verification of ['match', 'mismatch', 'no_scores', 'unverified'] as const) {
        assert.equal(
            scoreSourceFor(verification, null),
            'not_measured',
            `a null score set must be labelled not_measured, not ${verification}`
        );
    }

    // Scores that were read back from a recorded decision are 'llm'.
    assert.equal(scoreSourceFor('match', present), 'llm');
    assert.equal(scoreSourceFor('mismatch', present), 'llm', 'a mismatch still stores the MODEL scores');

    // Scores nobody could trace to a decision are 'unverified' - kept as evidence of a
    // claim, and excluded from every fairness figure.
    assert.equal(scoreSourceFor('unverified', present), 'unverified');

    // The combination 'no_scores' plus a non-null set is unreachable (the model returned
    // nothing, so there is nothing to persist), and if it were ever reached it must not be
    // labelled 'llm'. 'unverified' is the conservative answer.
    assert.equal(scoreSourceFor('no_scores', present), 'unverified');
});

test('only a traced measurement counts as one', () => {
    // The gate every consumer of the five score columns goes through. `Number(row.x) || 0`
    // reads a not-measured answer as a confident zero; this is what stops that.
    assert.equal(isMeasuredResponse({ scoreSource: 'llm' }), true);

    for (const label of ['unverified', 'not_measured', 'LLM', 'llm ', '', null, undefined, 0, 1]) {
        assert.equal(
            isMeasuredResponse({ scoreSource: label }),
            false,
            `"${String(label)}" must not count as a measurement`
        );
    }

    // An absent row, and a row with no label at all (pre-migration shape), are not
    // measurements either - the default is not "trust it".
    assert.equal(isMeasuredResponse(null), false);
    assert.equal(isMeasuredResponse(undefined), false);
    assert.equal(isMeasuredResponse({}), false, 'a row with no provenance label is not a measurement');
});

// --------------------------------------------
// 7. The report cites clauses without overclaiming
// --------------------------------------------

section('7. The report cites clauses without overclaiming');

function fixtureRun(overrides: Record<string, unknown> = {}) {
    return {
        id: 'run-1',
        studyId: 'study-1',
        scope: 'study',
        status: 'succeeded',
        cohortDeclarationJSON: {
            cohortKeys: [{ key: 'region', label: 'Region', values: ['north', 'south'] }],
            selectionThreshold: 60,
        },
        selectionThreshold: 60,
        sampleSize: 40,
        includedSessions: 40,
        registryVersion: FAIRNESS_REGISTRY_VERSION,
        caveatsJSON: [...BASE_CAVEATS],
        excludedJSON: [{ reason: 'Sessions with no verified AI score.', count: 4 }],
        summaryJSON: {
            referenceByKey: { region: { value: 'north', reason: 'Declared by the study.' } },
            comparisonCount: 3,
        },
        error: null,
        ...overrides,
    };
}

const fixtureMetrics = [
    {
        cohortKey: 'region',
        cohortValue: 'north',
        n: 20,
        scoredN: 20,
        selectedCount: 12,
        selectionRate: 0.6,
        referenceRate: 0.6,
        adverseImpactRatio: 1,
        zStatistic: 0,
        pValue: 1,
        chiSquare: 0,
        effectSize: 0,
        computable: true,
        notComputableReason: null,
    },
    {
        cohortKey: 'region',
        cohortValue: 'south',
        n: 20,
        scoredN: 20,
        selectedCount: 6,
        selectionRate: 0.3,
        referenceRate: 0.6,
        adverseImpactRatio: 0.5,
        zStatistic: -3.09,
        pValue: 0.002,
        chiSquare: 8.6,
        effectSize: 3.4,
        computable: true,
        notComputableReason: null,
    },
];

const fixtureFlags = [
    {
        severity: 'high',
        targetType: 'cohort',
        label: 'Region',
        cohortValue: 'south',
        finding: 'Cohort "south" was selected at 50% of the reference rate.',
        whatItCannotSay: 'It cannot tell a biased process from a cohort that was genuinely weaker.',
        recommendation: 'Read the ratio with the p-value and the sizes.',
        statistic: 0.5,
        threshold: FOUR_FIFTHS_THRESHOLD,
        pValue: 0.002,
        computable: true,
        notComputableReason: null,
    },
];

test('the report carries every citation with its own disclaimer', () => {
    const report = buildComplianceReport({
        run: fixtureRun(),
        metrics: fixtureMetrics,
        flags: fixtureFlags,
        studyName: 'A study',
        generatedAt: new Date('2026-09-24T12:00:00Z'),
    });

    assert.equal(report.citations.length, CLAUSE_CITATIONS.length);
    assert.ok(report.disclaimers.length >= CLAUSE_CITATIONS.length + 3, 'each citation plus the general disclaimers');

    for (const disclaimer of report.disclaimers) {
        assert.ok(disclaimer.trim().length > 40, `a disclaimer is too short to carry weight: "${disclaimer}"`);
    }

    // The specific overclaims this feature must not make.
    const joined = report.disclaimers.join(' ');
    assert.ok(/NOT independent/i.test(joined), 'the NYC LL144 independence limit must be stated');
    assert.ok(/not a conformity assessment|not independent/i.test(joined));
    assert.ok(/does not make the hiring decision|not make the hiring decision/i.test(joined));
    assert.ok(/legal advice/i.test(joined));
    assert.ok(/not a finding of discrimination/i.test(joined));
});

test('the report renders the caveats, the exclusions and the refusals', () => {
    const report = buildComplianceReport({
        run: fixtureRun(),
        metrics: fixtureMetrics,
        flags: fixtureFlags,
        studyName: 'A study',
        generatedAt: new Date('2026-09-24T12:00:00Z'),
    });

    const blocks = reportBlocks(report);
    const text = reportToText(report);

    for (const caveat of BASE_CAVEATS) {
        assert.ok(text.includes(caveat), `the report must print the caveat: "${caveat.slice(0, 40)}…"`);
    }
    assert.ok(text.includes('Sessions with no verified AI score.'), 'exclusions must be printed');
    assert.ok(text.includes('What this cannot say:'), 'every flag must print its limits');
    assert.ok(text.includes('does not claim'), 'the citation section must state its limits');
    assert.ok(text.includes(FOUR_FIFTHS_EXPLANATION.slice(0, 40)), 'the ratio explanation must travel with the ratio');
    assert.ok(text.includes('NYC') || text.includes('Local Law 144'));

    // A computable metric row shows figures; the reference row is marked.
    const table = blocks.find((block) => block.kind === 'table');
    assert.ok(table, 'the cohort table must be present');
    assert.ok(table?.rows?.some((row) => row.some((cell) => cell.includes('(reference)'))), 'the reference row must be marked');
    assert.ok(table?.rows?.some((row) => row.includes('60.0%')), 'the reference cohort rate must appear as a percentage');
    assert.ok(table?.rows?.some((row) => row.includes('30.0%')), 'the other cohort rate must appear as a percentage');
    assert.ok(table?.rows?.some((row) => row.includes('0.50')), 'the adverse impact ratio must appear');
});

test('a not-computable cohort says so in the figures and in the text', () => {
    const report = buildComplianceReport({
        run: fixtureRun({ selectionThreshold: null }),
        metrics: [
            {
                cohortKey: 'region',
                cohortValue: 'south',
                n: 20,
                scoredN: 20,
                // Null rather than 0, which is what a no-cutoff run now stores: with no bar
                // to clear, nobody can be counted as selected, so the count does not exist.
                selectedCount: null,
                selectionRate: null,
                referenceRate: null,
                adverseImpactRatio: null,
                zStatistic: null,
                pValue: null,
                chiSquare: null,
                effectSize: null,
                computable: false,
                notComputableReason: 'this study declares no selection cutoff',
            },
        ],
        flags: [],
        studyName: 'A study',
        generatedAt: new Date('2026-09-24T12:00:00Z'),
    });

    const text = reportToText(report);
    assert.ok(text.includes('not computed'), 'a refused figure must read as not computed, never as 0');
    assert.ok(text.includes('this study declares no selection cutoff'), 'and the reason must be printed');
    assert.ok(!text.includes('0.00\n'), 'a refusal must not render as a zero anywhere');

    // The Selected column specifically. It is the one cell that could carry a plausible
    // number for a quantity that does not exist — the rate beside it already says "not
    // computed", so a 0 here would be the only figure on the row and would be read as one.
    const table = reportBlocks(report).find((block) => block.kind === 'table');
    assert.ok(table, 'the cohort table must be present even when nothing is computable');
    const selectedCell = table?.rows?.[1]?.[3];
    assert.equal(selectedCell, 'not computed', `the selected count must read as absent, got: ${selectedCell}`);
});

test('a failed run produces a report that says so and reports no figures', () => {
    // The one thing this document must never do is present an empty audit as a clean one.
    const report = buildComplianceReport({
        run: fixtureRun({ status: 'failed', error: 'the database was unreachable' }),
        metrics: [],
        flags: [],
        studyName: 'A study',
        generatedAt: new Date('2026-09-24T12:00:00Z'),
    });

    assert.equal(report.status, 'failed');
    assert.ok((report.error ?? '').includes('unreachable'));

    const text = reportToText(report);
    assert.ok(text.includes('did not produce figures'), 'a failed run must be announced');
    assert.ok(text.includes('the database was unreachable'), 'the error must be printed');
    assert.ok(
        text.includes('is not a finding of fairness'),
        'absence of findings must not read as a clean bill of health'
    );
    // The error path must not swallow the safety sentence, and the report must not claim
    // an analysis happened when no figures were produced.
    assert.ok(
        !text.includes('An analysis of'),
        'a failed run must not describe an analysis it did not perform'
    );
});

test('a failed run with no error message still states the limit of what it shows', () => {
    // The error column is nullable and a crashed process may well leave it empty. The
    // safety sentence cannot be conditional on a message that might not be there.
    const report = buildComplianceReport({
        run: fixtureRun({ status: 'failed', error: null }),
        metrics: [],
        flags: [],
        studyName: 'A study',
        generatedAt: new Date('2026-09-24T12:00:00Z'),
    });

    const text = reportToText(report);
    assert.ok(text.includes('did not produce figures'));
    assert.ok(text.includes('is not a finding of fairness'));
    assert.ok(!text.includes('An analysis of'));
});

test('a run with no flags says what that does and does not mean', () => {
    const report = buildComplianceReport({
        run: fixtureRun(),
        metrics: fixtureMetrics,
        flags: [],
        studyName: 'A study',
        generatedAt: new Date('2026-09-24T12:00:00Z'),
    });

    const text = reportToText(report);
    assert.ok(text.includes('No flag was raised'));
    assert.ok(
        text.includes('not a finding that the process is fair'),
        'an empty result must not be reported as a pass'
    );
});

test('the report names the scoring system, or says it could not', () => {
    // A bias audit is an audit *of something*. A reader who arrives after the study's model
    // has been changed cannot weigh a report that does not say which system it examined.
    const named = buildComplianceReport({
        run: fixtureRun(),
        metrics: fixtureMetrics,
        flags: fixtureFlags,
        studyName: 'A study',
        systemDescription: 'gemini gemini-2.0-flash, prompt version interview-v2, from 214 recorded model decisions',
        generatedAt: new Date('2026-09-24T12:00:00Z'),
    });
    assert.equal(named.systemDescription, 'gemini gemini-2.0-flash, prompt version interview-v2, from 214 recorded model decisions');
    const namedText = reportToText(named);
    assert.ok(namedText.includes('Scoring system:'), 'the system must be printed as a labelled line');
    assert.ok(namedText.includes('gemini-2.0-flash'));

    // Absent, the report SAYS it is absent. It must not fall silent - on a compliance
    // document, an omitted field and a field that states the value is unknown are different
    // claims, and only the second is true. Nor may it guess at a model name.
    for (const missing of [undefined, null, '', '   ']) {
        const unnamed = buildComplianceReport({
            run: fixtureRun(),
            metrics: fixtureMetrics,
            flags: fixtureFlags,
            studyName: 'A study',
            systemDescription: missing,
            generatedAt: new Date('2026-09-24T12:00:00Z'),
        });
        assert.equal(unnamed.systemDescription, null, `"${String(missing)}" must normalise to null`);
        const unnamedText = reportToText(unnamed);
        assert.ok(
            unnamedText.includes('Scoring system: not recorded for this run.'),
            'an unknown system must be stated, not omitted'
        );
    }

    // Printed for a failed run too, because it describes what produced the scores rather
    // than what the analysis found. The run that found nothing still needs to say what it
    // was looking at.
    const failed = buildComplianceReport({
        run: { ...fixtureRun(), status: 'failed', error: 'the study could not be read' },
        metrics: [],
        flags: [],
        studyName: 'A study',
        systemDescription: 'gemini gemini-2.0-flash',
        generatedAt: new Date('2026-09-24T12:00:00Z'),
    });
    const failedText = reportToText(failed);
    assert.ok(failedText.includes('Scoring system: gemini gemini-2.0-flash'));
    assert.ok(failedText.includes('did not produce figures') || failedText.includes('did not complete'));
});

test('no output of this feature carries a verdict or a compliance status', () => {
    const report = buildComplianceReport({
        run: fixtureRun(),
        metrics: fixtureMetrics,
        flags: fixtureFlags,
        studyName: 'A study',
        generatedAt: new Date('2026-09-24T12:00:00Z'),
    });

    const serialised = JSON.stringify(report);
    for (const forbidden of ['"verdict"', '"compliant"', '"complianceStatus"', '"passed"', '"approved"', '"biasConfirmed"']) {
        assert.ok(!serialised.includes(forbidden), `the report must not carry a ${forbidden} field`);
    }

    for (const disclaimer of reportDisclaimers()) {
        assert.ok(disclaimer.trim().length > 0);
    }
});

// ============================================
// 8. The PDF — the copy that gets filed
// ============================================
// The renderer is pure: it takes a report and returns bytes, touching no database, no
// network and no browser. That is deliberate — it means the document the feature exists to
// produce can be checked here, on every run, rather than only by eye in production.
section('8. The PDF renders the report, and discloses what it could not reproduce');

/**
 * Turn WinAnsi character codes back into text.
 *
 * The bytes in a content stream are character codes - not UTF-8, and not Latin-1. Over
 * most of the range WinAnsi and Latin-1 agree, but 0x80-0x9F is where they do not: 0x97
 * is an em dash, where Latin-1 would make it a control character. Decoding those bytes as
 * Latin-1 - the obvious first guess, and the first thing this extractor did - turns the em
 * dash in a cited clause into an unprintable byte, so the clause looks as though it never
 * reached the page in a document where it plainly did.
 *
 * This is WinAnsiEncoding's own table rather than a copy of the renderer's, and that
 * matters: it is the inverse of a published standard, which is what makes the assertions
 * below a check on the document rather than a restatement of the code that produced it.
 * 0x81, 0x8D, 0x8F, 0x90 and 0x9D are unassigned and fall through to Latin-1; the
 * renderer never emits them, because it only draws characters it has already cleared.
 */
const WIN_ANSI_HIGH: Record<number, string> = {
    0x80: '\u20AC', 0x82: '\u201A', 0x83: '\u0192', 0x84: '\u201E', 0x85: '\u2026',
    0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02C6', 0x89: '\u2030', 0x8A: '\u0160',
    0x8B: '\u2039', 0x8C: '\u0152', 0x8E: '\u017D', 0x91: '\u2018', 0x92: '\u2019',
    0x93: '\u201C', 0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
    0x98: '\u02DC', 0x99: '\u2122', 0x9A: '\u0161', 0x9B: '\u203A', 0x9C: '\u0153',
    0x9E: '\u017E', 0x9F: '\u0178',
};

function decodeWinAnsi(bytes: Buffer): string {
    let out = "";
    for (const byte of bytes) {
        const mapped = WIN_ANSI_HIGH[byte];
        out += mapped !== undefined ? mapped : String.fromCharCode(byte);
    }
    return out;
}

/**
 * The text drawn on a PDF's pages, as a single searchable string.
 *
 * WHY THIS EXISTS RATHER THAN A BYTE SEARCH
 *
 * Four things make a naive `Buffer.includes` lie about a PDF:
 *
 *  1. pdf-lib deflates every content stream with FlateDecode, so the drawn text is not in
 *     the file as readable bytes at all. Each stream has to be inflated first.
 *  2. The text is then drawn as HEX strings — `drawText` emits `<46616972…> Tj`, not
 *     `(Fairer…) Tj` — so even the inflated stream is not searchable as plain text.
 *  3. A phrase that wraps across a line is drawn as two separate text operations, so the
 *     phrase's characters are not contiguous even once decoded — and this report wraps
 *     constantly.
 *  4. The bytes are WinAnsi character codes, not UTF-8, so they are decoded through the
 *     table above — reading them as Latin-1 turns the em dash at 0x97 into a control
 *     character, and a clause containing one then looks as though it never reached the page.
 *
 * So each stream is inflated, each drawn string is decoded from whichever form it uses, and
 * the strings are joined with a space. That reconstructs a wrapped paragraph (and glues
 * unrelated lines together, which is harmless for finding a phrase — and is why assertions
 * that a phrase is ABSENT use sentences short enough not to be assembled by accident from
 * two neighbours).
 */
function pdfText(pdf: Uint8Array): string {
    const buffer = Buffer.from(pdf);
    const drawn: string[] = [];

    let index = 0;
    while (true) {
        const start = buffer.indexOf('stream', index);
        if (start === -1) break;

        // Step over `stream` and the newline that follows it.
        let bodyStart = start + 'stream'.length;
        if (buffer[bodyStart] === 0x0d) bodyStart += 1;
        if (buffer[bodyStart] === 0x0a) bodyStart += 1;

        const end = buffer.indexOf('endstream', bodyStart);
        if (end === -1) break;
        index = end + 'endstream'.length;

        // The slice includes the line break before `endstream`; trimming it avoids handing
        // the inflater trailing bytes it would otherwise have to be told to tolerate.
        let body = buffer.subarray(bodyStart, end);
        while (body.length && (body[body.length - 1] === 0x0d || body[body.length - 1] === 0x0a)) {
            body = body.subarray(0, body.length - 1);
        }

        let content: string;
        try {
            content = zlib
                .inflateSync(body, { finishFlush: zlib.constants.Z_SYNC_FLUSH })
                .toString('latin1');
        } catch {
            // Not deflated — either an uncompressed stream or something that is not a
            // stream body at all. Read it as it is and let the filter below decide.
            content = body.toString('latin1');
        }

        // Only content streams show text. Font programs and metadata are binary; including
        // them would add noise that could satisfy a substring by chance.
        if (!/T[Jj]/.test(content)) continue;

        // Both forms a text-showing operator can take, with the operator required so that a
        // hex string sitting in a dictionary is not mistaken for drawn text.
        const showPattern = /(?:<([0-9A-Fa-f\s]+)>|\(((?:\\.|[^\\()])*)\))\s*T[Jj]/g;
        let show: RegExpExecArray | null;
        while ((show = showPattern.exec(content)) !== null) {
            if (show[1] !== undefined) {
                // A hex string: two hex digits per character code, and the codes are
                // single-byte because the standard fonts are used with WinAnsi.
                drawn.push(decodeWinAnsi(Buffer.from(show[1].replace(/\s+/g, ''), 'hex')));
            } else {
                // The literal form. pdf-lib does not emit it, but a stream edited or
                // written by another producer might. The characters were reached through a
                // Latin-1 read of the bytes, so the same table applies to them.
                const unescaped = (show[2] ?? '').replace(/\\([()\\])/g, '$1');
                drawn.push(decodeWinAnsi(Buffer.from(unescaped, 'latin1')));
            }
        }
    }

    return drawn.join(' ');
}

/** True when the text was drawn onto some page. */
function pdfShows(pdf: Uint8Array, phrase: string): boolean {
    return pdfText(pdf).includes(phrase);
}

/**
 * The page count, from a real parse of the bytes rather than a regex over them.
 *
 * Loading the document back is also the strongest available check that it is a valid PDF:
 * a truncated or malformed file fails to load, which counting text would not catch.
 */
async function pdfPageCount(pdf: Uint8Array): Promise<number> {
    const parsed = await PDFDocument.load(pdf, { updateMetadata: false });
    return parsed.getPageCount();
}

void test('the PDF is a real PDF, not bytes with a header', async () => {
    const report = buildComplianceReport({
        run: fixtureRun(),
        metrics: fixtureMetrics,
        flags: fixtureFlags,
        studyName: 'Senior backend engineer — Q3',
        generatedAt: new Date('2026-09-24T12:00:00Z'),
    });

    const pdf = await renderReportPdf(report);

    // The magic number, so a reader that sniffs the type accepts it.
    assert.equal(Buffer.from(pdf.subarray(0, 5)).toString('latin1'), '%PDF-');
    // And an end-of-file marker, which is what makes a truncated download detectable.
    assert.ok(
        Buffer.from(pdf).toString('latin1').trimEnd().endsWith('%%EOF'),
        'the PDF must be complete, not truncated'
    );
    // The font resource it draws with, named in the clear because the document is saved
    // with its dictionaries uncompressed.
    assert.ok(
        Buffer.from(pdf).toString('latin1').includes('Helvetica'),
        'the document must name the font it draws with'
    );
    assert.ok(pdf.byteLength > 2000, `expected a substantial document, got ${pdf.byteLength} bytes`);

    // A real parse, which is what a PDF reader does. This is the assertion that would catch
    // a structurally broken file that still happens to contain the right text.
    assert.ok((await pdfPageCount(pdf)) >= 1, 'the PDF must have at least one page');
    // The document's own title, as the report defines it rather than as it was once
    // paraphrased here. 'Fairness audit' matched nothing for as long as it stood: the title
    // the report builds is 'Fairness & Bias Audit', so this assertion was failing on a PDF
    // that was drawing the title correctly. A test that names text the product does not
    // produce is a defect in the test, and it hid behind the same failure as the real one.
    assert.ok(pdfShows(pdf, 'Fairness & Bias Audit'), 'the title must be drawn on a page');
});

void test('every figure, caveat and citation in the report reaches the page', async () => {
    const report = buildComplianceReport({
        run: fixtureRun(),
        metrics: fixtureMetrics,
        flags: fixtureFlags,
        studyName: 'Senior backend engineer',
        systemDescription: 'gemini gemini-2.0-flash',
        generatedAt: new Date('2026-09-24T12:00:00Z'),
    });

    const pdf = await renderReportPdf(report);

    // The masthead, including the system that was audited. A bias audit that does not name
    // what it examined cannot be relied on by a reader who arrives after a config change.
    assert.ok(pdfShows(pdf, 'Scoring system: gemini gemini-2.0-flash'));
    assert.ok(pdfShows(pdf, 'Senior backend engineer'));

    // The cohort table's header and both of its rows, including the reference marker. The
    // header is the phrase that proves the table was laid out rather than dropped.
    assert.ok(pdfShows(pdf, 'chi-square (Yates)'), 'the table header must be on the page');
    assert.ok(pdfShows(pdf, 'north (reference)'));
    assert.ok(pdfShows(pdf, 'south'));

    // The finding, and the sentence that constrains it. These argue against each other, and
    // a document carrying the first without the second overstates what a statistic shows.
    assert.ok(pdfShows(pdf, 'was selected at 50% of the reference rate'));
    assert.ok(pdfShows(pdf, 'cannot tell a biased process from a cohort that was genuinely weaker'));

    // The exclusions, which are what stops the document reading as though every cohort in
    // the study were represented.
    assert.ok(pdfShows(pdf, 'What was left out, and why'));
    assert.ok(pdfShows(pdf, 'Sessions with no verified AI score'));

    // Every clause the report cites, by instrument and by clause, plus the sentence saying
    // what citing it does NOT establish.
    for (const citation of report.citations) {
        assert.ok(pdfShows(pdf, citation.instrument), `the PDF must name ${citation.instrument}`);
        assert.ok(pdfShows(pdf, citation.clause), `the PDF must cite clause ${citation.clause}`);
        assert.ok(
            pdfShows(pdf, 'What this report does not claim'),
            'each citation must carry its own disclaimer in the PDF too'
        );
    }

    // And the caveats and disclaimers, in full and in order. These are the longest blocks
    // and the ones most likely to be dropped by a renderer that only understands headings
    // and paragraphs — and they are the blocks that keep the figures honest.
    for (const caveat of report.caveats) {
        assert.ok(pdfShows(pdf, caveat), `the PDF must carry the caveat: ${caveat.slice(0, 48)}…`);
    }
    for (const disclaimer of report.disclaimers) {
        assert.ok(pdfShows(pdf, disclaimer), `the PDF must carry the disclaimer: ${disclaimer.slice(0, 48)}…`);
    }

    // Each bullet item of the methodology, which are drawn with a marker rather than as a
    // paragraph — a separate code path from the paragraphs above.
    for (const item of report.methodology) {
        assert.ok(pdfShows(pdf, item), `the PDF must carry the methodology line: ${item.slice(0, 48)}…`);
    }
});

void test('a long report gains pages, and every page says which page it is', async () => {
    // Enough cohorts to push the document past one page, so the page-break path — including
    // a table that spans a break and repeats its header — is exercised rather than assumed.
    const many = Array.from({ length: 40 }, (_, index) => ({
        ...fixtureMetrics[1],
        cohortValue: `cohort-${index}`,
        selectionRate: 0.2 + index * 0.001,
        adverseImpactRatio: 0.3 + index * 0.001,
        zStatistic: -2.5,
        pValue: 0.004,
        chiSquare: 6.1,
        effectSize: 2.2,
    }));

    const report = buildComplianceReport({
        run: fixtureRun(),
        metrics: many,
        flags: fixtureFlags,
        studyName: 'A study with many cohorts',
        generatedAt: new Date('2026-09-24T12:00:00Z'),
    });

    const pdf = await renderReportPdf(report);
    const pages = await pdfPageCount(pdf);
    const text = pdfText(pdf);

    assert.ok(pages > 1, `40 cohorts should span more than one page, got ${pages}`);
    // Numbered, and the total is the real total. "Page 1 of 1" on the first sheet of a
    // five-sheet document is how a reader loses the other four.
    assert.ok(text.includes(`Page 1 of ${pages}`), 'the first page must be numbered against the total');
    assert.ok(text.includes(`Page ${pages} of ${pages}`), 'the last page must be numbered');
    // The header repeats on the page the table continues onto, so the columns on that page
    // are labelled.
    const headerOccurrences = text.split('chi-square (Yates)').length - 1;
    assert.ok(
        headerOccurrences >= 2,
        `a table spanning a page break must repeat its header, found ${headerOccurrences}`
    );
    // Every cohort's own row is present — the table was not silently truncated at the break.
    for (const label of ['cohort-0', 'cohort-20', 'cohort-39']) {
        assert.ok(text.includes(label), `the PDF must carry the row for ${label}`);
    }
});

void test('text the standard fonts cannot draw is disclosed, never dropped', async () => {
    // A study-declared cohort label is free text. Greek, CJK and emoji are all reachable —
    // the label is typed by an interviewer — and pdf-lib throws on characters the standard
    // font cannot encode. A download must not become a 500 because someone named a cohort
    // in Japanese.
    const report = buildComplianceReport({
        run: fixtureRun(),
        metrics: [
            { ...fixtureMetrics[0], cohortValue: '日本語のコホート' },
            { ...fixtureMetrics[1], cohortValue: 'Τμήμα — Βόρεια' },
        ],
        flags: fixtureFlags,
        studyName: '国際 study 🎯',
        generatedAt: new Date('2026-09-24T12:00:00Z'),
    });

    const pdf = await renderReportPdf(report);
    const text = pdfText(pdf);

    // It rendered at all, and parses.
    assert.equal(Buffer.from(pdf.subarray(0, 5)).toString('latin1'), '%PDF-');
    assert.ok((await pdfPageCount(pdf)) >= 1);

    // The characters no equivalent exists for became '?' rather than being silently
    // dropped, and the document says how many there were. A reader of a compliance document
    // has to be able to tell that something was lost.
    assert.ok(text.includes('?'), 'an unrepresentable character must appear as a placeholder');
    assert.ok(
        text.includes('could not be represented in this document'),
        'the PDF must disclose that it substituted characters'
    );

    // Both directions of the substitution rule, asserted rather than assumed.
    //
    // An em dash IS WinAnsi, so it is drawn as itself: a report keeps the punctuation its
    // text was written with, and a sentence quoted from the JSON or the CSV can be found
    // here unchanged. This assertion has teeth — the renderer once carried a transliteration
    // entry for the em dash which could never fire, because `pdfSafe` clears anything WinAnsi
    // can encode before the table is consulted. An entry that cannot fire is harmless in
    // itself, but it documents a substitution that does not happen, which is the same class
    // of untruth the whole disclosure mechanism exists to prevent. Two of these have now
    // been found and removed; this is what would catch a third.
    assert.ok(
        text.includes('Τμήμα — Βόρεια'.replace(/[^\x20-\x7e—]/g, '?')),
        'the em dash must survive as itself, not be silently replaced'
    );

    // And a character WinAnsi genuinely cannot draw is replaced by its stated equivalent
    // rather than by a placeholder, because the equivalent carries the same meaning.
    const withSymbols = buildComplianceReport({
        run: fixtureRun(),
        metrics: [{ ...fixtureMetrics[0], cohortValue: 'cohort ≥ 60 χ²' }],
        flags: [],
        studyName: 'A symbols study',
        generatedAt: new Date('2026-09-24T12:00:00Z'),
    });
    const symbolsText = pdfText(await renderReportPdf(withSymbols));
    assert.ok(symbolsText.includes('cohort >= 60 chi'), 'a symbol with an equivalent must use it');
    assert.ok(
        !symbolsText.includes('could not be represented in this document'),
        'a transliteration is not a loss, and must not be reported as one'
    );

    // A report with nothing to lose must not claim otherwise: a disclosure that appears on
    // every document is one readers learn to ignore.
    const plain = buildComplianceReport({
        run: fixtureRun(),
        metrics: [{ ...fixtureMetrics[0], cohortValue: 'Plain ASCII cohort' }],
        flags: [],
        studyName: 'An ASCII study',
        generatedAt: new Date('2026-09-24T12:00:00Z'),
    });
    const plainText = pdfText(await renderReportPdf(plain));
    assert.ok(plainText.includes('Plain ASCII cohort'));
    assert.ok(
        !plainText.includes('could not be represented in this document'),
        'a report with nothing to substitute must not carry the disclosure note'
    );
});

void test('a non-succeeded run says so on the page, before any figure', async () => {
    // The failure mode this guards: a PDF of a failed run that opens to a tidy document
    // with no findings. Read on its own — and a filed PDF is always read on its own — that
    // is indistinguishable from a clean bill of health.
    const report = buildComplianceReport({
        run: fixtureRun({ status: 'failed', error: 'the study could not be read' }),
        metrics: [],
        flags: [],
        studyName: 'A study',
        generatedAt: new Date('2026-09-24T12:00:00Z'),
    });

    const pdf = await renderReportPdf(report);
    const text = pdfText(pdf);

    assert.ok(text.includes('This audit did not produce figures'));
    assert.ok(text.includes('the study could not be read'));
    assert.ok(
        text.includes('is not a finding of fairness'),
        'the absence of figures must not be readable as an absence of bias'
    );
    // The banner is drawn before the cohort section, not after it: a reader who stops at
    // the first page must already have been told.
    assert.ok(
        text.indexOf('This audit did not produce figures') < text.indexOf('Cohort figures'),
        'the failure notice must precede the figures section'
    );
});

// ============================================
// Summary
// ============================================
void (async () => {
    await Promise.all(pending);

    console.log(`\n${'-'.repeat(52)}`);
    if (failures.length === 0) {
        console.log(`fairness core: ${passed} checks passed`);
        process.exit(0);
    } else {
        console.log(`fairness core: ${passed} passed, ${failures.length} FAILED`);
        for (const failure of failures) console.log(`  - ${failure}`);
        process.exit(1);
    }
})();
