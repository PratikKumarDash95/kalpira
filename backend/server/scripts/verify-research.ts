// ============================================
// verify-research.ts — correctness checks for the research core
//
// Feature 5 makes claims about people out of text they wrote: that two passages mean
// the same thing, that a theme is rising, that a candidate sits at the 75th
// percentile of their peers. Every one of those is a claim a reader could act on, and
// every one of them is verified here rather than assumed.
//
//   npm run verify:research        (from backend/)
//
// Exits non-zero on any failure. No database, no network, no browser.
//
// THE CHECKS THAT MATTER MOST ARE ABOUT REFUSING
//
// Sections 3 through 6 each contain a check that a quantity is *withheld*: a theme
// that cannot be joined to a cluster, a change with no baseline, a percentile from
// too small a pool, a growth line whose movement is smaller than its own measurement
// error. In every case a plausible number could have been produced and must not be.
//
// Section 7 asserts the property underneath all of them: that no path in this feature
// returns a value for a quantity it could not compute, and that no refusal is
// returned as a zero. Section 8 asserts the other half of the same rule — that a real
// zero survives as a zero, so the doctrine does not decay into "withhold everything".
//
// `v()` and `why()` are how a check reads a `Measured`. Both throw when the result is
// not the kind the check expected, so a measurement that starts refusing after a
// change fails the check that covered it rather than silently reading as undefined.
// ============================================

import assert from 'node:assert/strict';
import type { Measured } from '../app/lib/measured';
import {
    ABILITY_FLAT_BAND,
    CLUSTER_SIMILARITY_THRESHOLD,
    EMBEDDING_DIM,
    EMBEDDING_MODEL,
    MIN_BENCHMARK_COHORT,
    MIN_SIMILARITY,
    RESEARCH_REGISTRY_VERSION,
    STAGNATION_SLOPE_BAND,
} from '../app/lib/research/contract';
import {
    chunkText,
    chunkTranscript,
    contentHash,
    isBlank,
    normaliseText,
} from '../app/lib/research/chunking';
import {
    centroid,
    cosineSimilarity,
    countUnusable,
    dot,
    isUsableVector,
    magnitude,
    normalise,
    rankBySimilarity,
} from '../app/lib/research/vectorMath';
import {
    assignToNearest,
    kmeans,
    representativeLabel,
    suggestK,
} from '../app/lib/research/clusterMath';
import {
    absoluteChange,
    buildSeries,
    detectRegression,
    detectStagnation,
    direction,
    periodKey,
    periodRange,
    percentChange,
    slope,
    summarise,
    toCounts,
} from '../app/lib/research/trendMath';
import {
    bandFor,
    percentile,
    percentileRank,
    summariseCohort,
} from '../app/lib/research/benchmarkMath';
import {
    alertsFor,
    trajectory,
    type AbilityPoint,
} from '../app/lib/research/growthMath';

// --------------------------------------------
// Harness
// --------------------------------------------

let passed = 0;
let failed = 0;
const failures: string[] = [];

function section(title: string): void {
    console.log(`\n${title}`);
}

