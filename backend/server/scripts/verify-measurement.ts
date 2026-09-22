// ============================================
// verify-measurement.ts — correctness checks for the IRT core
//
// The measurement engine makes claims about people, so its math is verified
// rather than assumed. This script has no dependencies beyond node:assert and
// runs without a database.
//
//   npm run verify:measurement        (from backend/)
//
// Exits non-zero on the first failure.
// ============================================

import assert from 'node:assert/strict';
import {
    ABILITY_MAX,
    ABILITY_MIN,
    confidenceInterval,
    estimateAbility,
    estimatedRemainingItems,
    inverseNormalCdf,
    isPreciseEnough,
    itemInformation,
    normalCdf,
    probabilityCorrect,
    reliabilityFromSE,
    scaleScoreToTheta,
    testInformation,
    thetaToScaleScore,
    type ItemParams,
    type ScoredResponse,
} from '../app/lib/measurement/irt';
import {
    MAX_DISCRIMINATION,
    MAX_GUESSING,
    MIN_DISCRIMINATION,
    MIN_GUESSING,
    deriveCorrectness,
    estimateGuessing,
    estimateItemParametersFromSamples,
    itemParamsForDifficulty,
    pointBiserial,
    shouldRetire,
    type CalibrationSample,
} from '../app/lib/measurement/calibrationMath';
import { isSameItem, itemKeyFor, itemLabel, normalizeItemText } from '../app/lib/measurement/itemIdentity';
import { propagateMastery, rankImprovementTargets } from '../app/lib/measurement/competencyGraph';
import {
    difficultyLabelFor,
    randomesquePick,
    rankItemsByInformation,
    stopDecision,
    targetDifficultyFor,
} from '../app/lib/measurement/selectionMath';

// --------------------------------------------
// Tiny harness
// --------------------------------------------

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
    try {
        fn();
        passed += 1;
        console.log(`  ok   ${name}`);
    } catch (error) {
        failures.push(`${name}: ${(error as Error).message}`);
        console.log(`  FAIL ${name}`);
        console.log(`       ${(error as Error).message}`);
    }
}

function close(actual: number, expected: number, tolerance: number, label = ''): void {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `${label} expected ${expected} ± ${tolerance}, got ${actual}`
    );
}

/** Deterministic PRNG so every run produces identical numbers. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Simulates a candidate of known ability answering a set of items. */
function simulate(trueTheta: number, items: ItemParams[], seed: number): ScoredResponse[] {
    const rand = mulberry32(seed);
    return items.map((item) => ({
        item,
        correct: rand() < probabilityCorrect(trueTheta, item),
    }));
}

/** A bank of items spread across the ability range. */
function makeBank(count: number, aMean = 1.2): ItemParams[] {
    const bank: ItemParams[] = [];
    for (let i = 0; i < count; i += 1) {
        const spread = count === 1 ? 0 : (i / (count - 1)) * 4 - 2; // -2 .. 2
        bank.push({ a: aMean, b: spread, c: 0.15 });
    }
    return bank;
}

// ============================================
// 1. Item response function
// ============================================

console.log('\n[1] Item response function (3PL)');

test('P(θ) at θ = b is the midpoint between the floor and 1', () => {
    const item: ItemParams = { a: 1.5, b: 0.75, c: 0.2 };
    // At θ = b the logistic term is exactly 0.5 ⇒ P = c + (1-c)/2
    close(probabilityCorrect(0.75, item), 0.2 + 0.8 * 0.5, 1e-12, 'P(b)');
});

test('P(θ) is monotone increasing in θ', () => {
    const item: ItemParams = { a: 1.2, b: 0, c: 0.25 };
    let previous = -Infinity;
    for (let theta = -4; theta <= 4; theta += 0.25) {
        const p = probabilityCorrect(theta, item);
        assert.ok(p > previous, `not increasing at θ=${theta}`);
        previous = p;
    }
});

test('P(θ) never falls below the guessing floor', () => {
    const item: ItemParams = { a: 1, b: 0, c: 0.33 };
    for (let theta = -8; theta <= 0; theta += 0.5) {
        assert.ok(probabilityCorrect(theta, item) >= 0.33 - 1e-12, `below floor at θ=${theta}`);
    }
});

test('Rasch case (a=1, c=0) gives exactly 0.5 at θ = b', () => {
    close(probabilityCorrect(1.1, { a: 1, b: 1.1, c: 0 }), 0.5, 1e-12, 'Rasch midpoint');
});

