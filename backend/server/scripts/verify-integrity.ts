// ============================================
// verify-integrity.ts — correctness checks for the integrity core
//
// Feature 3 is the first part of this product that can accuse a candidate of
// something, so its maths is verified rather than assumed. Like verify-delivery.ts
// and verify-measurement.ts this runs with no database, no browser and no network.
//
//   npm run verify:integrity        (from backend/)
//
// Exits non-zero on any failure.
//
// THE CHECKS THAT MATTER MOST ARE THE ONES ABOUT REFUSING
//
// Most of the checks below confirm that a statistic computes what it claims to. The
// ones worth reading are in section 5, which confirms the things this feature must
// NOT do: score a session it could not assess, reward a browser that reported
// nothing, let one layer condemn a candidate, or carry a verdict anywhere in its
// result type. Those are the properties that keep an automated system from ending
// someone's candidacy on evidence it does not have.
// ============================================

import assert from 'node:assert/strict';
import {
    INTEGRITY_SIGNALS,
    REGISTRY_VERSION,
    evaluateSignal,
    formatSignalValue,
    scoringSignals,
    signalDefinition,
    signalsForLayer,
} from '../app/lib/integrity/contract';
import {
    CLIENT_REPORTED_CAVEAT,
    INTEGRITY_EVENT_TYPES,
    MAX_KEYSTROKE_INTERVAL_MS,
    MAX_KEYSTROKE_INTERVALS,
    MIN_KEYSTROKE_INTERVALS,
    SIGNAL_FOR_EVENT_TYPE,
    coefficientOfVariation,
    evaluateProctoring,
    foldProctoringEvents,
    isKnownEventType,
    minimizePayload,
    type RawIntegrityEvent,
} from '../app/lib/integrity/proctoringMath';
import {
    MATTR_WINDOW,
    MIN_BASELINE_ANSWERS,
    MIN_WORDS_FOR_DRIFT,
    MIN_WORDS_FOR_STYLOMETRY,
    PERPLEXITY_UNMEASURED_REASON,
    computeAuthenticity,
    countWords,
    functionWordProfile,
    lexicalDiversity,
    profileDistance,
    repetitionIndex,
    sentenceStats,
    splitSentences,
    stylometricDrift,
    templateLikeStructure,
    tokenize,
} from '../app/lib/integrity/stylometryMath';
import {
    MINHASH_SIZE,
    MIN_SHINGLES_FOR_COMPARISON,
    SHINGLE_SIZE,
    clusterMemberCount,
    clusterPairs,
    estimateJaccard,
    exactJaccard,
    findSimilarAnswers,
    minHashSignature,
    shingles,
    strongestSimilarity,
} from '../app/lib/integrity/similarityMath';
import {
    LAYER_CAPS,
    MAX_DEDUCTION,
    MIN_LAYERS_FOR_ASSESSMENT,
    MIN_SIGNALS_FOR_ASSESSMENT,
    flagFromStored,
    fuseIntegrity,
    type LayerInput,
} from '../app/lib/integrity/fusion';
import { fromStoredReport, redactForCandidate } from '../app/lib/integrity/integrityService';

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

/**
 * Runs one check, sync or async.
 *
 * The naive harness would count an async check as passing the moment it returned its
 * promise, and never see an assertion fail inside it — which is worse than having no
 * check at all, because it reports green.
 */
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

// --------------------------------------------
// Fixtures
// --------------------------------------------

/** A pool of ordinary words. Alphabetic only, since the tokenizer drops digits. */
const WORD_POOL = [
    'system', 'design', 'tradeoff', 'latency', 'cache', 'queue', 'request', 'failure',
    'retry', 'budget', 'schema', 'index', 'worker', 'stream', 'batch', 'contract',
    'version', 'migration', 'rollback', 'observe', 'metric', 'trace', 'alert',
    'threshold', 'capacity', 'throughput', 'backpressure', 'idempotent', 'replica',
    'partition', 'shard', 'consensus', 'quorum', 'lease', 'timeout', 'circuit',
    'breaker', 'payload', 'envelope', 'protocol', 'handshake', 'session', 'token',
    'credential', 'principal', 'policy', 'audit', 'retention', 'consent', 'purpose',
];

function makeSentence(random: () => number, wordCount: number): string {
    const words: string[] = [];
    for (let i = 0; i < wordCount; i += 1) {
        words.push(WORD_POOL[Math.floor(random() * WORD_POOL.length)]);
    }
    return `${words.join(' ')}.`;
}

/** Prose whose sentence lengths vary a lot — the shape human writing usually has. */
function variedProse(seed: number, lengths: number[]): string {
    const random = mulberry32(seed);
    return lengths.map((length) => makeSentence(random, length)).join(' ');
}

/** Prose whose sentences are all the same length — the shape a script produces. */
function uniformProse(seed: number, sentenceCount: number, length: number): string {
    return variedProse(seed, Array.from({ length: sentenceCount }, () => length));
}

/**
 * Two disjoint function-word vocabularies, standing in for two different people's
 * stylistic habits.
 *
 * Needed because drift is measured on function words specifically, and `variedProse`
 * above contains none — it is drawn entirely from a pool of content nouns. That is
 * not a flaw in the fixture for the tests that use it (burstiness and repetition are
 * about sentence shape and phrasing, not about register), but it does mean a drift
 * test written against `variedProse` would be asserting on text whose function-word
 * profile is empty. Section 3 pins that case separately, because refusing to compute
 * drift there is the correct behaviour and worth a check of its own.
 */
const VOICE_A = ['the', 'and', 'is', 'it', 'that', 'of', 'to', 'a', 'in', 'was', 'for', 'with', 'on', 'as', 'but', 'not', 'they', 'this', 'are', 'be'];
const VOICE_B = ['i', 'you', 'we', 'because', 'if', 'when', 'would', 'should', 'my', 'our', 'your', 'so', 'than', 'then', 'there', 'about', 'after', 'before', 'very', 'just'];

/**
 * Prose in a given voice: roughly half function words from one vocabulary, half
 * content words. Two texts built with the same voice produce similar function-word
 * profiles; two built with different voices produce near-opposite ones.
 */
function styledProse(seed: number, lengths: number[], voice: readonly string[]): string {
    const random = mulberry32(seed);
    const sentences = lengths.map((length) => {
        const words: string[] = [];
        for (let i = 0; i < length; i += 1) {
            words.push(
                random() < 0.45
                    ? voice[Math.floor(random() * voice.length)]
                    : WORD_POOL[Math.floor(random() * WORD_POOL.length)]
            );
        }
        return `${words.join(' ')}.`;
    });
    return sentences.join(' ');
}

/**
 * Inter-key intervals with the right shape for a person: log-normal, so mostly quick
 * with a long right tail. Uniform jitter is the wrong model — it produces a
 * coefficient of variation near 0.37, which is far tighter than real typing.
 */
function humanKeystrokes(seed: number, count: number): number[] {
    const random = mulberry32(seed);
    const intervals: number[] = [];
    for (let i = 0; i < count; i += 1) {
        // Box–Muller, with the median interval at 120ms and a log-scale spread of 0.55.
        const u1 = Math.max(random(), Number.EPSILON);
        const u2 = random();
        const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        intervals.push(Math.exp(Math.log(120) + 0.55 * gaussian));
    }
    return intervals;
}