function check(name: string, fn: () => void): void {
    try {
        fn();
        passed += 1;
        console.log(`  ok   ${name}`);
    } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${name}\n       ${message}`);
        console.log(`  FAIL ${name}`);
        console.log(`       ${message}`);
    }
}

/** The value of a measurement, or a failed check naming the refusal. */
function v<T>(measured: Measured<T>): T {
    if (measured.state !== 'computed') {
        throw new Error(`expected a computed value, got a refusal: ${measured.reason}`);
    }
    return measured.value;
}

/** The reason a measurement was refused, or a failed check naming the value. */
function why(measured: Measured<unknown>): string {
    if (measured.state !== 'refused') {
        throw new Error(`expected a refusal, got a computed value`);
    }
    return measured.reason;
}

/** True when the result carries no `value` property at all. */
function hasNoValue(result: unknown): boolean {
    return !Object.prototype.hasOwnProperty.call(result, 'value');
}

/** A short vector, padded out to the full embedding dimension. */
function vec(...values: number[]): number[] {
    return values;
}

/**
 * Pads a short vector to the full dimension and puts a constant on the last
 * component, so the magnitude is never zero even when `head` is.
 */
function padded(head: number[], dim = EMBEDDING_DIM): number[] {
    const out = new Array<number>(dim).fill(0);
    for (let index = 0; index < head.length && index < dim; index += 1) out[index] = head[index];
    out[dim - 1] = 1;
    return out;
}

console.log('='.repeat(52));
console.log(`research core — registry ${RESEARCH_REGISTRY_VERSION}`);
console.log(`embedding ${EMBEDDING_MODEL} @ ${EMBEDDING_DIM} dims`);
console.log('='.repeat(52));

// --------------------------------------------
// 1. Text becomes units, and units have stable identities
// --------------------------------------------

section('1. Chunking and content identity');


// The invisible characters below are built from escapes rather than typed, so this
// file contains none of them and an edit cannot silently drop one.
const ZWSP = String.fromCharCode(0x200b);
const NBSP = String.fromCharCode(0x00a0);
// The same word spelled two ways: precomposed, and letter-plus-combining-accent.
const NFC = 'caf' + String.fromCharCode(0x00e9);
const NFD = 'cafe' + String.fromCharCode(0x0301);

check('normalisation folds case, whitespace runs and Unicode form', () => {
    assert.equal(normaliseText('  Pricing   Objections  '), 'pricing objections');
    assert.equal(normaliseText(NFC), normaliseText(NFD));
    assert.equal(normaliseText('a' + NBSP + 'b'), 'a b');
});

check('a zero-width character separates words, it does not weld them', () => {
    assert.equal(normaliseText('pricing' + ZWSP + 'objections'), 'pricing objections');
    assert.equal(normaliseText('pricing ' + ZWSP + ' objections'), 'pricing objections');
});

check('the same words hash the same however they were typed', () => {
    assert.equal(contentHash('Pricing  objections'), contentHash('pricing objections'));
    assert.equal(contentHash('a\n\nb'), contentHash('a b'));
    assert.equal(contentHash('a' + ZWSP + 'b'), contentHash('a b'));
    assert.equal(contentHash('a ' + ZWSP + ' b'), contentHash('a b'));
});

check('different words hash differently', () => {
    assert.notEqual(contentHash('pricing objections'), contentHash('pricing concerns'));
});

check('blank text is recognised, and hashes to a stable value', () => {
    assert.equal(isBlank('   \n  '), true);
    assert.equal(isBlank(' x '), false);
    assert.equal(contentHash('   '), contentHash('\n'));
});

check('an empty string yields no chunks, not one empty chunk', () => {
    assert.deepEqual(chunkText(''), []);
    assert.deepEqual(chunkText('   '), []);
});

check('text within the limit is one chunk, unchanged', () => {
    assert.deepEqual(chunkText('a short answer', 100), ['a short answer']);
});

check('an overlong paragraph splits at sentence ends, keeping whole sentences', () => {
    const chunks = chunkText('aaa bbb ccc. ddd eee fff. ggg hhh iii.', 20);
    assert.equal(chunks.length, 3);
    assert.deepEqual(chunks, ['aaa bbb ccc.', 'ddd eee fff.', 'ggg hhh iii.']);
});

check('text with no sentence boundary is cut rather than truncated', () => {
    const chunks = chunkText('x'.repeat(45), 20);
    assert.equal(chunks.length, 3);
    assert.equal(chunks.join('').length, 45);
});

check('no chunk exceeds the limit', () => {
    const text = Array.from({ length: 30 }, (_, index) => `sentence number ${index} here.`).join(' ');
    for (const chunk of chunkText(text, 60)) {
        assert.ok(chunk.length <= 60, `chunk of ${chunk.length} exceeds 60`);
    }
});

check('chunking is deterministic across runs', () => {
    const text = 'One paragraph here.\n\nAnother paragraph, rather longer than the first one.\n\nThird.';
    assert.deepEqual(chunkText(text, 40), chunkText(text, 40));
});

check('a transcript chunk carries its role and its position', () => {
    const chunks = chunkTranscript([
        { role: 'user', content: 'I led the migration.' },
        { role: 'assistant', content: '   ' },
        { role: 'user', content: 'It took six weeks.' },
    ]);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].role, 'user');
    assert.equal(chunks[0].index, 0);
    assert.equal(chunks[1].index, 1);
    assert.equal(chunks[1].text, 'It took six weeks.');
});

check('a message with a non-string body is skipped, not embedded as "undefined"', () => {
    const chunks = chunkTranscript([
        { role: 'user', content: undefined },
        { role: 'user', content: 'real' },
        { content: 'no role' },
    ]);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[1].role, 'unknown');
});

// --------------------------------------------
// 2. Vectors
// --------------------------------------------

section('2. Cosine similarity and ranking');

check('dot and magnitude are the arithmetic they claim', () => {
    assert.equal(dot(vec(1, 2, 3), vec(4, 5, 6)), 32);
    assert.equal(magnitude(vec(3, 4)), 5);
});

check('identical vectors are fully similar, orthogonal ones are not', () => {
    assert.equal(v(cosineSimilarity(vec(1, 0), vec(1, 0))), 1);
    assert.equal(v(cosineSimilarity(vec(1, 0), vec(0, 1))), 0);
    assert.equal(v(cosineSimilarity(vec(1, 0), vec(-1, 0))), -1);
});

check('cosine ignores magnitude, so a long and a short answer can match', () => {
    assert.equal(v(cosineSimilarity(vec(3, 4), vec(30, 40))), 1);
});

check('a known similarity matches its hand-computed value', () => {
    // 32 / sqrt(1078) = 32 / (7 * sqrt(22))
    assert.ok(Math.abs(v(cosineSimilarity(vec(1, 2, 3), vec(4, 5, 6))) - 0.974631846) < 1e-7);
});

check('vectors of different lengths are refused, not compared', () => {
    assert.match(why(cosineSimilarity(vec(1, 2), vec(1, 2, 3))), /2 and 3 dimensions/);
});

check('an empty vector is refused', () => {
    assert.equal(cosineSimilarity([], vec(1)).state, 'refused');
});

check('a zero vector is refused, because its angle is undefined', () => {
    assert.match(why(cosineSimilarity(vec(0, 0), vec(1, 1))), /zero magnitude/);
});

check('a non-finite component is refused rather than propagated as NaN', () => {
    assert.equal(cosineSimilarity(vec(1, NaN), vec(1, 1)).state, 'refused');
    assert.equal(cosineSimilarity(vec(1, Infinity), vec(1, 1)).state, 'refused');
});

check('normalise returns a unit vector, and refuses the one with no direction', () => {
    assert.ok(Math.abs(magnitude(v(normalise(vec(3, 4)))) - 1) < 1e-12);
    assert.equal(normalise(vec(0, 0)).state, 'refused');
});

check('a centroid is a unit vector, so it lives where its members do', () => {
    const result = v(centroid([vec(1, 0), vec(0, 1)]));
    assert.ok(Math.abs(magnitude(result) - 1) < 1e-12);
    assert.ok(Math.abs(result[0] - Math.SQRT1_2) < 1e-12);
});

check('the centroid of nothing is refused, not the origin', () => {
    assert.match(why(centroid([])), /no usable vectors/);
});

check('a centroid over mismatched dimensions is refused', () => {
    assert.equal(centroid([vec(1, 2), vec(1, 2, 3)]).state, 'refused');
});

check('ranking orders by similarity, nearest first', () => {
    const ranked = rankBySimilarity(vec(1, 0), [
        { id: 'far', vector: vec(0, 1) },
        { id: 'near', vector: vec(1, 0) },
        { id: 'mid', vector: vec(1, 1) },
    ]);
    assert.deepEqual(ranked.map((item) => item.id), ['near', 'mid', 'far']);
});

check('a tie is broken by id, so the same query gives the same order', () => {
    const one = rankBySimilarity(vec(1, 0), [
        { id: 'b', vector: vec(1, 0) },
        { id: 'a', vector: vec(1, 0) },
        { id: 'c', vector: vec(1, 0) },
    ]);
    assert.deepEqual(one.map((item) => item.id), ['a', 'b', 'c']);
    const two = rankBySimilarity(vec(1, 0), [
        { id: 'c', vector: vec(1, 0) },
        { id: 'a', vector: vec(1, 0) },
        { id: 'b', vector: vec(1, 0) },
    ]);
    assert.deepEqual(two.map((item) => item.id), ['a', 'b', 'c']);
});

check('a match floor drops weak results rather than padding the list', () => {
    const ranked = rankBySimilarity(
        vec(1, 0),
        [
            { id: 'good', vector: vec(1, 0) },
            { id: 'unrelated', vector: vec(0, 1) },
        ],
        { minSimilarity: MIN_SIMILARITY },
    );
    assert.deepEqual(ranked.map((item) => item.id), ['good']);
});

check('the limit is honoured', () => {
    const ranked = rankBySimilarity(
        vec(1, 0),
        Array.from({ length: 20 }, (_, index) => ({ id: `i${index}`, vector: vec(1, index / 100) })),
        { limit: 3 },
    );
    assert.equal(ranked.length, 3);
});

check('an unusable candidate is dropped, never scored as zero', () => {
    const ranked = rankBySimilarity(vec(1, 0), [
        { id: 'zero', vector: vec(0, 0) },
        { id: 'short', vector: vec(1) },
        { id: 'real', vector: vec(1, 0) },
    ]);
    assert.deepEqual(ranked.map((item) => item.id), ['real']);
    assert.equal(countUnusable([{ vector: vec(0, 0) }, { vector: vec(1, 0) }]), 1);
});

check('usable vectors are recognised, and a zero vector is not usable', () => {
    assert.equal(isUsableVector(vec(1, 0)), true);
    assert.equal(isUsableVector(vec(0, 0)), false);
    assert.equal(isUsableVector(vec(1, 0), 3), false);
    assert.equal(isUsableVector(vec(1, 0, 0), 3), true);
});

// --------------------------------------------
// 3. Themes acquire an identity — or refuse to
// --------------------------------------------

section('3. Clustering themes');

const themeA = padded([1, 0, 0], 8);
const themeA2 = padded([0.98, 0.02, 0], 8);
const themeB = padded([0, 1, 0], 8);
const themeB2 = padded([0.01, 0.99, 0], 8);

check('two obvious groups are separated', () => {
    const result = v(kmeans(
        [
            { id: 'a1', vector: themeA },
            { id: 'a2', vector: themeA2 },
            { id: 'b1', vector: themeB },
            { id: 'b2', vector: themeB2 },
        ],
        2,
    ));
    const assignment = new Map<string, number>();
    for (const cluster of result.clusters) {
        for (const id of cluster.memberIds) assignment.set(id, cluster.index);
    }
    assert.equal(assignment.get('a1'), assignment.get('a2'));
    assert.equal(assignment.get('b1'), assignment.get('b2'));
    assert.notEqual(assignment.get('a1'), assignment.get('b1'));
});

check('clustering the same input twice gives the identical result', () => {
    const points = [
        { id: 'a1', vector: themeA },
        { id: 'a2', vector: themeA2 },
        { id: 'b1', vector: themeB },
        { id: 'b2', vector: themeB2 },
        { id: 'b3', vector: padded([0.05, 0.95, 0], 8) },
    ];
    const first = v(kmeans(points, 2));
    const second = v(kmeans(points, 2));
    assert.deepEqual(
        first.clusters.map((cluster) => cluster.memberIds),
        second.clusters.map((cluster) => cluster.memberIds),
    );
});

check('a cluster centroid is a unit vector', () => {
    const result = v(kmeans([{ id: 'a1', vector: themeA }, { id: 'a2', vector: themeA2 }], 1));
    assert.ok(Math.abs(magnitude(result.clusters[0].centroid) - 1) < 1e-9);
});

check('every point lands in exactly one cluster', () => {
    const result = v(kmeans(
        [
            { id: 'a1', vector: themeA },
            { id: 'a2', vector: themeA2 },
            { id: 'b1', vector: themeB },
            { id: 'b2', vector: themeB2 },
        ],
        2,
    ));
    assert.deepEqual(result.clusters.flatMap((cluster) => cluster.memberIds).sort(), ['a1', 'a2', 'b1', 'b2']);
});

check('clustering nothing is refused', () => {
    assert.match(why(kmeans([], 2)), /nothing to cluster/);
});

check('more clusters than points is refused, saying how many points there are', () => {
    assert.match(why(kmeans([{ id: 'a', vector: themeA }], 3)), /for 1 comparable point/);
});

check('a zero cluster count is refused', () => {
    assert.equal(kmeans([{ id: 'a', vector: themeA }], 0).state, 'refused');
});

check('the suggested k stays within its bound', () => {
    assert.equal(suggestK(1), 1);
    assert.ok(suggestK(10_000) <= 40);
    assert.ok(suggestK(100) >= 1);
});

check('a new theme joins the cluster it resembles', () => {
    const joined = v(assignToNearest([{ id: 'cluster-a', centroid: themeA }], themeA2, CLUSTER_SIMILARITY_THRESHOLD));
    assert.equal(joined.id, 'cluster-a');
});

check('a theme that matches nothing is refused, so a new cluster can be made', () => {
    assert.match(
        why(assignToNearest([{ id: 'cluster-a', centroid: themeA }], themeB, CLUSTER_SIMILARITY_THRESHOLD)),
        /below the 0.82 a match requires/,
    );
});

check('assigning to no clusters at all is refused', () => {
    assert.equal(assignToNearest([], themeA, 0.8).state, 'refused');
});

check('assigning a zero vector is refused', () => {
    assert.equal(assignToNearest([{ id: 'a', centroid: themeA }], vec(0, 0, 0), 0.8).state, 'refused');
});

check('a cluster is named for its most common label', () => {
    assert.equal(v(representativeLabel(['pricing objections', 'budget pushback', 'pricing objections'])), 'pricing objections');
});

check('a tie for the name breaks alphabetically, so it does not change between sweeps', () => {
    assert.equal(v(representativeLabel(['zebra', 'apple'])), 'apple');
});

check('a cluster with no usable label is refused', () => {
    assert.equal(representativeLabel(['  ', '']).state, 'refused');
});

// --------------------------------------------
// 4. Themes over time — and the refusals that protect the line
// --------------------------------------------

section('4. Trends');

check('periods are keyed by month and by quarter', () => {
    assert.equal(periodKey('2026-08-15T00:00:00Z', 'month'), '2026-08');
    assert.equal(periodKey('2026-08-15T00:00:00Z', 'quarter'), '2026-Q3');
    assert.equal(periodKey('2026-12-31T23:00:00Z', 'quarter'), '2026-Q4');
});

check('period keys sort chronologically as strings', () => {
    assert.deepEqual([...['2026-12', '2026-01', '2026-09']].sort(), ['2026-01', '2026-09', '2026-12']);
});

check('a range beginning mid-quarter still includes that quarter', () => {
    assert.deepEqual(periodRange('2026-08-15', '2026-11-02', 'quarter'), ['2026-Q3', '2026-Q4']);
});

check('a month range is inclusive at both ends', () => {
    assert.deepEqual(periodRange('2026-01-01', '2026-03-01', 'month'), ['2026-01', '2026-02', '2026-03']);
});

check('a reversed range yields nothing', () => {
    assert.deepEqual(periodRange('2026-06-01', '2026-01-01', 'month'), []);
});

check('an unreadable range is refused', () => {
    assert.equal(buildSeries([], 'not-a-date', '2026-01-01').state, 'refused');
});

check('occurrences land in their own period', () => {
    const series = v(buildSeries(['2026-01-05', '2026-01-20', '2026-03-01'], '2026-01-01', '2026-03-01', 'month'));
    assert.deepEqual(toCounts(series), [2, 0, 1]);
});

check('a period with no occurrences is a real zero, reported as zero', () => {
    const series = v(buildSeries(['2026-01-05'], '2026-01-01', '2026-02-01', 'month'));
    assert.deepEqual(toCounts(series), [1, 0]);
});

check('occurrences outside the window are counted, not silently dropped', () => {
    assert.equal(v(buildSeries(['2025-01-01', '2026-01-05'], '2026-01-01', '2026-01-01', 'month')).outside, 1);
});

check('an undated occurrence is counted separately from an out-of-range one', () => {
    const series = v(buildSeries(['nonsense', '2026-01-05'], '2026-01-01', '2026-01-01', 'month'));
    assert.equal(series.undated, 1);
    assert.equal(series.outside, 0);
});

check('a slope is fitted against position in the series', () => {
    assert.equal(v(slope([1, 2, 3])), 1);
    assert.equal(v(slope([3, 2, 1])), -1);
    assert.equal(v(slope([2, 2, 2])), 0);
});

check('a slope is refused below three points, and says two always lie on a line', () => {
    assert.match(why(slope([1, 5])), /two points always lie on a line/);
});

check('a direction inside the flat band is flat, not a small rise', () => {
    assert.equal(v(direction(1)), 'rising');
    assert.equal(v(direction(-1)), 'falling');
    assert.equal(v(direction(STAGNATION_SLOPE_BAND / 2)), 'flat');
    assert.equal(v(direction(-STAGNATION_SLOPE_BAND / 2)), 'flat');
});

check('a percentage change with no baseline is refused, not reported as infinite', () => {
    assert.match(why(percentChange([0, 4])), /no baseline/);
});

check('the absolute change is still available when the percentage is not', () => {
    assert.equal(v(absoluteChange([0, 4])), 4);
});

check('a percentage change is computed when there is a baseline', () => {
    assert.equal(v(percentChange([2, 4])), 1);
    assert.equal(v(percentChange([4, 2])), -0.5);
});

check('a change needs two periods', () => {
    assert.equal(percentChange([4]).state, 'refused');
    assert.equal(absoluteChange([4]).state, 'refused');
});

check('a stall needs consecutive flat periods, not merely some flat ones', () => {
    assert.equal(v(detectStagnation([5, 5, 5, 5])).stalled, true);
    assert.equal(v(detectStagnation([1, 2, 3, 4, 5])).stalled, false);
});

check('a stall is refused when there are too few periods to establish one', () => {
    assert.match(why(detectStagnation([5, 5])), /detecting a stall needs/);
});

check('a decline needs both a negative slope and a net fall', () => {
    assert.equal(v(detectRegression([10, 5, 1])).declining, true);
    assert.equal(v(detectRegression([1, 10, 5, 9])).declining, false);
});

check('a summary carries refusals rather than substituting numbers', () => {
    const summary = summarise([1, 2, 3, 4]);
    assert.equal(summary.points, 4);
    assert.equal(summary.total, 10);
    assert.equal(summary.slope.state, 'computed');
    assert.equal(summary.direction.state, 'computed');
});

check('a summary of two periods refuses the slope and keeps the total', () => {
    const summary = summarise([3, 9]);
    assert.equal(summary.slope.state, 'refused');
    assert.equal(summary.total, 12);
});

// --------------------------------------------
// 5. Benchmarks — published, or refused publication
// --------------------------------------------

section('5. Benchmarks');

check('percentiles interpolate between observations', () => {
    assert.equal(v(percentile([1, 2, 3, 4], 25)), 1.75);
    assert.equal(v(percentile([1, 2, 3, 4], 50)), 2.5);
    assert.equal(v(percentile([1, 2, 3, 4], 90)), 3.7);
});

check('percentiles do not depend on the order of the pool', () => {
    assert.equal(v(percentile([4, 1, 3, 2], 50)), v(percentile([1, 2, 3, 4], 50)));
});

check('a pool of one has a percentile', () => {
    assert.equal(v(percentile([7], 90)), 7);
});

check('an empty pool is refused', () => {
    assert.equal(percentile([], 50).state, 'refused');
});

check('an out-of-range percentile is refused', () => {
    assert.equal(percentile([1, 2], 150).state, 'refused');
    assert.equal(percentile([1, 2], -5).state, 'refused');
});

check('a pool below the floor publishes nothing, and says the count and the floor', () => {
    const reason = why(summariseCohort([50, 60, 70]));
    assert.match(reason, /3 candidates in this pool/);
    assert.match(reason, new RegExp(`at least ${MIN_BENCHMARK_COHORT}`));
});

check('a pool below the floor carries no percentile anywhere in the result', () => {
    assert.equal(hasNoValue(summariseCohort([50, 60, 70, 80])), true);
});

check('a pool at the floor publishes all four percentiles', () => {
    const published = v(summariseCohort([10, 20, 30, 40, 50]));
    assert.equal(published.cohortSize, 5);
    assert.equal(published.p50, 30);
    assert.ok(published.p25 <= published.p50);
    assert.ok(published.p75 <= published.p90);
});

check('the published percentiles are ordered', () => {
    const { p25, p50, p75, p90 } = v(summariseCohort([5, 90, 12, 77, 33, 61, 8]));
    assert.ok(p25 <= p50 && p50 <= p75 && p75 <= p90);
});

check('a percentile rank counts half the ties, so the median is not told they lead', () => {
    assert.equal(v(percentileRank(50, [40, 50, 60])), 50);
    assert.equal(v(percentileRank(100, [40, 50, 60])), 100);
    assert.equal(v(percentileRank(0, [40, 50, 60])), 0);
});

check('a percentile rank against no peers is refused', () => {
    assert.match(why(percentileRank(50, [])), /no peer scores/);
});

check('a score is placed in its band', () => {
    const benchmark = { cohortSize: 10, minCohortN: 5, p25: 40, p50: 55, p75: 70, p90: 85 };
    assert.equal(bandFor(90, benchmark), 'p90+');
    assert.equal(bandFor(72, benchmark), 'p75');
    assert.equal(bandFor(55, benchmark), 'p50');
    assert.equal(bandFor(40, benchmark), 'p25');
    assert.equal(bandFor(10, benchmark), 'below p25');
});

// --------------------------------------------
// 6. Growth — a line that admits what it cannot resolve
// --------------------------------------------

section('6. Growth trajectories');

function points(...thetas: number[]): AbilityPoint[] {
    return thetas.map((theta, index) => ({
        recordedAt: `2026-0${index + 1}-01T00:00:00Z`,
        theta,
        standardError: 0.2,
        responsesUsed: index + 1,
    }));
}

check('a trajectory is fitted through the history', () => {
    const fit = v(trajectory(points(0, 0.5, 1)));
    assert.equal(fit.points, 3);
    assert.ok(Math.abs(v(fit.slope) - 0.5) < 1e-9);
    assert.equal(v(fit.direction), 'rising');
    assert.ok(Math.abs(fit.netChange - 1) < 1e-9);
});

check('a trajectory is refused below three estimates', () => {
    assert.match(why(trajectory(points(0, 1))), /at least 3/);
});

check('an empty history is refused', () => {
    assert.equal(trajectory([]).state, 'refused');
});

check('points are ordered by their timestamp, whatever order they arrive in', () => {
    const fit = v(trajectory([
        { recordedAt: '2026-03-01', theta: 1, standardError: 0.2 },
        { recordedAt: '2026-01-01', theta: 0, standardError: 0.2 },
        { recordedAt: '2026-02-01', theta: 0.5, standardError: 0.2 },
    ]));
    assert.ok(Math.abs(v(fit.slope) - 0.5) < 1e-9);
    assert.equal(fit.first.theta, 0);
    assert.equal(fit.latest.theta, 1);
});

check('a change smaller than its own measurement error is flagged as unresolved', () => {
    const fit = v(trajectory([
        { recordedAt: '2026-01-01', theta: 0, standardError: 0.5 },
        { recordedAt: '2026-02-01', theta: 0.05, standardError: 0.5 },
        { recordedAt: '2026-03-01', theta: 0.02, standardError: 0.5 },
    ]));
    assert.equal(fit.resolvable, false);
});

check('a change larger than its measurement error is flagged as resolved', () => {
    const fit = v(trajectory([
        { recordedAt: '2026-01-01', theta: 0, standardError: 0.1 },
        { recordedAt: '2026-02-01', theta: 0.5, standardError: 0.1 },
        { recordedAt: '2026-03-01', theta: 1.0, standardError: 0.1 },
    ]));
    assert.equal(fit.resolvable, true);
});

check('an unreadable point is dropped and the drop is reported', () => {
    const fit = v(trajectory([
        { recordedAt: '2026-01-01', theta: 0, standardError: 0.2 },
        { recordedAt: '2026-02-01', theta: 0.5, standardError: 0.2 },
        { recordedAt: '2026-03-01', theta: 1, standardError: 0.2 },
        { recordedAt: 'not-a-date', theta: 5, standardError: 0.2 },
    ]));
    assert.equal(fit.points, 3);
    assert.equal(fit.dropped, 1);
});

check('a non-finite estimate is dropped rather than fitted', () => {
    const fit = v(trajectory([
        { recordedAt: '2026-01-01', theta: 0, standardError: 0.2 },
        { recordedAt: '2026-02-01', theta: NaN, standardError: 0.2 },
        { recordedAt: '2026-03-01', theta: 1, standardError: 0.2 },
        { recordedAt: '2026-04-01', theta: 1.5, standardError: 0.2 },
    ]));
    assert.equal(fit.points, 3);
    assert.equal(fit.dropped, 1);
});

check('dropping points can take a history below the floor, and that is refused', () => {
    assert.equal(trajectory([
        { recordedAt: '2026-01-01', theta: 0, standardError: 0.2 },
        { recordedAt: '2026-02-01', theta: NaN, standardError: 0.2 },
        { recordedAt: '2026-03-01', theta: 1, standardError: 0.2 },
    ]).state, 'refused');
});

check('a flat trajectory is flat, not a slow rise', () => {
    assert.equal(v(v(trajectory(points(1, 1.01, 1.02))).direction), 'flat');
});

check('the flat band for ability is its own constant, not the trend band', () => {
    assert.notEqual(ABILITY_FLAT_BAND, STAGNATION_SLOPE_BAND);
});

check('a decline raises a regression alert carrying its slope', () => {
    const fit = trajectory([
        { recordedAt: '2026-01-01', theta: 1.5, standardError: 0.1 },
        { recordedAt: '2026-02-01', theta: 1.0, standardError: 0.1 },
        { recordedAt: '2026-03-01', theta: 0.4, standardError: 0.1 },
    ]);
    const alerts = alertsFor([{ competencyId: 'c1', competencyName: 'System design', fit }]);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].kind, 'regression');
    assert.ok(alerts[0].slope !== null && alerts[0].slope < 0);
    assert.match(alerts[0].detail, /logits per estimate/);
});

check('a stalled trajectory raises a stagnation alert', () => {
    const fit = trajectory(points(1, 1.01, 1.0, 1.02));
    const alerts = alertsFor([{ competencyId: 'c1', competencyName: null, fit }]);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].kind, 'stagnation');
});

check('too little history is reported as a gap in the record, with no slope', () => {
    const alerts = alertsFor([{ competencyId: 'c1', competencyName: 'SQL', fit: trajectory(points(0, 1)) }]);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].kind, 'insufficient');
    assert.equal(alerts[0].slope, null);
    assert.equal(alerts[0].points, 0);
});

check('a healthy trajectory raises no alert at all', () => {
    assert.equal(alertsFor([{ competencyId: 'c1', competencyName: null, fit: trajectory(points(0, 0.4, 0.9, 1.4)) }]).length, 0);
});

check('a regression that is smaller than its error says so in the detail', () => {
    const alerts = alertsFor([{
        competencyId: 'c1',
        competencyName: null,
        fit: trajectory([
            { recordedAt: '2026-01-01', theta: 0.4, standardError: 0.8 },
            { recordedAt: '2026-02-01', theta: 0.2, standardError: 0.8 },
            { recordedAt: '2026-03-01', theta: -0.2, standardError: 0.8 },
        ]),
    }]);
    assert.equal(alerts[0].kind, 'regression');
    assert.match(alerts[0].detail, /cannot confirm it/);
});

// --------------------------------------------
// 7. The property: nothing is fabricated
// --------------------------------------------

section('7. No path returns a value it could not compute');

check('every refusal carries a reason, and no refusal carries a value', () => {
    const refusals: Measured<unknown>[] = [
        cosineSimilarity([], []),
        cosineSimilarity(vec(1), vec(1, 2)),
        cosineSimilarity(vec(0, 0), vec(1, 1)),
        normalise(vec(0, 0)),
        centroid([]),
        kmeans([], 2),
        kmeans([{ id: 'a', vector: themeA }], 4),
        assignToNearest([], themeA, 0.9),
        assignToNearest([{ id: 'a', centroid: themeA }], themeB, 0.99),
        representativeLabel([]),
        slope([1]),
        percentChange([0, 1]),
        detectStagnation([1]),
        percentile([], 50),
        summariseCohort([1, 2]),
        percentileRank(1, []),
        trajectory([]),
        trajectory(points(1)),
        buildSeries([], 'x', 'y'),
    ];

    assert.equal(refusals.length, 19);
    for (const result of refusals) {
        assert.equal(result.state, 'refused', 'expected a refusal');
        assert.equal(hasNoValue(result), true, 'a refusal carried a value');
        assert.ok(why(result).length > 0, 'a refusal carried no reason');
    }
});

check('no refusal returns 0 where a number was expected', () => {
    const numeric: Measured<unknown>[] = [
        slope([1]),
        percentChange([0, 4]),
        percentile([], 50),
        summariseCohort([1, 2, 3]),
        percentileRank(5, []),
        absoluteChange([1]),
        centroid([]),
    ];
    for (const result of numeric) {
        assert.equal(result.state, 'refused');
        assert.notEqual((result as { value?: unknown }).value, 0, 'a refusal returned 0');
    }
});

check('a refused benchmark cannot be mistaken for a zero benchmark', () => {
    const refusedPool = summariseCohort([1, 2, 3]);
    assert.equal(refusedPool.state, 'refused');
    assert.notEqual(JSON.stringify(refusedPool), JSON.stringify({ state: 'computed', value: 0 }));
});

// --------------------------------------------
// 8. The other half: a real zero survives
// --------------------------------------------

section('8. A measured zero is still a zero');

check('a period with no occurrences counts zero', () => {
    assert.deepEqual(toCounts(v(buildSeries(['2026-01-05'], '2026-01-01', '2026-03-01', 'month'))), [1, 0, 0]);
});

check('a perfectly flat series has a slope of zero, which is a measurement', () => {
    assert.equal(v(slope([3, 3, 3, 3])), 0);
});

check('a benchmark pool at exactly the floor is published, not suppressed', () => {
    assert.equal(summariseCohort([1, 2, 3, 4, 5]).state, 'computed');
});

check('a candidate below every peer scores a real zero percentile', () => {
    assert.equal(v(percentileRank(0, [10, 20])), 0);
});

check('an empty but covered window is all real zeros', () => {
    const covered = v(buildSeries([], '2026-01-01', '2026-02-01', 'month'));
    assert.deepEqual(toCounts(covered), [0, 0]);
    assert.equal(covered.outside, 0);
});

// --------------------------------------------
// Summary
// --------------------------------------------

console.log('\n' + '-'.repeat(52));
if (failed > 0) {
    console.log(`research core: ${passed} passed, ${failed} FAILED\n`);
    for (const failure of failures) console.log(`  · ${failure}\n`);
    process.exit(1);
}
console.log(`research core: ${passed} checks passed`);