// ============================================
// 2. Item information
// ============================================

console.log('\n[2] Item information');

test('2PL information at θ = b equals a²/4', () => {
    // With c=0, I = a² P(1-P) and P = 0.5 ⇒ I = a²/4
    close(itemInformation(0, { a: 2, b: 0, c: 0 }), 4 / 4, 1e-12, 'I(b)');
});

test('information peaks at the item difficulty (2PL)', () => {
    const item: ItemParams = { a: 1.5, b: 0.5, c: 0 };
    const atB = itemInformation(0.5, item);
    for (const theta of [-2, -1, 0, 1, 2, 3]) {
        if (theta === 0.5) continue;
        assert.ok(itemInformation(theta, item) <= atB + 1e-12, `info higher at θ=${theta}`);
    }
});

test('information never goes negative', () => {
    for (const a of [0.5, 1, 2]) {
        for (const c of [0, 0.2, 0.4]) {
            for (let theta = -4; theta <= 4; theta += 0.5) {
                assert.ok(itemInformation(theta, { a, b: 0, c }) >= 0, `negative info a=${a} c=${c}`);
            }
        }
    }
});

test('information vanishes far from the item', () => {
    const item: ItemParams = { a: 1, b: 0, c: 0 };
    assert.ok(itemInformation(30, item) < 1e-9, 'info at θ=30 should be ~0');
    assert.ok(itemInformation(-30, item) < 1e-9, 'info at θ=-30 should be ~0');
});

test('testInformation sums item information', () => {
    const items: ItemParams[] = [
        { a: 1, b: -1, c: 0.1 },
        { a: 1.2, b: 0.5, c: 0.2 },
    ];
    const expected = items.reduce((sum, item) => sum + itemInformation(0.3, item), 0);
    close(testInformation(0.3, items), expected, 1e-12, 'sum');
});

// ============================================
// 3. Ability estimation
// ============================================

console.log('\n[3] Ability estimation');

test('no responses returns the prior, not a fabricated estimate', () => {
    const result = estimateAbility([]);
    close(result.theta, 0, 1e-12, 'theta');
    close(result.standardError, 1, 1e-12, 'SE');
    assert.equal(result.method, 'prior');
    assert.equal(result.converged, true);
});

test('a perfect score yields a finite, bounded estimate', () => {
    // The naive MLE would run to +∞ here. The prior must bound it.
    const items = makeBank(12);
    const responses: ScoredResponse[] = items.map((item) => ({ item, correct: true }));
    const result = estimateAbility(responses);

    assert.ok(Number.isFinite(result.theta), `theta must be finite, got ${result.theta}`);
    assert.ok(result.theta <= ABILITY_MAX, `theta ${result.theta} above ABILITY_MAX`);
    assert.ok(result.theta > 1, `theta ${result.theta} should be clearly high`);
});

test('an all-wrong score yields a finite, bounded low estimate', () => {
    const items = makeBank(12);
    const responses: ScoredResponse[] = items.map((item) => ({ item, correct: false }));
    const result = estimateAbility(responses);

    assert.ok(Number.isFinite(result.theta), `theta must be finite, got ${result.theta}`);
    assert.ok(result.theta >= ABILITY_MIN, `theta ${result.theta} below ABILITY_MIN`);
    assert.ok(result.theta < -1, `theta ${result.theta} should be clearly low`);
});

test('estimates are ordered by true ability across simulated candidates', () => {
    const items = makeBank(40);
    const thetas: number[] = [];

    for (const trueTheta of [-2, -1, 0, 1, 2]) {
        // Average several seeds to remove sampling noise from the ordering check.
        let sum = 0;
        const runs = 12;
        for (let seed = 1; seed <= runs; seed += 1) {
            sum += estimateAbility(simulate(trueTheta, items, seed * 7919)).theta;
        }
        thetas.push(sum / runs);
    }

    for (let i = 1; i < thetas.length; i += 1) {
        assert.ok(
            thetas[i] > thetas[i - 1],
            `estimates not increasing: ${thetas.map((t) => t.toFixed(2)).join(' < ')}`
        );
    }
});