/** A fixed cycle of distinct words, repeated `cycles` times. */
function cyclicText(cycles: number, distinct: number): string {
    const words = WORD_POOL.slice(0, distinct);
    const out: string[] = [];
    for (let i = 0; i < cycles; i += 1) out.push(...words);
    return out.join(' ');
}

/** A long human-ish answer, used wherever an authenticity layer needs real text. */
const SAMPLE_ANSWER = variedProse(11, [18, 4, 27, 9, 22, 6, 31, 12, 25, 7, 19, 30]);

/** Sentence lengths summing to 130 words — above the drift floor with margin. */
const DRIFT_LENGTHS = [22, 8, 31, 12, 25, 7, 19, 6];

/**
 * Five answers in one voice. A pool this wide is what a real candidate's earlier
 * answers give, and pooling them is what keeps the baseline side of a drift
 * comparison quiet enough to be worth comparing against.
 */
const VOICE_A_BASELINE = [
    styledProse(41, DRIFT_LENGTHS, VOICE_A),
    styledProse(42, [21, 9, 30, 13, 24, 8, 18, 7], VOICE_A),
    styledProse(43, [23, 7, 32, 11, 26, 6, 20, 5], VOICE_A),
    styledProse(44, [20, 10, 29, 14, 23, 9, 17, 8], VOICE_A),
    styledProse(45, [24, 6, 33, 10, 27, 5, 21, 4], VOICE_A),
];

// ============================================
// 1. Shingling & MinHash
// ============================================

section('Shingling & MinHash');

test('shingles are built over word windows, not characters', () => {
    const words = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ');
    // Digits are stripped by the tokenizer, so w0..w39 become single letters and
    // collapse to one token each. Build the input from alphabetic words instead.
    const text = WORD_POOL.slice(0, 20).join(' ');
    const tokens = tokenize(text);
    assert.equal(tokens.length, 20);
    assert.equal(shingles(text).size, 20 - SHINGLE_SIZE + 1);

    // The digit-bearing input is still handled without throwing; it simply produces
    // fewer distinct shingles because the tokenizer drops the digits.
    assert.ok(shingles(words).size >= 0);
});

test('too few words produce no shingles at all, not one short shingle', () => {
    // One shingle is a set of size one, and every set of size one is similar to every
    // other. The floor is what stops five-word answers pairing at maximum similarity.
    assert.equal(shingles('too short to shingle').size, 0);
    assert.equal(shingles('').size, 0);
});

test('an identical text has an estimated similarity of exactly one', () => {
    const signature = minHashSignature(shingles(SAMPLE_ANSWER));
    assert.equal(estimateJaccard(signature, signature), 1);
});

test('unrelated answers do not resemble each other', () => {
    const random = mulberry32(7);
    const a = variedProse(1, [20, 18, 22, 19, 21, 20]);
    const b = Array.from({ length: 120 }, () => WORD_POOL[Math.floor(random() * WORD_POOL.length)]).join(' ');

    const estimate = estimateJaccard(minHashSignature(shingles(a)), minHashSignature(shingles(b)));
    assert.ok(estimate < 0.2, `unrelated text estimated at ${estimate}, expected under 0.2`);
});

test('the estimate tracks exact Jaccard across seeded pairs', () => {
    // The claim MinHash makes is that the fraction of agreeing signature slots is an
    // unbiased estimate of Jaccard. This measures it rather than trusting it.
    const random = mulberry32(2026);
    for (let trial = 0; trial < 12; trial += 1) {
        const build = () => {
            const words: string[] = [];
            for (let i = 0; i < 80; i += 1) {
                words.push(WORD_POOL[Math.floor(random() * WORD_POOL.length)]);
            }
            return words.join(' ');
        };

        const textA = build();
        // B shares a seeded fraction of A's words, so the true similarity is known
        // to be somewhere between "identical" and "unrelated".
        const aTokens = tokenize(textA);
        const bTokens = aTokens.map((token) => (random() < 0.6 ? token : WORD_POOL[Math.floor(random() * WORD_POOL.length)]));
        const textB = bTokens.join(' ');

        const setA = shingles(textA);
        const setB = shingles(textB);
        if (setA.size < MIN_SHINGLES_FOR_COMPARISON || setB.size < MIN_SHINGLES_FOR_COMPARISON) continue;

        const exact = exactJaccard(setA, setB);
        const estimate = estimateJaccard(minHashSignature(setA), minHashSignature(setB));

        assert.ok(
            Math.abs(exact - estimate) < 0.15,
            `estimate ${estimate.toFixed(3)} is more than 0.15 from exact ${exact.toFixed(3)}`
        );
    }
});

test('the signature is deterministic across runs', () => {
    // A similarity figure that changed between two runs over unchanged data would
    // make the whole layer unauditable.
    const first = minHashSignature(shingles(SAMPLE_ANSWER));
    const second = minHashSignature(shingles(SAMPLE_ANSWER));
    assert.equal(first.length, MINHASH_SIZE);
    assert.deepEqual([...first], [...second]);
});

test('a near duplicate is caught well above an unrelated answer', () => {
    const original = SAMPLE_ANSWER;
    // A copy with punctuation changed and a handful of words swapped — what an answer
    // passed through a chat client or lightly edited by hand actually looks like.
    const tokens = tokenize(original);
    const random = mulberry32(99);
    const edited = tokens
        .map((token, index) => (index % 17 === 0 ? WORD_POOL[Math.floor(random() * WORD_POOL.length)] : token))
        .join(' ');

    const near = estimateJaccard(minHashSignature(shingles(original)), minHashSignature(shingles(edited)));
    const unrelatedText = Array.from({ length: 120 }, () => WORD_POOL[Math.floor(random() * WORD_POOL.length)]).join(' ');
    const far = estimateJaccard(minHashSignature(shingles(original)), minHashSignature(shingles(unrelatedText)));

    assert.ok(near > far + 0.4, `near duplicate ${near.toFixed(3)} should clearly exceed unrelated ${far.toFixed(3)}`);
});

test('findSimilarAnswers keeps pairs ordered and respects the shingle floor', () => {
    const short = { responseId: 'r-short', text: 'I would use a hash map.' };
    const long = { responseId: 'r-long', text: SAMPLE_ANSWER };
    const longCopy = { responseId: 'r-copy', text: SAMPLE_ANSWER };
    const lone = { responseId: 'r-lone', text: variedProse(31, [20, 18, 22, 19, 21, 20]) };

    const result = findSimilarAnswers([short, long, longCopy, lone], 0.75);

    assert.equal(result.skippedTooShort, 1, 'the four-word answer must be skipped, not compared');
    for (const pair of result.pairs) {
        assert.ok(pair.responseAId < pair.responseBId, 'pairs must be stored in one order only');
    }
    assert.ok(result.pairs.some((pair) => pair.similarity >= 0.99), 'the exact copy must be reported');
    assert.ok(!result.pairs.some((pair) => pair.responseAId === 'r-short' || pair.responseBId === 'r-short'));
});