test('estimates recover known ability within a sane tolerance', () => {
    const items = makeBank(40);

    for (const trueTheta of [-1.5, -0.5, 0.5, 1.5]) {
        let sum = 0;
        const runs = 20;
        for (let seed = 1; seed <= runs; seed += 1) {
            sum += estimateAbility(simulate(trueTheta, items, seed * 104729)).theta;
        }
        const mean = sum / runs;
        close(mean, trueTheta, 0.75, `recovery at θ=${trueTheta}`);
    }
});

test('standard error shrinks as responses accumulate', () => {
    const items = makeBank(30);
    const responses = simulate(0.5, items, 4242);

    let previousSe = Infinity;
    for (let n = 1; n <= responses.length; n += 1) {
        const se = estimateAbility(responses.slice(0, n)).standardError;
        assert.ok(se <= previousSe + 1e-9, `SE grew at n=${n}: ${previousSe} → ${se}`);
        previousSe = se;
    }
    assert.ok(previousSe < 0.5, `SE after 30 items should be < 0.5, got ${previousSe}`);
});

test('reported SE equals 1/sqrt(information)', () => {
    const items = makeBank(20);
    const responses = simulate(0.2, items, 99);
    const result = estimateAbility(responses);
    close(result.standardError, 1 / Math.sqrt(result.information), 1e-9, 'SE');
});

test('reliability is 1 - SE² and stays within [0, 1]', () => {
    const items = makeBank(20);
    const result = estimateAbility(simulate(0, items, 7));
    close(result.reliability, 1 - result.standardError ** 2, 1e-12, 'reliability');
    assert.ok(result.reliability >= 0 && result.reliability <= 1, 'reliability out of range');
});

test('estimation is deterministic for the same input', () => {
    const items = makeBank(15);
    const responses = simulate(0.8, items, 31337);
    const first = estimateAbility(responses);
    const second = estimateAbility(responses);
    assert.equal(first.theta, second.theta, 'theta differed between identical runs');
});

test('ability stays inside the declared bounds for extreme patterns', () => {
    const bank: ItemParams[] = Array.from({ length: 40 }, () => ({ a: 3, b: 0, c: 0.01 }));
    for (const correct of [true, false]) {
        const responses: ScoredResponse[] = bank.map((item) => ({ item, correct }));
        const result = estimateAbility(responses);
        assert.ok(
            result.theta >= ABILITY_MIN && result.theta <= ABILITY_MAX,
            `theta ${result.theta} outside bounds`
        );
    }
});

test('a weak prior moves the estimate toward the prior mean', () => {
    const items = makeBank(6);
    const responses = simulate(2, items, 5150);
    const weak = estimateAbility(responses, { priorSd: 10 });
    const strong = estimateAbility(responses, { priorSd: 0.3 });
    assert.ok(strong.theta <= weak.theta, 'a stronger prior should shrink a high estimate downward');
});

test('isPreciseEnough respects the target SE', () => {
    assert.equal(isPreciseEnough(0.3, 0.35), true);
    assert.equal(isPreciseEnough(0.4, 0.35), false);
});

test('estimatedRemainingItems is 0 once the target is met', () => {
    assert.equal(estimatedRemainingItems(0.2, 1, 0.35), 0);
    assert.ok(estimatedRemainingItems(1, 1, 0.35) > 0, 'should ask for more items');
});

// ============================================
// 4. Derived scales and normal helpers
// ============================================

console.log('\n[4] Derived scales and normal helpers');

test('scale score is centred at 50 with SD 10', () => {
    close(thetaToScaleScore(0), 50, 1e-12, 'scale(0)');
    close(thetaToScaleScore(1), 60, 1e-12, 'scale(1)');
    close(thetaToScaleScore(-1), 40, 1e-12, 'scale(-1)');
});

test('scale score is clamped to [0, 100]', () => {
    assert.equal(thetaToScaleScore(20), 100);
    assert.equal(thetaToScaleScore(-20), 0);
});

test('scaleScoreToTheta inverts thetaToScaleScore', () => {
    for (const theta of [-2, -0.9, 0, 0.4, 1.7]) {
        close(scaleScoreToTheta(thetaToScaleScore(theta)), theta, 0.05, `roundtrip θ=${theta}`);
    }
});

test('confidence interval is symmetric about theta and clamped', () => {
    const { low, high } = confidenceInterval(0, 0.5);
    close((low + high) / 2, 0, 1e-9, 'centre');
    assert.ok(low < 0 && high > 0, 'interval should straddle the estimate');

    const wide = confidenceInterval(3.9, 2);
    assert.ok(wide.high <= ABILITY_MAX, 'high end must clamp to ABILITY_MAX');
});