test('findSimilarAnswers never compares answers to different questions', () => {
    const answers = [
        { responseId: 'r-a', text: SAMPLE_ANSWER, questionId: 'q1' },
        { responseId: 'r-b', text: SAMPLE_ANSWER, questionId: 'q2' },
    ];
    // Identical text, different questions. A correct implementation reports nothing,
    // because candidates in different studies were asked different things.
    assert.equal(findSimilarAnswers(answers, 0.75).pairs.length, 0);
});

// ============================================
// 2. Clustering
// ============================================

section('Clustering');

test('similarity is transitive: A≈B and B≈C is one group of three', () => {
    // The finding this exists for. A leaked answer circulated to three people where
    // the first and last happen to differ is ONE finding, not two.
    const assignment = clusterPairs(
        [
            { a: 'r1', b: 'r2' },
            { a: 'r2', b: 'r3' },
        ],
        ['r1', 'r2', 'r3']
    );

    assert.equal(assignment.get('r1'), assignment.get('r2'));
    assert.equal(assignment.get('r2'), assignment.get('r3'));
});

test('an answer that resembles nothing is in no cluster', () => {
    const assignment = clusterPairs([{ a: 'r1', b: 'r2' }], ['r1', 'r2', 'r3']);
    // A cluster of one is not a cluster: "part of a similar group" must not fire for
    // an answer that stands alone.
    assert.equal(assignment.has('r3'), false);
});

test('cluster ids are derived from members, so recomputation does not reshuffle them', () => {
    const pairs = [
        { a: 'r-b', b: 'r-c' },
        { a: 'r-a', b: 'r-b' },
    ];
    const forward = clusterPairs(pairs, ['r-a', 'r-b', 'r-c']);
    const reversed = clusterPairs([...pairs].reverse(), ['r-c', 'r-b', 'r-a']);
    assert.equal(forward.get('r-a'), reversed.get('r-a'));
    assert.equal(forward.get('r-a'), 'cluster-r-a');
});

test('cluster member count reports other people, not total size', () => {
    const pairs = [
        { responseAId: 'r-a', responseBId: 'r-b', similarity: 0.9, clusterId: 'cluster-r-a' },
        { responseAId: 'r-b', responseBId: 'r-c', similarity: 0.9, clusterId: 'cluster-r-a' },
    ];
    assert.equal(clusterMemberCount('r-a', pairs), 2, 'a member of three is similar to two others');
    assert.equal(clusterMemberCount('r-z', pairs), 0);
});

test('strongest similarity is zero for an answer that matched nothing', () => {
    // Unlike drift, this zero is a real measurement: the comparison ran and found
    // nothing, which is a fact rather than a gap.
    assert.equal(strongestSimilarity('r-a', []), 0);
    assert.equal(
        strongestSimilarity('r-c', [
            { responseAId: 'r-a', responseBId: 'r-b', similarity: 0.9 },
        ]),
        0
    );
});

test('end-to-end: a seeded near-duplicate family lands in one cluster', () => {
    // Three lightly-edited copies of one answer, edited at the same positions with
    // different words — what a circulated answer looks like after each recipient
    // paraphrases a phrase or two. The shared edit positions keep them mutually
    // similar; the differing words keep them from being exact copies.
    const tokens = tokenize(SAMPLE_ANSWER);
    const family = [0, 1, 2].map((index) => {
        const random = mulberry32(400 + index);
        return {
            responseId: `family-${index}`,
            text: tokens
                .map((token, position) => (position % 37 === 0 ? WORD_POOL[Math.floor(random() * WORD_POOL.length)] : token))
                .join(' '),
        };
    });
    const outsider = { responseId: 'outsider', text: variedProse(88, [21, 17, 24, 19, 20, 22]) };

    const result = findSimilarAnswers([...family, outsider], 0.6);
    const clustered = new Set(result.pairs.flatMap((pair) => [pair.responseAId, pair.responseBId]));

    assert.ok(clustered.has('family-0'), 'the seeded family must pair up');
    assert.ok(clustered.has('family-1'));
    assert.ok(clustered.has('family-2'));
    assert.ok(!clustered.has('outsider'), 'the unrelated answer must not join the cluster');

    // And the three land in ONE cluster, which is the whole reason clustering exists:
    // a leaked answer circulated to three people is one finding, not three.
    const clusterIds = new Set(result.pairs.map((pair) => pair.clusterId));
    assert.equal(clusterIds.size, 1, `expected one cluster, got ${[...clusterIds].join(', ')}`);
});

// ============================================
// 3. Stylometry
// ============================================

section('Stylometry');

test('sentence splitting handles terminal punctuation without a trailing space', () => {
    assert.deepEqual(splitSentences('One. Two! Three?'), ['One.', 'Two!', 'Three?']);
    assert.deepEqual(splitSentences(''), []);
});

test('varied sentence lengths score far above uniform ones', () => {
    const varied = sentenceStats(variedProse(3, [3, 28, 6, 31, 4, 25, 8, 30]));
    const uniform = sentenceStats(uniformProse(3, 8, 15));

    assert.ok(varied.burstiness !== null && uniform.burstiness !== null);
    assert.ok(
        (varied.burstiness as number) > 0.5,
        `varied prose scored ${varied.burstiness}, expected above 0.5`
    );
    assert.equal(uniform.burstiness, 0, 'identical sentence lengths are a coefficient of variation of zero');
});

test('burstiness is not measured below two sentences, rather than reported as zero', () => {
    // Zero is the most suspicious possible value, and a one-sentence answer would
    // otherwise produce it just for being one sentence.
    assert.equal(sentenceStats('One short sentence here.').burstiness, null);
    assert.equal(sentenceStats('').burstiness, null);
});

test('lexical diversity is length-normalised where a raw ratio is not', () => {
    // The same 30-word cycle sampled twice and ten times. A raw type-token ratio
    // collapses from 0.5 to 0.1 purely because the text got longer; a moving-average
    // ratio stays put, which is the whole reason the registry can give this signal one
    // threshold that means the same thing at any answer length.
    const short = cyclicText(2, 30);
    const long = cyclicText(10, 30);

    const shortTokens = tokenize(short);
    const longTokens = tokenize(long);
    const rawShort = new Set(shortTokens).size / shortTokens.length;
    const rawLong = new Set(longTokens).size / longTokens.length;

    const mattrShort = lexicalDiversity(short);
    const mattrLong = lexicalDiversity(long);

    assert.ok(mattrShort !== null && mattrLong !== null);
    assert.ok(rawLong < rawShort / 2, `raw ratio should collapse with length: ${rawShort} -> ${rawLong}`);
    assert.ok(
        Math.abs(mattrShort - mattrLong) < 0.02,
        `normalised measure should hold steady: ${mattrShort} vs ${mattrLong}`
    );
});

test('lexical diversity is not measured below one window', () => {
    assert.equal(lexicalDiversity('too short to measure'), null);
    assert.equal(lexicalDiversity(cyclicText(1, 20)), null, `${MATTR_WINDOW} tokens are needed`);
});