test('normalCdf matches known values', () => {
    close(normalCdf(0), 0.5, 1e-9, 'Φ(0)');
    close(normalCdf(1.96), 0.975, 1e-4, 'Φ(1.96)');
    close(normalCdf(-1.96), 0.025, 1e-4, 'Φ(-1.96)');
});

test('inverseNormalCdf matches known quantiles', () => {
    close(inverseNormalCdf(0.5), 0, 1e-9, 'z(0.5)');
    close(inverseNormalCdf(0.975), 1.959964, 1e-4, 'z(0.975)');
    close(inverseNormalCdf(0.025), -1.959964, 1e-4, 'z(0.025)');
});

test('inverseNormalCdf inverts normalCdf across the range', () => {
    for (let x = -3; x <= 3; x += 0.37) {
        close(inverseNormalCdf(normalCdf(x)), x, 1e-12, `roundtrip x=${x}`);
    }
});

test('inverseNormalCdf saturates at the boundaries instead of returning NaN', () => {
    assert.equal(inverseNormalCdf(0), -Infinity);
    assert.equal(inverseNormalCdf(1), Infinity);
});

test('reliabilityFromSE is clamped to [0, 1]', () => {
    close(reliabilityFromSE(0.5), 0.75, 1e-12, 'ρ(0.5)');
    assert.equal(reliabilityFromSE(2), 0);
    assert.equal(reliabilityFromSE(0), 1);
});

// ============================================
// 5. Item identity
// ============================================

console.log('\n[5] Item identity');

test('normalisation ignores case, whitespace and numbering', () => {
    const a = itemKeyFor('  1. Explain how a hash map handles collisions?  ');
    const b = itemKeyFor('Explain how a HASH MAP handles collisions');
    assert.equal(a, b, 'same item should share a key');
    assert.notEqual(a, '', 'key must not be empty');
});

test('normalisation ignores markdown decoration', () => {
    const plain = itemKeyFor('Describe the CAP theorem');
    const decorated = itemKeyFor('**Describe** the `CAP` theorem');
    assert.equal(plain, decorated, 'emphasis markers should not change identity');
});

test('normalisation separates items that differ in substance', () => {
    const cases: Array<[string, string]> = [
        ['Explain O(n log n) sorting', 'Explain O(n^2) sorting'],
        ['What is a primary key?', 'What is a foreign key?'],
        ['Describe REST', 'Describe GraphQL'],
    ];
    for (const [first, second] of cases) {
        assert.notEqual(itemKeyFor(first), itemKeyFor(second), `merged distinct items: ${first} | ${second}`);
    }
});

test('numbering and bullets normalise but content differences survive', () => {
    assert.equal(itemKeyFor('1) What is idempotency?'), itemKeyFor('What is idempotency'));
    assert.equal(itemKeyFor('- What is idempotency'), itemKeyFor('What is idempotency'));
    assert.notEqual(itemKeyFor('2) What is idempotency?'), itemKeyFor('What is idempotency? and why'));
});

test('unidentifiable text yields an empty key rather than a shared bucket', () => {
    assert.equal(itemKeyFor(''), '');
    assert.equal(itemKeyFor('   '), '');
    assert.equal(itemKeyFor('?!...'), '');
    assert.equal(itemKeyFor('1.'), '');
});

test('isSameItem agrees with key comparison', () => {
    assert.equal(isSameItem('What is a deadlock?', 'what is a deadlock'), true);
    assert.equal(isSameItem('What is a deadlock?', 'What is a livelock?'), false);
    assert.equal(isSameItem('', ''), false, 'empty text is never the same item');
});

test('itemLabel truncates on a word boundary', () => {
    const label = itemLabel('Explain the difference between optimistic and pessimistic locking', 30);
    assert.ok(label.length <= 31, `label too long: ${label.length}`);
    assert.ok(label.endsWith('…'), 'truncated labels should be marked');
    assert.equal(itemLabel('Short question', 80), 'Short question');
});

// ============================================
// 6. Calibration
// ============================================

console.log('\n[6] Calibration');

/** Builds samples from a target proportion correct and a strength of separation. */
function makeSamples(n: number, proportionCorrect: number, separation: number): CalibrationSample[] {
    const samples: CalibrationSample[] = [];
    const correctCount = Math.round(n * proportionCorrect);
    for (let i = 0; i < n; i += 1) {
        const correct = i < correctCount;
        // A discriminating item: those who pass also scored better elsewhere.
        samples.push({ correct, restScore: correct ? 200 + separation : 100 });
    }
    return samples;
}

test('point-biserial is positive when strong candidates pass the item', () => {
    const pb = pointBiserial(makeSamples(40, 0.5, 50));
    assert.ok(pb > 0.3, `expected a clear positive correlation, got ${pb}`);
});

test('point-biserial is near zero for a non-discriminating item', () => {
    const samples: CalibrationSample[] = [];
    for (let i = 0; i < 40; i += 1) {
        // Alternating pass/fail across identical rest scores: no separation at all.
        samples.push({ correct: i % 2 === 0, restScore: 150 });
    }
    const pb = pointBiserial(samples);
    assert.equal(pb, 0, `flat item should correlate zero, got ${pb}`);
});

test('point-biserial returns 0 rather than NaN for degenerate groups', () => {
    const allPass = Array.from({ length: 20 }, () => ({ correct: true, restScore: 100 }));
    const allFail = Array.from({ length: 20 }, () => ({ correct: false, restScore: 100 }));
    assert.equal(pointBiserial(allPass), 0);
    assert.equal(pointBiserial(allFail), 0);
    assert.equal(pointBiserial([]), 0);
});

test('a hard item calibrates to a positive difficulty', () => {
    const result = estimateItemParametersFromSamples(makeSamples(60, 0.25, 40));
    assert.ok(result, 'should calibrate at n=60');
    assert.ok(result!.b > 0, `hard item should have b > 0, got ${result!.b}`);
});

test('an easy item calibrates to a negative difficulty', () => {
    const result = estimateItemParametersFromSamples(makeSamples(60, 0.85, 40));
    assert.ok(result, 'should calibrate at n=60');
    assert.ok(result!.b < 0, `easy item should have b < 0, got ${result!.b}`);
});

test('a 50% item calibrates to roughly zero difficulty', () => {
    const result = estimateItemParametersFromSamples(makeSamples(80, 0.5, 40));
    assert.ok(result, 'should calibrate at n=80');
    close(result!.b, 0, 0.45, 'mid-difficulty item');
});

test('difficulty ordering survives calibration across a spread of items', () => {
    const difficulties = [0.2, 0.35, 0.5, 0.65, 0.8].map(
        (proportion) => estimateItemParametersFromSamples(makeSamples(80, proportion, 40))!.b
    );

    for (let i = 1; i < difficulties.length; i += 1) {
        assert.ok(
            difficulties[i] < difficulties[i - 1],
            `easier items must calibrate lower: ${difficulties.map((d) => d.toFixed(2)).join(' > ')}`
        );
    }
});

test('calibration refuses to fit below the minimum sample size', () => {
    assert.equal(estimateItemParametersFromSamples(makeSamples(5, 0.5, 40)), null);
    assert.equal(estimateItemParametersFromSamples([]), null);
});

test('discrimination is clamped into the declared range', () => {
    const perfect = estimateItemParametersFromSamples(makeSamples(60, 0.5, 500))!;
    assert.ok(perfect.a <= MAX_DISCRIMINATION, `a ${perfect.a} above max`);
    assert.ok(perfect.a >= MIN_DISCRIMINATION, `a ${perfect.a} below min`);
});

test('guessing is clamped and estimated from the weakest respondents', () => {
    const samples: CalibrationSample[] = [];
    for (let i = 0; i < 40; i += 1) {
        // The bottom quartile passes roughly half the time ⇒ a high guessing floor.
        samples.push({ correct: i < 20, restScore: i < 10 ? 50 : 200 });
    }
    const guessing = estimateGuessing(samples);
    assert.ok(guessing >= MIN_GUESSING && guessing <= MAX_GUESSING, `c ${guessing} out of range`);
});

test('retirement flags a non-discriminating item once evidence is sufficient', () => {
    const flat: CalibrationSample[] = [];
    for (let i = 0; i < 60; i += 1) flat.push({ correct: i % 2 === 0, restScore: 150 });

    const verdict = shouldRetire({ sampleSize: 60, discrimination: 0.02, proportionCorrect: 0.5 });
    assert.equal(verdict.isRetired, true, 'a flat item should be retired');
    assert.ok(verdict.retiredReason?.includes('discrimination'), 'reason should cite discrimination');

    const result = estimateItemParametersFromSamples(flat)!;
    assert.equal(result.isRetired, true, 'end-to-end: a flat item retires');
});