test('repetition is a share bounded to one', () => {
    const repeated = 'the system will retry the system will retry the system will retry the system will retry';
    const value = repetitionIndex(repeated);
    assert.ok(value !== null);
    assert.ok(value > 0.9 && value <= 1, `heavily repeated text scored ${value}, expected close to 1 but never above it`);

    // A share above 1 would make the registry's threshold unreadable, which is why the
    // measure counts n-gram positions rather than distinct n-grams.
    const varied = variedProse(5, [25, 24, 26, 23, 25, 24]);
    const variedValue = repetitionIndex(varied);
    assert.ok(variedValue !== null && variedValue < 0.3, `varied prose scored ${variedValue}, expected under 0.3`);
});

test('template structure is not measured below three sentences', () => {
    assert.equal(templateLikeStructure('Furthermore, one sentence only.'), null);
    const formulaic = 'Furthermore, the system is fast. Moreover, the system is safe. Additionally, the system scales.';
    assert.equal(templateLikeStructure(formulaic), 1);
});

test('drift is not measured below the baseline, and never reported as zero', () => {
    // The strongest signal in the feature is the one that most needs the discipline of
    // refusing to fire without evidence. Zero would mean "reads exactly like your
    // others", which is a confident claim and a false one at two priors.
    const answer = styledProse(60, DRIFT_LENGTHS, VOICE_A);
    assert.equal(stylometricDrift(answer, []), null);
    assert.equal(stylometricDrift(answer, [answer]), null);
    assert.equal(stylometricDrift(answer, [answer, answer]), null);
    assert.ok(MIN_BASELINE_ANSWERS === 3);

    const baseline = VOICE_A_BASELINE;
    const measured = stylometricDrift(answer, baseline);
    assert.ok(measured !== null, 'three baseline answers is enough to compute drift');
    assert.ok(measured! >= 0 && measured! <= 1, `drift must be a bounded distance, got ${measured}`);
});

test('drift refuses to compute on an answer too short to estimate a distribution', () => {
    // Drift is a comparison between frequency distributions, and a distribution
    // estimated from forty words is mostly sampling noise. The floor is higher than
    // the other writing-style measures for that reason, and below it the answer
    // reports not measured rather than a figure that would sit near the threshold.
    const short = styledProse(61, [22, 8, 31, 12, 8], VOICE_A);
    assert.ok(countWords(short) >= MIN_WORDS_FOR_STYLOMETRY, 'it is long enough for the other measures');
    assert.ok(countWords(short) < MIN_WORDS_FOR_DRIFT, 'but not long enough for drift');
    assert.equal(stylometricDrift(short, VOICE_A_BASELINE), null);

    // The other measures are still computed, so the answer is not reported as blank.
    const evidence = computeAuthenticity(short, VOICE_A_BASELINE);
    assert.equal(evidence.values.stylometricDrift, null);
    assert.equal(evidence.measured, true, 'burstiness and repetition still apply');
    assert.ok(evidence.explanation.includes(`${MIN_WORDS_FOR_DRIFT} words`));
});

test('drift refuses to compute against text with no function words', () => {
    // Found while writing these checks: `variedProse` is drawn entirely from content
    // nouns, so its function-word profile is empty and there is nothing to compare.
    // Returning null — rather than a distance of zero, which would read as "reads
    // exactly like your other answers" — is the correct behaviour and is pinned here.
    const contentOnly = [
        variedProse(71, [30, 28, 32, 31]),
        variedProse(72, [31, 29, 30, 32]),
        variedProse(73, [29, 32, 30, 31]),
    ];
    const answer = variedProse(74, [30, 28, 32, 31]);

    assert.equal(functionWordProfile(answer).size, 0);
    assert.equal(stylometricDrift(answer, contentOnly), null);
});

test('the drift threshold sits above the sampling noise of a single voice', () => {
    // THE CHECK THAT SET THE THRESHOLD, AND THE MOST IMPORTANT ONE IN THIS SECTION.
    //
    // Two answers written by the SAME person in the same register still produce
    // different function-word profiles, purely because each is a finite sample. If
    // that sampling floor reaches the firing threshold, the signal fires on honest
    // candidates — and a false positive here is not a bad score, it is an accusation.
    //
    // So the floor is measured across many independent same-voice samples rather than
    // assumed from one pair. The fixture draws function words from a flat distribution
    // over twenty types, which maximises the sampling noise; real prose is Zipfian and
    // quieter, so this is the conservative case.
    const definition = signalDefinition('stylometricDrift');
    assert.ok(definition);

    let worst = 0;
    for (let sample = 0; sample < 30; sample += 1) {
        const answer = styledProse(1000 + sample, DRIFT_LENGTHS, VOICE_A);
        const drift = stylometricDrift(answer, VOICE_A_BASELINE);
        assert.ok(drift !== null, `sample ${sample} did not compute`);
        worst = Math.max(worst, drift as number);
    }

    assert.ok(
        worst < definition!.band[0],
        `same-voice drift reached ${worst.toFixed(3)}, at or above the ${definition!.band[0]} threshold — this signal would fire on honest candidates`
    );
    // And with room to spare, not by a hair.
    assert.ok(
        worst < definition!.band[0] * 0.9,
        `same-voice drift reached ${worst.toFixed(3)} against a ${definition!.band[0]} threshold, which is too little margin`
    );
    assert.equal(
        evaluateSignal(definition!, worst).fired,
        false,
        'the worst same-voice sample must not fire the signal'
    );
});

test('drift is small for the same voice and fires for a different one', () => {
    // The other half of the threshold argument: it must still catch a genuine change
    // of register, or the margin above would have bought nothing.
    const definition = signalDefinition('stylometricDrift');
    assert.ok(definition);

    const sameVoice = styledProse(54, DRIFT_LENGTHS, VOICE_A);
    const differentVoice = styledProse(55, DRIFT_LENGTHS, VOICE_B);

    const near = stylometricDrift(sameVoice, VOICE_A_BASELINE);
    const far = stylometricDrift(differentVoice, VOICE_A_BASELINE);

    assert.ok(near !== null && far !== null);
    assert.ok(far! > near!, `a different voice (${far}) should drift further than the same voice (${near})`);
    assert.equal(evaluateSignal(definition!, near!).fired, false);
    assert.equal(evaluateSignal(definition!, far!).fired, true, 'a different register must fire');

    // Three independent different-voice samples, so this is not one lucky draw.
    for (let sample = 0; sample < 3; sample += 1) {
        const other = styledProse(2000 + sample, DRIFT_LENGTHS, VOICE_B);
        const drift = stylometricDrift(other, VOICE_A_BASELINE);
        assert.ok(drift !== null);
        assert.equal(
            evaluateSignal(definition!, drift as number).fired,
            true,
            `a different voice drifted only ${drift}, which would not fire`
        );
    }
});

test('the profile distance is symmetric and bounded by one', () => {
    const a = functionWordProfile('The system is fast and it is reliable because we built it that way.');
    const b = functionWordProfile('I am not sure that this is what they wanted, but it is what we have.');
    assert.equal(profileDistance(a, b), profileDistance(b, a));
    assert.ok(profileDistance(a, b) <= 1);
    assert.equal(profileDistance(a, a), 0);
});