test('retirement flags ceiling and floor items', () => {
    assert.equal(
        shouldRetire({ sampleSize: 60, discrimination: 0.6, proportionCorrect: 0.99 }).isRetired,
        true
    );
    assert.equal(
        shouldRetire({ sampleSize: 60, discrimination: 0.6, proportionCorrect: 0.01 }).isRetired,
        true
    );
});

test('retirement does NOT fire on thin evidence', () => {
    // Same damning statistics, but only 10 responses — must not retire.
    const verdict = shouldRetire({ sampleSize: 10, discrimination: 0.0, proportionCorrect: 0.5 });
    assert.equal(verdict.isRetired, false, 'should not retire without enough evidence');
});

test('a healthy discriminating item is not retired', () => {
    const verdict = shouldRetire({ sampleSize: 100, discrimination: 0.55, proportionCorrect: 0.55 });
    assert.equal(verdict.isRetired, false);
    assert.equal(verdict.retiredReason, null);
});

test('difficulty defaults come from the legacy difficulty label', () => {
    assert.ok(itemParamsForDifficulty('easy').b < itemParamsForDifficulty('hard').b, 'easy < hard');
    assert.equal(itemParamsForDifficulty('medium').b, 0);
    assert.equal(itemParamsForDifficulty(null).b, 0, 'unknown difficulty falls back to the middle');
});

test('correctness is judged on the category-appropriate dimension', () => {
    const scores = {
        technicalScore: 30,
        communicationScore: 90,
        confidenceScore: 50,
        logicScore: 50,
        depthScore: 50,
    };
    assert.equal(deriveCorrectness(scores, 'technical'), false, 'technical uses technicalScore');
    assert.equal(deriveCorrectness(scores, 'behavioral'), true, 'behavioral uses communicationScore');
    assert.equal(deriveCorrectness(scores, 'unknown-category'), false, 'unknown falls back to technical');

    // The threshold is a parameter, not a buried constant.
    assert.equal(deriveCorrectness(scores, 'technical', 20), true, 'lowering the threshold flips it');
});

// ============================================
// 7. Competency graph propagation
// ============================================

console.log('\n[7] Competency graph');

test('a node with no prerequisites is unchanged', () => {
    const [result] = propagateMastery([{ competencyId: 'a', theta: 1.5, standardError: 0.3 }], []);
    close(result.effectiveTheta, 1.5, 1e-12, 'effective theta');
    close(result.discount, 0, 1e-12, 'discount');
});

test('claiming more than the prerequisites support is discounted', () => {
    const [weak, strong] = propagateMastery(
        [
            { competencyId: 'containers', theta: -1, standardError: 0.3 },
            { competencyId: 'kubernetes', theta: 2, standardError: 0.3 },
        ],
        [{ fromId: 'containers', toId: 'kubernetes', relation: 'prerequisite', weight: 1 }]
    );

    close(weak.effectiveTheta, -1, 1e-12, 'prerequisite untouched');
    assert.ok(strong.discount > 0, 'the dependent node must be discounted');
    assert.ok(strong.effectiveTheta < 2, 'discount must reduce the estimate');
    // damping 0.5 ⇒ half the 3.0 gap is discounted.
    close(strong.effectiveTheta, 2 - 1.5, 1e-9, 'damped estimate');
    assert.equal(strong.limitingCompetencies[0].competencyId, 'containers');
});

test('meeting the prerequisites costs nothing', () => {
    const [, strong] = propagateMastery(
        [
            { competencyId: 'containers', theta: 2, standardError: 0.3 },
            { competencyId: 'kubernetes', theta: 1, standardError: 0.3 },
        ],
        [{ fromId: 'containers', toId: 'kubernetes', relation: 'prerequisite', weight: 1 }]
    );
    close(strong.discount, 0, 1e-12, 'no discount when prerequisites are met');
});