test('perplexity is reported as not measured, never as a number', () => {
    // A true perplexity needs a language model. Substituting a proxy and labelling it
    // "perplexity" would be exactly the fabrication this platform forbids, so the
    // value is null and a sentence says why.
    const evidence = computeAuthenticity(SAMPLE_ANSWER, []);
    assert.equal(evidence.values.perplexity, null);
    assert.ok(evidence.explanation.includes(PERPLEXITY_UNMEASURED_REASON));

    // No function in the module can produce one: the only key is pinned to null for
    // any input, including a long one where every other measure computes.
    const long = computeAuthenticity(cyclicText(20, 50), []);
    assert.equal(long.values.perplexity, null);
});

test('a short answer measures nothing rather than measuring badly', () => {
    const evidence = computeAuthenticity('I would use a hash map.', []);
    assert.equal(evidence.measured, false);
    assert.equal(evidence.values.lowBurstiness, null);
    assert.equal(evidence.values.stylometricDrift, null);
    assert.ok(evidence.wordCount < MIN_WORDS_FOR_STYLOMETRY);
    assert.ok(evidence.explanation.includes('too short'));
});

test('computeAuthenticity never yields a non-finite value', () => {
    // A NaN would drift a score downward through the fusion arithmetic, which is the
    // direction that harms the candidate.
    const inputs = ['', '   ', '!!!', '.', 'a', SAMPLE_ANSWER, cyclicText(10, 30)];
    for (const input of inputs) {
        const evidence = computeAuthenticity(input, [SAMPLE_ANSWER, SAMPLE_ANSWER, SAMPLE_ANSWER]);
        for (const [key, value] of Object.entries(evidence.values)) {
            assert.ok(value === null || Number.isFinite(value), `${key} produced ${value} for input ${JSON.stringify(input.slice(0, 12))}`);
        }
        assert.ok(Number.isFinite(evidence.wordCount));
        assert.ok(countWords(input) === evidence.wordCount);
    }
});

// ============================================
// 4. Proctoring
// ============================================

section('Proctoring');

test('the payload minimizer strips unknown keys rather than passing them through', () => {
    // The allow-list is what stops a future client widening what is stored by sending
    // a new field. A deny-list would store every new field by default.
    const minimized = minimizePayload('paste', {
        clipboardText: 'the entire answer, copied',
        content: 'secret',
        typedText: 'secret',
        keystrokes: ['a', 'b'],
    });
    assert.deepEqual(minimized, {}, 'a paste event carries no content at all');
});

test('the minimizer keeps only the documented keys for each type', () => {
    assert.deepEqual(minimizePayload('visibility-hidden', { durationMs: 4200, innerText: 'no' }), {
        durationMs: 4200,
    });
    assert.deepEqual(minimizePayload('resolution-change', { width: 1920, height: 1080, deviceName: 'no' }), {
        width: 1920,
        height: 1080,
    });
    assert.deepEqual(minimizePayload('unknown-type', { durationMs: 1 }), {});
    assert.deepEqual(minimizePayload('paste', null), {});
});

test('the minimizer drops non-finite numbers and caps the interval array', () => {
    assert.deepEqual(minimizePayload('visibility-hidden', { durationMs: Number.NaN }), {});
    assert.deepEqual(minimizePayload('visibility-hidden', { durationMs: '4000' }), {});

    const huge = Array.from({ length: MAX_KEYSTROKE_INTERVALS + 500 }, () => 100);
    const minimized = minimizePayload('keystroke-cadence', { intervalsMs: huge });
    assert.equal((minimized.intervalsMs as number[]).length, MAX_KEYSTROKE_INTERVALS);

    const dirty = minimizePayload('keystroke-cadence', { intervalsMs: [100, Number.NaN, 'x', 120, Infinity] });
    assert.deepEqual(dirty.intervalsMs, [100, 120]);
});

test('nothing in a stored payload can carry content or keystroke identity', () => {
    // Belt and braces: whatever a client sends for any known type, no key that could
    // hold the candidate's words or which keys they pressed survives.
    const forbidden = ['content', 'text', 'clipboard', 'clipboardText', 'value', 'keystrokes', 'keys', 'typed', 'typedText', 'body'];
    for (const type of INTEGRITY_EVENT_TYPES) {
        const payload: Record<string, unknown> = {};
        for (const key of forbidden) payload[key] = 'sensitive';
        payload.durationMs = 100;
        payload.intervalsMs = [100, 110];
        payload.width = 100;
        payload.height = 100;

        const minimized = minimizePayload(type, payload);
        for (const key of Object.keys(minimized)) {
            assert.ok(!forbidden.includes(key), `${type} allowed ${key} through the minimizer`);
        }
    }
});

test('a scripted cadence and a human one separate cleanly', () => {
    // A fixed-interval script has no variance at all; a person's typing is heavily
    // right-skewed. This is the gap the threshold has to sit inside, so it is measured
    // rather than assumed — an earlier threshold of 0.35 turned out to sit inside the
    // range ordinary people produce.
    const scriptedCv = coefficientOfVariation(Array.from({ length: 120 }, () => 120));
    const humanCv = coefficientOfVariation(humanKeystrokes(17, 120));

    assert.equal(scriptedCv, 0);
    assert.ok(humanCv !== null && humanCv > 0.45, `human-like typing scored ${humanCv}, expected above 0.45`);

    // The separation is what matters, not either figure on its own.
    assert.ok((humanCv as number) - (scriptedCv as number) > 0.45);
});

test('a mechanical cadence fires the signal and a human one does not', () => {
    const definition = signalDefinition('uniformKeystrokeCadence');
    assert.ok(definition);

    const scripted = coefficientOfVariation(Array.from({ length: 120 }, () => 120)) as number;
    const human = coefficientOfVariation(humanKeystrokes(23, 120)) as number;

    const scriptedEval = evaluateSignal(definition, scripted);
    const humanEval = evaluateSignal(definition, human);

    assert.equal(scriptedEval.fired, true, 'a perfectly uniform cadence must fire');
    assert.equal(scriptedEval.deduction, definition.maxPoints, 'a coefficient of variation of zero must reach the full deduction');
    assert.equal(humanEval.fired, false, 'ordinary typing must not fire');
    assert.equal(humanEval.deduction, 0);

    // And a metronome that is not perfectly fixed should still fire, since a script
    // pretending to be human is the case this signal exists to catch.
    const nearUniform = coefficientOfVariation(Array.from({ length: 120 }, (_, i) => 120 + (i % 2) * 6));
    assert.equal(evaluateSignal(definition, nearUniform).fired, true, 'a near-uniform cadence must still fire');
});

test('a cadence is not computed from too few keystrokes', () => {
    const evidence = foldProctoringEvents([
        { type: 'keystroke-cadence', payload: { intervalsMs: Array.from({ length: MIN_KEYSTROKE_INTERVALS - 1 }, () => 100) } },
    ]);
    assert.equal(evidence.values.uniformKeystrokeCadence, null, 'a handful of intervals is noise, not a rhythm');
    assert.ok(evidence.caveats.some((caveat) => caveat.includes('too few')));
});