test('a relation that is not a prerequisite never discounts', () => {
    const [, node] = propagateMastery(
        [
            { competencyId: 'python', theta: -2, standardError: 0.3 },
            { competencyId: 'sql', theta: 2, standardError: 0.3 },
        ],
        [{ fromId: 'python', toId: 'sql', relation: 'related', weight: 1 }]
    );
    close(node.discount, 0, 1e-12, "'related' must not discount");
});

test('unknown prerequisites are ignored rather than treated as weaknesses', () => {
    const [node] = propagateMastery(
        [{ competencyId: 'kubernetes', theta: 2, standardError: 0.3 }],
        [{ fromId: 'not-measured', toId: 'kubernetes', relation: 'prerequisite', weight: 1 }]
    );
    close(node.discount, 0, 1e-12, 'missing prerequisite data must not penalise the candidate');
});

test('a prerequisite cycle terminates and stays finite', () => {
    const results = propagateMastery(
        [
            { competencyId: 'a', theta: 1, standardError: 0.3 },
            { competencyId: 'b', theta: 0, standardError: 0.3 },
        ],
        [
            { fromId: 'a', toId: 'b', relation: 'prerequisite', weight: 1 },
            { fromId: 'b', toId: 'a', relation: 'prerequisite', weight: 1 },
        ]
    );

    assert.equal(results.length, 2);
    for (const result of results) {
        assert.ok(Number.isFinite(result.effectiveTheta), 'must not diverge on a cycle');
    }
});

test('discounting increases the reported uncertainty', () => {
    const [, node] = propagateMastery(
        [
            { competencyId: 'containers', theta: -1, standardError: 0.5 },
            { competencyId: 'kubernetes', theta: 2, standardError: 0.2 },
        ],
        [{ fromId: 'containers', toId: 'kubernetes', relation: 'prerequisite', weight: 1 }]
    );
    assert.ok(
        node.standardErrorAfterPropagation > node.standardError,
        'a discounted estimate must not look more certain'
    );
});

test('improvement targets rank the trustworthy gaps first', () => {
    const propagated = propagateMastery(
        [
            { competencyId: 'strong', theta: 2, standardError: 0.2 },
            { competencyId: 'weak-clear', theta: -1, standardError: 0.2 },
            { competencyId: 'weak-noisy', theta: -2, standardError: 3 },
        ],
        []
    );

    const ranked = rankImprovementTargets(propagated);
    assert.equal(ranked[0].competencyId, 'weak-clear', 'the precise gap should rank first');
    assert.equal(ranked[0].trustworthy, true);
    assert.equal(ranked[1].trustworthy, false, 'a noisy estimate must not outrank a precise one');
    assert.ok(!ranked.some((entry) => entry.competencyId === 'strong'), 'no gap ⇒ not a target');
});

test('improvement targets handle an empty profile', () => {
    assert.deepEqual(rankImprovementTargets([]), []);
});

// ============================================
// 8. Adaptive selection and stop rule
// ============================================

console.log('\n[8] Adaptive selection');

test('the most informative item is the one nearest current ability', () => {
    const items = [
        { itemKey: 'item-0', params: { a: 1.2, b: -2, c: 0.1 } },
        { itemKey: 'item-1', params: { a: 1.2, b: 0.2, c: 0.1 } },
        { itemKey: 'item-2', params: { a: 1.2, b: 2, c: 0.1 } },
    ];

    const ranked = rankItemsByInformation(0.2, items);
    assert.equal(ranked[0].itemKey, 'item-1', 'the on-level item should rank first');
    assert.ok(ranked[0].information > ranked[2].information, 'far items are less informative');

    // The whole point of adaptivity: move the ability estimate and a different
    // item becomes the most informative one.
    const rankedForStrong = rankItemsByInformation(1.9, items);
    assert.equal(rankedForStrong[0].itemKey, 'item-2', 'a strong candidate should get the hard item');
});

test('ranking excludes nothing on its own but is deterministic', () => {
    const items = [
        { itemKey: 'b', params: { a: 1, b: 0, c: 0.2 } },
        { itemKey: 'a', params: { a: 1, b: 0, c: 0.2 } },
    ];
    const first = rankItemsByInformation(0, items).map((entry) => entry.itemKey);
    const second = rankItemsByInformation(0, items).map((entry) => entry.itemKey);
    assert.deepEqual(first, second, 'ties must break deterministically');
    assert.deepEqual(first, ['a', 'b'], 'ties break by key');
});

test('ranking an empty bank yields an empty ranking', () => {
    assert.deepEqual(rankItemsByInformation(0, []), []);
});

test('randomesque selection picks within the top-K, never outside it', () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => ({
        itemKey: `k${index}`,
        params: { a: 1, b: index * 0.1, c: 0.2 },
    }));
    const ranked = rankItemsByInformation(0, items);
    const topFive = new Set(ranked.slice(0, 5).map((entry) => entry.itemKey));

    for (let draw = 0; draw < 50; draw += 1) {
        const picked = randomesquePick(ranked, 5, mulberry32(draw + 1));
        assert.ok(picked, 'should always pick from a non-empty ranking');
        assert.ok(topFive.has(picked!.itemKey), `picked ${picked!.itemKey} outside the top 5`);
    }
});

test('randomesque selection reaches more than just the single best item', () => {
    const items = [0, 1, 2, 3, 4].map((index) => ({
        itemKey: `k${index}`,
        params: { a: 1, b: index * 0.05, c: 0.2 },
    }));
    const ranked = rankItemsByInformation(0, items);

    const seen = new Set<string>();
    for (let draw = 0; draw < 60; draw += 1) {
        seen.add(randomesquePick(ranked, 5, mulberry32(draw * 13 + 1))!.itemKey);
    }
    assert.ok(seen.size > 1, 'exposure control should vary the choice');
});

test('randomesque selection on an empty ranking returns null', () => {
    assert.equal(randomesquePick([]), null);
});

test('target difficulty equals the ability estimate', () => {
    // The design point: difficulty stops being a label and becomes the measured level.
    close(targetDifficultyFor(1.8), 1.8, 1e-12, 'target difficulty');
    close(targetDifficultyFor(-2.2), -2.2, 1e-12, 'target difficulty');
});

test('the stop rule respects minimum items before precision can end a session', () => {
    const decision = stopDecision({ standardError: 0.1, itemsAnswered: 2, itemsAvailable: 50 });
    assert.equal(decision.shouldStop, false, 'a lucky early pattern must not end the session');
    assert.equal(decision.reason, 'minimum-items-not-met');
});

test('the stop rule ends a session once precision is reached', () => {
    const decision = stopDecision({ standardError: 0.2, itemsAnswered: 12, itemsAvailable: 50 });
    assert.equal(decision.shouldStop, true);
    assert.equal(decision.reason, 'target-precision-reached');
});

test('the stop rule continues while precision is short and items remain', () => {
    const decision = stopDecision({ standardError: 0.8, itemsAnswered: 10, itemsAvailable: 50 });
    assert.equal(decision.shouldStop, false);
});

test('the stop rule halts at the maximum item count', () => {
    const decision = stopDecision({ standardError: 2.0, itemsAnswered: 25, itemsAvailable: 50 });
    assert.equal(decision.shouldStop, true);
    assert.equal(decision.reason, 'maximum-items-reached');
});

test('the stop rule halts when no items remain', () => {
    const decision = stopDecision({ standardError: 0.9, itemsAnswered: 10, itemsAvailable: 0 });
    assert.equal(decision.shouldStop, true);
    assert.equal(decision.reason, 'no-items-available');
});

test('the stop rule explains itself in every branch', () => {
    const cases = [
        { standardError: 0.1, itemsAnswered: 2, itemsAvailable: 50 },
        { standardError: 0.2, itemsAnswered: 12, itemsAvailable: 50 },
        { standardError: 0.8, itemsAnswered: 10, itemsAvailable: 50 },
        { standardError: 0.9, itemsAnswered: 10, itemsAvailable: 0 },
    ];
    for (const input of cases) {
        const decision = stopDecision(input);
        assert.ok(decision.explanation.length > 10, 'every decision should be explainable');
    }
});

test('legacy difficulty labels map continuously from the target', () => {
    assert.equal(difficultyLabelFor(-2), 'easy');
    assert.equal(difficultyLabelFor(0), 'medium');
    assert.equal(difficultyLabelFor(2), 'hard');
    // The boundary is continuous, not a three-way bucket.
    assert.equal(difficultyLabelFor(-0.49), 'medium');
});

// ============================================
// Summary
// ============================================

console.log(`\n${'-'.repeat(52)}`);
if (failures.length === 0) {
    console.log(`measurement core: ${passed} checks passed`);
    process.exit(0);
} else {
    console.log(`measurement core: ${passed} passed, ${failures.length} FAILED`);
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
}