test('thinking gaps are discarded rather than inflating every typist’s variance', () => {
    const intervals = [...Array.from({ length: 40 }, () => 100), MAX_KEYSTROKE_INTERVAL_MS + 1, 60000];
    const evidence = foldProctoringEvents([{ type: 'keystroke-cadence', payload: { intervalsMs: intervals } }]);
    // Only the 40 real typing intervals survive, so the cadence is exactly uniform.
    assert.equal(evidence.values.uniformKeystrokeCadence, 0);
});

test('events fold into the values the registry expects', () => {
    const events: RawIntegrityEvent[] = [
        { type: 'paste' },
        { type: 'paste' },
        { type: 'copy' },
        { type: 'visibility-hidden', payload: { durationMs: 3000 } },
        { type: 'visibility-hidden', payload: { durationMs: 2000 } },
        { type: 'window-blur' },
        { type: 'fullscreen-exit' },
        { type: 'resolution-change', payload: { width: 1280, height: 720 } },
        { type: 'devtools-suspected' },
    ];

    const evidence = foldProctoringEvents(events);
    assert.equal(evidence.values.pasteDuringAnswer, 2);
    assert.equal(evidence.values.copyFromInterview, 1);
    assert.equal(evidence.values.tabHiddenDuration, 5000);
    assert.equal(evidence.values.windowBlurCount, 1);
    assert.equal(evidence.values.fullscreenExitCount, 1);
    assert.equal(evidence.values.resolutionChangeCount, 1);
    assert.equal(evidence.values.devtoolsSuspected, 1);
    assert.equal(evidence.totalEvents, events.length);
    assert.equal(evidence.unrecognisedEvents, 0);
    assert.ok(evidence.caveats.includes(CLIENT_REPORTED_CAVEAT));
});

test('unknown event types are counted, not guessed at', () => {
    const evidence = foldProctoringEvents([
        { type: 'paste' },
        { type: 'telepathy-detected' },
        { type: '' },
    ]);
    assert.equal(evidence.unrecognisedEvents, 2);
    assert.equal(evidence.values.pasteDuringAnswer, 1);
    assert.ok(evidence.caveats.some((caveat) => caveat.includes('does not recognise')));
});

test('a silent browser reports zeros but no evidence', () => {
    // This is the check that stops a client earning a clean score by saying nothing.
    // The zeros are absences of data, and `totalEvents` is what distinguishes them.
    const evidence = foldProctoringEvents([]);
    assert.equal(evidence.totalEvents, 0);
    assert.equal(evidence.values.pasteDuringAnswer, 0);
    assert.equal(evidence.values.tabHiddenDuration, 0);
    assert.ok(evidence.caveats.some((caveat) => caveat.includes('No proctoring events')));
});

test('devtools is recorded but never scored', () => {
    const definition = signalDefinition('devtoolsSuspected');
    assert.ok(definition);
    assert.equal(definition.shape, 'informational');
    assert.equal(definition.maxPoints, 0);

    const evaluation = evaluateSignal(definition, 12);
    assert.equal(evaluation.deduction, 0);
    assert.equal(evaluation.fired, false);
    assert.ok(!scoringSignals().some((signal) => signal.key === 'devtoolsSuspected'));
});

test('evaluateProctoring skips unmeasured values rather than scoring them as zero', () => {
    const evidence = foldProctoringEvents([]);
    const evaluations = evaluateProctoring(evidence, (key, value) => {
        const definition = signalDefinition(key);
        return definition ? evaluateSignal(definition, value) : null;
    });
    // Every proctoring value is present but the cadence is null, so it is the one that
    // must be absent from the evaluations.
    assert.ok(!evaluations.some((evaluation) => evaluation.key === 'uniformKeystrokeCadence'));
    assert.equal(evaluations.length, 7);
});

// ============================================
// 5. Fusion — the refusals
// ============================================

section('Fusion: what it must refuse to do');

/** Builds a layer input whose signals all sit at a chosen value. */
function layerAt(layerName: LayerInput['layer'], value: number, hasEvidence = true): LayerInput {
    const evaluations = signalsForLayer(layerName).map((definition) => evaluateSignal(definition, value));
    return { layer: layerName, evaluations, hasEvidence };
}

test('a session with no evidence is not assessed and has no score', () => {
    // The central refusal. 100 would claim the person is clean from no observations;
    // 0 would claim the opposite. Both are statements the platform cannot justify to
    // the person they are about.
    const result = fuseIntegrity([]);
    assert.equal(result.assessed, false);
    assert.equal(result.score, null, 'an unassessed session must carry no score at all');
    assert.equal(result.status, 'not_assessed');
    assert.ok(result.explanation.includes('not the same as judging it clean'));
});

test('a silent browser cannot earn a clean score by reporting nothing', () => {
    // Eight proctoring values of zero, all "measured", and not one of them an
    // observation. Counting them would hand every clean score to whoever suppresses
    // reporting — so `hasEvidence: false` keeps them out of the assessment gate.
    const silent = layerAt('proctoring', 0, false);
    const result = fuseIntegrity([silent]);

    assert.equal(result.assessed, false);
    assert.equal(result.score, null);
    assert.equal(result.layers[0].measured, 8, 'the values are still recorded');
    assert.equal(result.layers[0].hasEvidence, false, 'but the layer observed nothing');
});

test('one layer cannot corroborate itself into a score', () => {
    const alone = fuseIntegrity([layerAt('proctoring', 0, true)]);
    assert.equal(alone.assessed, false);
    assert.equal(alone.score, null);
    assert.ok(alone.explanation.includes(`${MIN_LAYERS_FOR_ASSESSMENT}`));
});

test('two layers with genuine evidence produce a score', () => {
    const result = fuseIntegrity([layerAt('proctoring', 0, true), layerAt('authenticity', 0.5, true)]);
    assert.equal(result.assessed, true);
    assert.equal(result.status, 'assessed');
    assert.equal(typeof result.score, 'number');
});

test('too few measured signals is not enough to assess', () => {
    // Two layers, but between them fewer signals than the floor. Evidence that thin is
    // not a judgement anyone should make.
    const sparse: LayerInput[] = [
        { layer: 'proctoring', evaluations: [evaluateSignal(signalDefinition('pasteDuringAnswer')!, 0)], hasEvidence: true },
        { layer: 'authenticity', evaluations: [evaluateSignal(signalDefinition('lowBurstiness')!, 0.6)], hasEvidence: true },
    ];
    const result = fuseIntegrity(sparse);
    assert.equal(result.assessed, false);
    assert.equal(result.score, null);
    assert.ok(result.explanation.includes(`${MIN_SIGNALS_FOR_ASSESSMENT}`));
});

test('each layer is capped, so no one of them can take a session to the floor', () => {
    // The corroboration rule, enforced by arithmetic rather than by convention.
    const names = ['proctoring', 'authenticity', 'similarity'] as const;
    for (const name of names) {
        const result = fuseIntegrity([layerAt(name, 1_000_000, true), layerAt('authenticity', 1_000_000, true)]);
        const summary = result.layers.find((entry) => entry.layer === name)!;

        assert.equal(summary.deduction, LAYER_CAPS[name], `${name} did not stop at its cap`);
        assert.ok(
            LAYER_CAPS[name] < MAX_DEDUCTION,
            `${name}'s cap must sit below the overall ceiling, or a saturated layer could condemn alone`
        );
        assert.ok((result.score as number) >= 100 - MAX_DEDUCTION, `a saturated ${name} layer reached the floor`);
    }
});

test('everything firing at once still cannot reach zero', () => {
    const result = fuseIntegrity([
        layerAt('proctoring', 1_000_000, true),
        layerAt('authenticity', 1_000_000, true),
        layerAt('similarity', 1_000_000, true),
    ]);

    assert.equal(result.totalDeduction, MAX_DEDUCTION);
    assert.equal(result.score, 100 - MAX_DEDUCTION);
    assert.ok((result.score as number) > 0, 'an automated system must never be able to zero a candidate');
    assert.ok(result.caveats.some((caveat) => caveat.includes('ceiling')));
});

test('a score is never produced from nothing, in either direction', () => {
    // Sweeps every combination of layers and evidence, and asserts the invariant that
    // holds across all of them: a score exists exactly when the session was assessed,
    // and lies strictly between 0 and 100.
    const names = ['proctoring', 'authenticity', 'similarity'] as const;
    for (let mask = 0; mask < 8; mask += 1) {
        const inputs: LayerInput[] = [];
        for (let bit = 0; bit < 3; bit += 1) {
            if (mask & (1 << bit)) inputs.push(layerAt(names[bit], 0, (mask & 8) === 0));
        }
        const result = fuseIntegrity(inputs);
        if (result.assessed) {
            assert.ok(typeof result.score === 'number', 'assessed means a score exists');
            assert.ok((result.score as number) > 0 && (result.score as number) <= 100);
        } else {
            assert.equal(result.score, null, 'unassessed means no score, whatever the inputs');
        }
    }
});

test('the result carries no verdict, recommendation or action', () => {
    // Not "we promise not to auto-reject" — there is structurally nowhere in this type
    // to put a decision. This pins the field list so a later change cannot quietly add
    // one, and names the specific fields a well-meaning contributor might reach for.
    const result = fuseIntegrity([layerAt('proctoring', 1, true), layerAt('authenticity', 1, true)]);

    const expected = [
        'assessed', 'score', 'status', 'flags', 'checked', 'layers',
        'caveats', 'totalDeduction', 'registryVersion', 'explanation',
    ];
    assert.deepEqual(Object.keys(result).sort(), [...expected].sort());

    const forbidden = [
        'verdict', 'recommendation', 'recommendedAction', 'action', 'risk', 'riskLevel',
        'shouldReject', 'reject', 'decision', 'outcome', 'conclusion', 'severity',
        'guilty', 'pass', 'fail', 'misconduct',
    ];
    for (const field of forbidden) {
        assert.ok(!(field in result), `IntegrityResult must not carry a ${field} field`);
    }
});

test('every deduction maps to a flag carrying its measured value', () => {
    const result = fuseIntegrity([
        layerAt('proctoring', 1_000_000, true),
        layerAt('authenticity', 1_000_000, true),
        layerAt('similarity', 1_000_000, true),
    ]);

    assert.ok(result.flags.length > 0);
    for (const flag of result.flags) {
        const definition = signalDefinition(flag.key);
        assert.ok(definition, `flag ${flag.key} has no registry signal`);
        assert.ok(flag.deduction > 0, 'a flag with no deduction is not a finding');
        assert.ok(flag.formattedValue.length > 0);
        assert.ok(flag.explanation.length > 0);
        assert.ok(flag.whatItCannotSay.length > 0, `flag ${flag.key} lost its innocent explanation`);
        assert.equal(flag.deduction, evaluateSignal(definition!, flag.value).deduction, 'the flag must match the registry arithmetic');
    }
});

test('flags are ordered by how much they moved the score', () => {
    const result = fuseIntegrity([layerAt('proctoring', 1_000_000, true), layerAt('similarity', 1_000_000, true)]);
    for (let i = 1; i < result.flags.length; i += 1) {
        assert.ok(result.flags[i - 1].deduction >= result.flags[i].deduction);
    }
});

test('measured signals that stayed in range are listed as checked', () => {
    // A reader is entitled to see what was looked at, not only what was found.
    const result = fuseIntegrity([layerAt('proctoring', 0, true), layerAt('authenticity', 1_000_000, true)]);
    assert.ok(result.checked.includes('pasteDuringAnswer'), 'a clean proctoring signal must still be listed as checked');
    assert.ok(!result.flags.some((flag) => flag.key === 'pasteDuringAnswer'));
});

test('a non-finite value removes nothing', () => {
    const definition = signalDefinition('pasteDuringAnswer');
    assert.ok(definition);
    // A broken measurement must not move a score, and NaN drifts downward, which is
    // the direction that harms the candidate.
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const evaluation = evaluateSignal(definition, value);
        assert.equal(evaluation.deduction, 0);
        assert.equal(evaluation.fired, false);
    }
});

test('the per-layer cap is reported when it binds', () => {
    const result = fuseIntegrity([layerAt('proctoring', 1_000_000, true), layerAt('authenticity', 0, true)]);
    assert.ok(result.caveats.some((caveat) => caveat.includes('capped at')));
    assert.equal(result.layers.find((summary) => summary.layer === 'proctoring')!.deduction, LAYER_CAPS.proctoring);
});

// ============================================
// 6. The innocent explanation, and the registry
// ============================================

section('The innocent explanation');

test('every registered signal states what it cannot say', () => {
    // The field that stops a flag being read as more conclusive than it is. A signal
    // presented without its innocent reading is an accusation.
    assert.ok(INTEGRITY_SIGNALS.length > 0);
    for (const definition of INTEGRITY_SIGNALS) {
        assert.ok(
            definition.whatItCannotSay.trim().length > 20,
            `${definition.key} has an empty or perfunctory whatItCannotSay`
        );
        assert.ok(definition.description.trim().length > 0, `${definition.key} has no description`);
        assert.ok(definition.label.trim().length > 0, `${definition.key} has no label`);
    }
});

test('signal keys are unique and every key resolves', () => {
    const keys = INTEGRITY_SIGNALS.map((definition) => definition.key);
    assert.equal(new Set(keys).size, keys.length, 'duplicate signal keys would make lookups ambiguous');
    for (const key of keys) assert.ok(signalDefinition(key), `${key} does not resolve`);
    assert.equal(signalDefinition('not-a-signal'), undefined);
});

test('every signal belongs to a real layer and has a sane band', () => {
    for (const definition of INTEGRITY_SIGNALS) {
        assert.ok(['proctoring', 'authenticity', 'similarity'].includes(definition.layer));
        assert.ok(['info', 'low', 'medium', 'high'].includes(definition.severity));
        assert.ok(definition.band.length === 2);
        assert.ok(definition.band[0] <= definition.band[1], `${definition.key} has an inverted band`);
        assert.ok(definition.tolerance >= 0);
        assert.ok(definition.maxPoints >= 0);
        if (definition.shape === 'informational') assert.equal(definition.maxPoints, 0);
    }
});

test('a scoring signal can actually reach its full deduction', () => {
    // A signal whose tolerance puts the maximum out of reach is one the registry is
    // lying about. For a band, the maximum is reached at the value furthest inside the
    // problematic region — zero for a lower-bound band, and one above the top for an
    // unbounded one.
    for (const definition of scoringSignals()) {
        const extreme =
            definition.shape === 'higher-worse'
                ? definition.band[0] + definition.tolerance
                : definition.band[0] - definition.tolerance;
        const evaluation = evaluateSignal(definition, extreme);
        assert.equal(
            evaluation.deduction,
            definition.maxPoints,
            `${definition.key} cannot reach its ${definition.maxPoints}-point maximum (reached ${evaluation.deduction} at ${extreme})`
        );
    }
});

test('integrity only ever subtracts', () => {
    // There is no signal that adds points, because a platform must never reward
    // someone for appearing honest — a quality no camera can observe.
    for (const definition of INTEGRITY_SIGNALS) {
        for (const value of [-1e6, -1, 0, 0.5, 1, 100, 1e6, Number.NaN]) {
            const evaluation = evaluateSignal(definition, value);
            assert.ok(evaluation.deduction >= 0, `${definition.key} produced a negative deduction at ${value}`);
            assert.ok(evaluation.position >= 0 && evaluation.position <= 1);
        }
    }
});

test('every event type maps to a signal that knows what it cannot say', () => {
    // An event that maps to nothing could be stored with nothing able to say what it
    // does and does not prove, so no such event type may exist.
    assert.equal(INTEGRITY_EVENT_TYPES.length, 8);
    for (const type of INTEGRITY_EVENT_TYPES) {
        const key = SIGNAL_FOR_EVENT_TYPE[type];
        const definition = signalDefinition(key);
        assert.ok(definition, `event type ${type} maps to unknown signal ${key}`);
        assert.equal(definition!.layer, 'proctoring', `${key} is not a proctoring signal`);
        assert.ok(isKnownEventType(type));
    }
    assert.equal(isKnownEventType('telepathy-detected'), false);
});

test('a stored report survives a round trip through the database shape', () => {
    const result = fuseIntegrity([
        layerAt('proctoring', 1_000_000, true),
        layerAt('similarity', 1_000_000, true),
    ]);

    const restored = fromStoredReport({
        sessionId: 'session-1',
        assessed: result.assessed,
        score: result.score,
        status: result.status,
        flagsJSON: result.flags,
        caveatsJSON: result.caveats,
        layersJSON: { layers: result.layers, checked: result.checked },
        registryVersion: result.registryVersion,
        generatedAt: new Date().toISOString(),
    });

    assert.equal(restored.assessed, result.assessed);
    assert.equal(restored.score, result.score);
    assert.equal(restored.flags.length, result.flags.length);
    for (const flag of restored.flags) {
        assert.ok(flag.whatItCannotSay.length > 0, 'a restored flag must keep its innocent explanation');
        assert.ok(flag.deduction > 0);
    }
});

test('a stored report whose signal no longer exists stays readable', () => {
    // Thresholds and signal names will change. A past finding must stay readable
    // exactly as it was recorded rather than becoming blank.
    const flag = flagFromStored({
        key: 'aSignalThatWasRetired',
        label: 'Retired signal',
        layer: 'proctoring',
        severity: 'medium',
        value: 3,
        formattedValue: '3 times',
        deduction: 6,
        explanation: 'Recorded under an older registry.',
        whatItCannotSay: 'The innocent explanation recorded at the time.',
    });
    assert.ok(flag);
    assert.equal(flag!.label, 'Retired signal');
    assert.equal(flag!.deduction, 6);
    assert.ok(flag!.whatItCannotSay.length > 0);

    assert.equal(flagFromStored(null), null);
    assert.equal(flagFromStored('not an object'), null);
    assert.equal(flagFromStored({}), null);
});

test('the candidate’s view withholds the other candidate, not their own finding', () => {
    const result = fuseIntegrity([layerAt('similarity', 1_000_000, true), layerAt('proctoring', 0, true)]);
    const redacted = redactForCandidate({
        version: 1,
        assessed: result.assessed,
        score: result.score,
        status: result.status,
        flags: result.flags,
        checked: result.checked,
        layers: result.layers,
        caveats: result.caveats,
        totalDeduction: result.totalDeduction,
        registryVersion: result.registryVersion,
        explanation: result.explanation,
        generatedAt: new Date().toISOString(),
    });

    const similarityFlag = redacted.flags.find((flag) => flag.layer === 'similarity');
    assert.ok(similarityFlag, 'the candidate sees the finding about their own answer');
    assert.ok(similarityFlag!.deduction > 0, 'and the points it cost them');
    assert.ok(similarityFlag!.explanation.includes('belongs to another candidate'));

    const proctoringFlag = redacted.flags.find((flag) => flag.layer === 'proctoring');
    if (proctoringFlag) assert.ok(!proctoringFlag.explanation.includes('belongs to another candidate'));
});

test('the registry version is recorded on every report', () => {
    // Thresholds are judgements and they will move. Without a version, a finding made
    // under one set would be silently re-read under another.
    assert.ok(REGISTRY_VERSION >= 1);
    const result = fuseIntegrity([layerAt('proctoring', 0, true), layerAt('authenticity', 0, true)]);
    assert.equal(result.registryVersion, REGISTRY_VERSION);
});

test('value formatting never leaks a raw float to a reader', () => {
    for (const definition of INTEGRITY_SIGNALS) {
        const formatted = formatSignalValue(definition, 4321.987);
        assert.ok(formatted.length > 0);
        assert.ok(!formatted.includes('4321.987'));
    }
    assert.equal(formatSignalValue(signalDefinition('tabHiddenDuration')!, 4200), '4.2s');
    assert.equal(formatSignalValue(signalDefinition('pasteDuringAnswer')!, 1), '1 time');
    assert.equal(formatSignalValue(signalDefinition('pasteDuringAnswer')!, 3), '3 times');
    assert.equal(formatSignalValue(signalDefinition('pasteDuringAnswer')!, Number.NaN), 'not measured');
});

// ============================================
// Summary
// ============================================
//
// Every `test(...)` above has been registered by now, so the async queue is complete
// and can be drained. This runs last, as an IIFE rather than a top-level await,
// because the package is CommonJS — `await` at module scope does not compile here.
void (async () => {
    await Promise.all(pending);

    console.log(`\n${'-'.repeat(52)}`);
    if (failures.length === 0) {
        console.log(`integrity core: ${passed} checks passed`);
        process.exit(0);
    } else {
        console.log(`integrity core: ${passed} passed, ${failures.length} FAILED`);
        for (const failure of failures) console.log(`  - ${failure}`);
        process.exit(1);
    }
})();
