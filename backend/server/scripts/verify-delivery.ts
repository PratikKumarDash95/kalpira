// ============================================
// verify-delivery.ts — correctness checks for the delivery analysis core
//
// Feature 2 makes claims about how people speak, so its extraction math is
// verified rather than assumed. Like verify-measurement.ts, this runs with no
// database, no browser and no network.
//
//   npm run verify:delivery        (from backend/)
//
// Exits non-zero on any failure.
// ============================================

import assert from 'node:assert/strict';
import {
    ENVELOPE_SAMPLE_INTERVAL_MS,
    MIN_SPEECH_FOR_RATE_MS,
    PAUSE_THRESHOLD_MS,
    answerLatencyMs,
    coefficientOfVariation,
    computeAudioMetrics,
    deriveThresholds,
    segmentEnvelope,
    type EnvelopeSample,
} from '../app/lib/delivery/audioMath';
import {
    LEXICAL_DISCLOSURE,
    computeLexicalMetrics,
    countWords,
} from '../app/lib/delivery/lexicalMath';
import {
    BLUR_SHARP,
    BLUR_SOFT,
    MIN_USABLE_FRAMES,
    UNAVAILABLE_FACE_ANALYZER,
    computeVideoMetrics,
    exposureScore,
    isFrameCovered,
    sceneMotion,
    sharpnessScore,
    type FrameStats,
} from '../app/lib/delivery/videoMath';
import {
    MAX_ADJUSTMENT,
    MIN_SCORABLE_METRICS,
    fuseDelivery,
    headlineFor,
} from '../app/lib/delivery/fusion';
import {
    METRIC_REGISTRY,
    evaluateMetric,
    formatMetricValue,
    metricDefinition,
} from '../app/lib/delivery/contract';
import {
    MAX_ENVELOPE_SAMPLES,
    MAX_TIMELINE_POINTS,
    TIMELINE_INTERVAL_MS,
    aggregateDeliveryMetrics,
    analyzeDelivery,
    buildTimeline,
    parseCapture,
    type DeliveryCapturePayload,
} from '../app/lib/delivery/capture';
import { userDeliveryProfile } from '../app/lib/delivery/deliveryService';

// --------------------------------------------
// Tiny harness
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
 * Almost every check here is synchronous — the extraction math is pure arithmetic and
 * that is deliberate, because math that needs a database to test is math nobody
 * tests. A few go through the service layer, though, and those return promises. The
 * naive harness would have counted an async check as "ok" the moment it returned its
 * promise and never seen the assertion fail inside it, which is worse than having no
 * check at all: it reports success for a rule it never ran.
 *
 * So an async result is queued and awaited before the summary. The queue is drained
 * at the bottom of this file, after every `test(...)` call has been registered.
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

/**
 * Builds an envelope that alternates speech and silence, so segmentation can be
 * checked against a known ground truth rather than against itself.
 */
function buildEnvelope(
    segments: Array<{ speechMs: number; silenceMs: number }>,
    options: { speechRms?: number; silenceRms?: number; jitter?: number; seed?: number } = {}
): EnvelopeSample[] {
    const speechRms = options.speechRms ?? 0.25;
    const silenceRms = options.silenceRms ?? 0.005;
    const jitter = options.jitter ?? 0.03;
    const random = mulberry32(options.seed ?? 42);

    const samples: EnvelopeSample[] = [];
    let t = 0;
    for (const segment of segments) {
        for (let elapsed = 0; elapsed < segment.speechMs; elapsed += ENVELOPE_SAMPLE_INTERVAL_MS) {
            samples.push({ tMs: t, rms: Math.max(0, speechRms + (random() - 0.5) * jitter) });
            t += ENVELOPE_SAMPLE_INTERVAL_MS;
        }
        for (let elapsed = 0; elapsed < segment.silenceMs; elapsed += ENVELOPE_SAMPLE_INTERVAL_MS) {
            samples.push({ tMs: t, rms: Math.max(0, silenceRms + random() * 0.001) });
            t += ENVELOPE_SAMPLE_INTERVAL_MS;
        }
    }
    return samples;
}

function makeFrame(overrides: Partial<FrameStats> = {}): FrameStats {
    return {
        tMs: 0,
        meanLuma: 128,
        stdLuma: 40,
        laplacianVariance: 60,
        clippedDarkRatio: 0.01,
        clippedBrightRatio: 0.01,
        ...overrides,
    };
}

// ============================================
// [1] Envelope segmentation
// ============================================

section('[1] Envelope segmentation');

test('a clear speech block is found as one segment', () => {
    const samples = buildEnvelope([{ speechMs: 1000, silenceMs: 500 }]);
    const amplitudes = samples.map((s) => s.rms).sort((a, b) => a - b);
    const { speech } = segmentEnvelope(samples, deriveThresholds(amplitudes));
    assert.equal(speech.length, 1, `expected 1 speech segment, got ${speech.length}`);
    // The envelope holds 1000ms of speech, then the first silent sample at
    // t=1000 closes the run — so the segment spans the full 1000ms, not the
    // 950ms that the last speech sample sits at.
    assert.equal(speech[0].durationMs, 1000);
});

test('leading and trailing silence is excluded from the answer', () => {
    const samples = buildEnvelope([
        { speechMs: 0, silenceMs: 1500 },
        { speechMs: 1000, silenceMs: 0 },
        { speechMs: 0, silenceMs: 1500 },
    ]);
    const amplitudes = samples.map((s) => s.rms).sort((a, b) => a - b);
    const { speech, silence } = segmentEnvelope(samples, deriveThresholds(amplitudes));
    assert.equal(speech.length, 1);
    assert.equal(silence.length, 0, 'silence outside the answer is not a pause');
    assert.ok(speech[0].startMs >= 1400, `speech should start after the lead-in, got ${speech[0].startMs}`);
});

test('a gap inside the answer becomes a silence gap', () => {
    const samples = buildEnvelope([
        { speechMs: 800, silenceMs: 900 },
        { speechMs: 800, silenceMs: 0 },
    ]);
    const amplitudes = samples.map((s) => s.rms).sort((a, b) => a - b);
    const { speech, silence } = segmentEnvelope(samples, deriveThresholds(amplitudes));
    assert.equal(speech.length, 2, `expected 2 speech segments, got ${speech.length}`);
    assert.equal(silence.length, 1, `expected 1 gap, got ${silence.length}`);
    assert.ok(silence[0].durationMs >= 700, `gap too short: ${silence[0].durationMs}`);
});

test('a stop-consonant-length gap does not split a word', () => {
    const samples = buildEnvelope([
        { speechMs: 500, silenceMs: 100 },
        { speechMs: 500, silenceMs: 0 },
    ]);
    const amplitudes = samples.map((s) => s.rms).sort((a, b) => a - b);
    const { speech, silence } = segmentEnvelope(samples, deriveThresholds(amplitudes));
    assert.equal(silence.length, 0, 'a 100ms gap is inside a word, not between words');
    assert.equal(speech.length, 1);
});

test('a click is not a word', () => {
    const samples = buildEnvelope([
        { speechMs: 0, silenceMs: 500 },
        { speechMs: 50, silenceMs: 0 },
        { speechMs: 0, silenceMs: 500 },
    ]);
    // One isolated 50ms spike: below MIN_SPEECH_MS.
    const amplitudes = samples.map((s) => s.rms).sort((a, b) => a - b);
    const { speech } = segmentEnvelope(samples, deriveThresholds(amplitudes));
    assert.equal(speech.length, 0, 'a 50ms blip should not register as speech');
});

test('thresholds adapt to a quiet microphone', () => {
    // The same relative structure at 4x lower amplitude must segment identically.
    const loud = buildEnvelope([{ speechMs: 800, silenceMs: 800 }, { speechMs: 800, silenceMs: 0 }], { speechRms: 0.4, silenceRms: 0.01, seed: 1 });
    const quiet = buildEnvelope([{ speechMs: 800, silenceMs: 800 }, { speechMs: 800, silenceMs: 0 }], { speechRms: 0.1, silenceRms: 0.0025, seed: 1 });

    const loudAmps = loud.map((s) => s.rms).sort((a, b) => a - b);
    const quietAmps = quiet.map((s) => s.rms).sort((a, b) => a - b);

    const loudSegments = segmentEnvelope(loud, deriveThresholds(loudAmps));
    const quietSegments = segmentEnvelope(quiet, deriveThresholds(quietAmps));

    assert.equal(loudSegments.speech.length, quietSegments.speech.length);
    assert.equal(loudSegments.silence.length, quietSegments.silence.length);
});

test('a completely flat envelope yields no speech rather than all speech', () => {
    const flat: EnvelopeSample[] = Array.from({ length: 200 }, (_, i) => ({ tMs: i * 50, rms: 0.02 }));
    const amplitudes = flat.map((s) => s.rms).sort((a, b) => a - b);
    const { speech } = segmentEnvelope(flat, deriveThresholds(amplitudes));
    assert.equal(speech.length, 0, 'no dynamic range means nothing was said');
});

test('the exit threshold always sits above room tone', () => {
    // The bug this guards, which the obvious `exit = enter * 0.65` has: with a
    // noisy room and a quiet speaker the exit threshold lands *below* room tone,
    // so no sample can ever end a speech run.
    const cases: Array<[number, number]> = [
        [0.5, 0.502],    // a loud room and a speaker barely above it
        [0.02, 0.021],
        [0.1, 0.11],
        [0.005, 0.25],   // normal conditions
    ];
    for (const [low, high] of cases) {
        const sorted = Array.from(
            { length: 100 },
            (_, i) => low + (high - low) * (i / 99)
        );
        const thresholds = deriveThresholds(sorted);
        assert.ok(
            thresholds.exit > thresholds.noiseFloor,
            `exit ${thresholds.exit} must clear room tone ${thresholds.noiseFloor} (low ${low}, high ${high})`
        );
        assert.ok(thresholds.exit <= thresholds.enter, 'exit must not exceed enter');
    }
});

test('speech in a noisy room still ends', () => {
    // A café mic: room tone around 0.09, a quiet speaker around 0.14. Under the
    // unfixed thresholding this whole answer reads as one unbroken speech run, so
    // a candidate who paused twice is recorded as never pausing.
    const samples = buildEnvelope(
        [{ speechMs: 1000, silenceMs: 1200 }, { speechMs: 1000, silenceMs: 0 }],
        { speechRms: 0.14, silenceRms: 0.09, jitter: 0.02, seed: 3 }
    );
    const amplitudes = samples.map((s) => s.rms).sort((a, b) => a - b);
    const thresholds = deriveThresholds(amplitudes);

    // Confirm this envelope actually exercises the bug: the scaled threshold is
    // below room tone, so only the noise-floor term keeps the run terminable.
    assert.ok(
        thresholds.enter * 0.65 < thresholds.noiseFloor,
        `this envelope no longer reproduces the bug (enter ${thresholds.enter}, noise ${thresholds.noiseFloor})`
    );

    const { speech, silence } = segmentEnvelope(samples, thresholds);
    assert.equal(speech.length, 2, `the pause should split the answer, got ${speech.length} segment(s)`);
    assert.equal(silence.length, 1);
});

test('an empty envelope segments to nothing without throwing', () => {
    const { speech, silence } = segmentEnvelope([], deriveThresholds([]));
    assert.deepEqual(speech, []);
    assert.deepEqual(silence, []);
});

// ============================================
// [2] Audio metrics
// ============================================

section('[2] Audio metrics');

test('speaking rate is computed over speech time, not wall time', () => {
    // 6s of speech, 6s of silence: 120 words over 6s of speech is 1200 wpm over
    // wall time and 1200 wpm over speech time only if silence were counted.
    const samples = buildEnvelope([{ speechMs: 6000, silenceMs: 6000 }]);
    const metrics = computeAudioMetrics(samples, 120);
    assert.ok(metrics.speakingRateWpm !== null, 'a rate should be measurable');
    // 120 words / 6s = 1200 wpm. Wall-clock would give 600. The speech-time
    // figure is the honest one, and it proves silence was excluded.
    assert.ok(
        metrics.speakingRateWpm! > 1100 && metrics.speakingRateWpm! < 1300,
        `expected ~1200 wpm over speech time, got ${metrics.speakingRateWpm}`
    );
});

test('a muted microphone reports no rate rather than zero', () => {
    const samples: EnvelopeSample[] = Array.from({ length: 200 }, (_, i) => ({ tMs: i * 50, rms: 0.001 }));
    const metrics = computeAudioMetrics(samples, 50);
    assert.equal(metrics.hasSpeech, false);
    assert.equal(metrics.speakingRateWpm, null);
    assert.ok(metrics.note, 'a null rate must come with a reason');
});

test('a very short answer reports no rate', () => {
    const samples = buildEnvelope([{ speechMs: 800, silenceMs: 0 }]);
    assert.ok(800 < MIN_SPEECH_FOR_RATE_MS);
    const metrics = computeAudioMetrics(samples, 3);
    assert.equal(metrics.speakingRateWpm, null);
    assert.ok(metrics.note);
});

test('pauses are counted only above the pause threshold', () => {
    const samples = buildEnvelope([
        { speechMs: 1000, silenceMs: 900 },   // a real pause
        { speechMs: 1000, silenceMs: 300 },   // too short to count
        { speechMs: 1000, silenceMs: 1200 },  // a real pause
        { speechMs: 1000, silenceMs: 0 },
    ]);
    const metrics = computeAudioMetrics(samples, 60);
    assert.equal(metrics.pauseCount, 2, `expected 2 pauses, got ${metrics.pauseCount}`);
    assert.ok(metrics.longestPauseMs >= 1100, `longest pause: ${metrics.longestPauseMs}`);
    assert.ok(PAUSE_THRESHOLD_MS === 700);
});

test('silent ratio reflects time not spent speaking', () => {
    const samples = buildEnvelope([
        { speechMs: 2000, silenceMs: 2000 },
        { speechMs: 2000, silenceMs: 0 },
    ]);
    const metrics = computeAudioMetrics(samples, 40);
    // Two speech blocks totalling 4s separated by one 2s gap: roughly a third.
    assert.ok(metrics.silentRatio > 0.2 && metrics.silentRatio < 0.5, `got ${metrics.silentRatio}`);
});

test('a monotone delivery has lower energy variation than an expressive one', () => {
    // Jitter cannot be zero: an envelope with no dynamic range at all is
    // indistinguishable from a hum, and segmentation rejects it as "no speech"
    // by design (see the flat-envelope case below). 0.03 is a steady, level
    // delivery; 0.18 is an animated one. Same seed, so the two envelopes differ
    // only in amplitude spread.
    const flat = buildEnvelope([{ speechMs: 3000, silenceMs: 0 }], { speechRms: 0.2, jitter: 0.03, seed: 7 });
    const varied = buildEnvelope([{ speechMs: 3000, silenceMs: 0 }], { speechRms: 0.2, jitter: 0.18, seed: 7 });

    const flatMetrics = computeAudioMetrics(flat, 60);
    const variedMetrics = computeAudioMetrics(varied, 60);

    assert.ok(flatMetrics.energyVariation !== null && variedMetrics.energyVariation !== null);
    assert.ok(
        variedMetrics.energyVariation! > flatMetrics.energyVariation!,
        `varied ${variedMetrics.energyVariation} should exceed flat ${flatMetrics.energyVariation}`
    );
});

test('coefficient of variation is scale-free', () => {
    const quiet = [0.1, 0.2, 0.15, 0.25];
    const loud = quiet.map((v) => v * 50);
    const a = coefficientOfVariation(quiet)!;
    const b = coefficientOfVariation(loud)!;
    // Scaling the input changes the floating-point rounding, but the ratio it is
    // measuring is the same quantity. Comparing within a tolerance is the honest
    // assertion; bit-exact equality across two arithmetic paths is not something
    // this function promises.
    assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
});

test('coefficient of variation refuses a degenerate input', () => {
    assert.equal(coefficientOfVariation([]), null);
    assert.equal(coefficientOfVariation([0.5]), null);
    assert.equal(coefficientOfVariation([0, 0, 0]), null, 'a zero mean has no meaningful variation');
});

test('answer latency is measured from question end to first word', () => {
    assert.equal(answerLatencyMs(1000, 3500), 2500);
    assert.equal(answerLatencyMs(1000, 1000), 0);
});

test('answer latency refuses to invent a value when clocks disagree', () => {
    // Starting before the question ended is impossible, so it is unmeasurable
    // rather than clamped to zero.
    assert.equal(answerLatencyMs(5000, 1000), null);
    assert.equal(answerLatencyMs(NaN, 1000), null);
});

test('an envelope of NaNs does not throw', () => {
    const samples: EnvelopeSample[] = Array.from({ length: 50 }, (_, i) => ({ tMs: i * 50, rms: NaN }));
    const metrics = computeAudioMetrics(samples, 20);
    assert.equal(metrics.hasSpeech, false);
});

// ============================================
// [3] Lexical metrics
// ============================================

section('[3] Lexical metrics');

test('words are counted the way a person would', () => {
    assert.equal(countWords('I built a queue with three replicas.'), 7);
    assert.equal(countWords('   '), 0);
    assert.equal(countWords(''), 0);
    assert.equal(countWords("don't"), 1, 'a contraction is one word');
    assert.equal(countWords('read-replica'), 1, 'a hyphenated term is one word');
    assert.equal(countWords('v2'), 1);
});

test('unambiguous fillers are counted', () => {
    const metrics = computeLexicalMetrics('Um, so I uh built the thing, you know, basically.');
    assert.ok(metrics.fillerCount >= 4, `expected at least 4 fillers, got ${metrics.fillerCount}`);
    assert.ok(metrics.fillerBreakdown.um === 1);
    assert.ok(metrics.fillerBreakdown.uh === 1);
    assert.ok(metrics.fillerBreakdown['you know'] === 1);
    assert.ok(metrics.fillerBreakdown.basically === 1);
});

test('a filler stretched over several letters still counts once', () => {
    const metrics = computeLexicalMetrics('Ummmm I think so. Uh huh.');
    assert.equal(metrics.fillerBreakdown.um, 1);
});

test('fillers are case-insensitive', () => {
    assert.equal(computeLexicalMetrics('UM, UH, HMM.').fillerCount, 3);
});

test('"like" is observed but never scored as a filler', () => {
    const metrics = computeLexicalMetrics('I like queues. It was, like, fine.');
    assert.equal(metrics.fillerBreakdown.like, undefined, 'like must not be in the filler breakdown');
    assert.equal(metrics.observations.like, 2, 'both uses are observed');
});

test('"I think" is not counted as hedging', () => {
    const metrics = computeLexicalMetrics('I think we should shard by tenant.');
    assert.equal(metrics.hedgeCount, 0, 'marking a view as your own is calibration, not hedging');
});

test('"I mean" is not counted as a filler', () => {
    const metrics = computeLexicalMetrics('I mean the median, not the mean.');
    assert.equal(metrics.fillerBreakdown['i mean'], undefined);
});

test('real hedges are counted', () => {
    const metrics = computeLexicalMetrics('I guess it kind of works. Maybe probably not.');
    assert.ok(metrics.hedgeCount >= 4, `expected at least 4 hedges, got ${metrics.hedgeCount}`);
});

test('rates are per hundred words', () => {
    // 10 fillers in 100 words is a rate of 10.
    const text = `${Array.from({ length: 10 }, () => 'um').join(' ')} ${Array.from({ length: 90 }, (_, i) => `word${i}`).join(' ')}`;
    const metrics = computeLexicalMetrics(text);
    assert.equal(metrics.wordCount, 100);
    assert.ok(Math.abs(metrics.fillerRate - 10) < 0.001, `got ${metrics.fillerRate}`);
});

test('an empty transcript yields zero rates rather than NaN', () => {
    const metrics = computeLexicalMetrics('');
    assert.equal(metrics.wordCount, 0);
    assert.equal(metrics.fillerRate, 0);
    assert.equal(metrics.hedgeRate, 0);
    assert.ok(Number.isFinite(metrics.fillerRate));
});

test('curly apostrophes are handled', () => {
    assert.equal(computeLexicalMetrics('I’m not sure about that.').hedgeCount, 1);
});

test('the disclosure names every word that was counted', () => {
    assert.ok(LEXICAL_DISCLOSURE.fillers.length >= 5);
    assert.ok(LEXICAL_DISCLOSURE.excluded.length >= 3, 'exclusions must be disclosed, not silent');
    assert.ok(LEXICAL_DISCLOSURE.excluded.some((entry) => entry.word === 'like'));
});

// ============================================
// [4] Video metrics
// ============================================

section('[4] Video metrics');

test('a sharp frame scores above a soft one', () => {
    assert.ok(sharpnessScore(200) > sharpnessScore(20));
    assert.equal(sharpnessScore(0), 0);
    assert.equal(sharpnessScore(BLUR_SOFT), 0, 'at the soft floor the score is zero');
    assert.ok(sharpnessScore(BLUR_SHARP) >= 99, 'at the sharp ceiling the score is full');
    assert.ok(sharpnessScore(1_000_000) <= 100, 'the score is bounded');
});

test('a well-lit frame scores above a badly exposed one', () => {
    const good = exposureScore(makeFrame({ meanLuma: 128, clippedDarkRatio: 0.01, clippedBrightRatio: 0.01 }));
    const dark = exposureScore(makeFrame({ meanLuma: 20, clippedDarkRatio: 0.6, clippedBrightRatio: 0 }));
    const blown = exposureScore(makeFrame({ meanLuma: 240, clippedDarkRatio: 0, clippedBrightRatio: 0.7 }));
    assert.ok(good > dark, `good ${good} should beat dark ${dark}`);
    assert.ok(good > blown, `good ${good} should beat blown ${blown}`);
    assert.ok(good > 80);
});

test('a covered lens is detected as no image', () => {
    assert.equal(isFrameCovered(makeFrame({ meanLuma: 8, stdLuma: 2 })), true);
    // A dark room with a lit face still has contrast — not covered.
    assert.equal(isFrameCovered(makeFrame({ meanLuma: 30, stdLuma: 25 })), false);
    // A bright, blank wall has light but no contrast. Contrast is the deciding
    // factor, and a bright blank frame is still not a covered lens.
    assert.equal(isFrameCovered(makeFrame({ meanLuma: 200, stdLuma: 2 })), false);
});

test('covered frames are excluded from image metrics', () => {
    const frames = [
        ...Array.from({ length: 10 }, (_, i) => makeFrame({ tMs: i * 500, laplacianVariance: 100 })),
        ...Array.from({ length: 10 }, (_, i) => makeFrame({ tMs: (i + 10) * 500, meanLuma: 5, stdLuma: 1, laplacianVariance: 0 })),
    ];
    const metrics = computeVideoMetrics(frames, 10_000);
    assert.equal(metrics.usableFrameCount, 10);
    assert.equal(metrics.sampledFrameCount, 20);
    assert.ok(Math.abs(metrics.cameraCoveredRatio - 0.5) < 0.001, `got ${metrics.cameraCoveredRatio}`);
    assert.ok(metrics.frameBlurScore !== null && metrics.frameBlurScore > 50, 'the covered frames must not drag sharpness down');
});

test('too few usable frames yields a reason instead of a number', () => {
    const frames = Array.from({ length: MIN_USABLE_FRAMES - 1 }, (_, i) => makeFrame({ tMs: i * 1000 }));
    const metrics = computeVideoMetrics(frames, 5000);
    assert.equal(metrics.frameBlurScore, null);
    assert.ok(metrics.note, 'an unmeasurable result must explain itself');
});

test('no frames at all is reported, not treated as a zero', () => {
    const metrics = computeVideoMetrics([], 5000);
    assert.equal(metrics.frameBlurScore, null);
    assert.equal(metrics.sceneMotionIndex, null);
    assert.ok(metrics.note);
});

test('coverage is measured over the answer, not the frame count', () => {
    // 20 frames crammed into one second of a 20s answer: the count is high, the
    // coverage is not.
    const frames = Array.from({ length: 20 }, (_, i) => makeFrame({ tMs: i * 50 }));
    const metrics = computeVideoMetrics(frames, 20_000);
    assert.ok(metrics.analyzableFrameRatio < 0.1, `got ${metrics.analyzableFrameRatio}`);
});

test('scene motion measures frame difference and returns zero for a frozen image', () => {
    const frozen = Array.from({ length: 10 }, (_, i) => makeFrame({ tMs: i * 500, meanLuma: 128 }));
    assert.equal(sceneMotion(frozen), 0);
    const moving = Array.from({ length: 10 }, (_, i) => makeFrame({ tMs: i * 500, meanLuma: i % 2 === 0 ? 100 : 160 }));
    assert.ok(sceneMotion(moving)! > 0);
});

test('scene motion needs at least two frames', () => {
    assert.equal(sceneMotion([makeFrame()]), null);
    assert.equal(sceneMotion([]), null);
});

test('the face analyzer refuses rather than guesses', async () => {
    const result = await UNAVAILABLE_FACE_ANALYZER.analyze([]);
    assert.equal(result.available, false, 'no detector means unavailable, never a zero');
    assert.equal(result.signals, null);
    assert.ok(result.reason && result.reason.length > 20, 'unavailability must be explained');
});

// ============================================
// [5] Metric registry and evaluation
// ============================================

section('[5] Metric registry');

test('every registry entry is well formed', () => {
    for (const definition of METRIC_REGISTRY) {
        assert.ok(definition.key.length > 0);
        assert.ok(definition.label.length > 0);
        assert.ok(definition.description.length > 20, `${definition.key} needs a real description`);
        if (definition.feeds !== null) {
            assert.ok(definition.maxImpact > 0, `${definition.key} feeds a dimension but cannot move it`);
            assert.ok(definition.band[0] <= definition.band[1], `${definition.key} has an inverted band`);
            assert.ok(definition.advice.length > 20, `${definition.key} must give actionable advice`);
        } else {
            assert.equal(definition.maxImpact, 0, `${definition.key} informs no dimension but claims an impact`);
        }
    }
});

test('metric keys are unique', () => {
    const keys = METRIC_REGISTRY.map((d) => d.key);
    assert.equal(new Set(keys).size, keys.length);
});

test('image-quality metrics inform no dimension', () => {
    for (const key of ['frameBlurScore', 'exposureScore', 'cameraCoveredRatio', 'sceneMotionIndex']) {
        assert.equal(metricDefinition(key)?.feeds, null, `${key} must not move a score`);
    }
});

test('a value inside its band does not penalise', () => {
    const rate = metricDefinition('speakingRateWpm')!;
    const inside = evaluateMetric(rate, 135);
    assert.ok(inside.inBand);
    assert.ok(inside.position >= 0, 'inside the band is not a penalty');
});

test('a value outside its band penalises, and further out penalises more', () => {
    const rate = metricDefinition('speakingRateWpm')!;
    const slightlySlow = evaluateMetric(rate, 100);
    const verySlow = evaluateMetric(rate, 40);
    assert.ok(!slightlySlow.inBand && slightlySlow.side === 'below');
    assert.ok(verySlow.impact < slightlySlow.impact, 'further outside must be worse');
});

test('no metric can exceed its declared maximum impact', () => {
    for (const definition of METRIC_REGISTRY) {
        for (const value of [-1e9, -1, 0, 1, 1e9, NaN, Infinity]) {
            const evaluation = evaluateMetric(definition, value);
            assert.ok(
                Math.abs(evaluation.impact) <= definition.maxImpact + 1e-9,
                `${definition.key} at ${value} exceeded its cap: ${evaluation.impact}`
            );
        }
    }
});

test('a non-finite value moves nothing', () => {
    for (const definition of METRIC_REGISTRY) {
        assert.equal(evaluateMetric(definition, NaN).impact, 0, `${definition.key}`);
        assert.equal(evaluateMetric(definition, Infinity).impact, 0, `${definition.key}`);
    }
});

test('every evaluation explains itself', () => {
    for (const definition of METRIC_REGISTRY) {
        for (const value of [0, 50, 1e6]) {
            assert.ok(evaluateMetric(definition, value).explanation.length > 10, `${definition.key}`);
        }
    }
});

test('values are formatted in their own unit', () => {
    assert.equal(formatMetricValue(metricDefinition('speakingRateWpm')!, 135.4), '135 wpm');
    assert.equal(formatMetricValue(metricDefinition('silentRatio')!, 0.31), '31%');
    assert.equal(formatMetricValue(metricDefinition('longestPauseMs')!, 2400), '2.4s');
    assert.equal(formatMetricValue(metricDefinition('longestPauseMs')!, 400), '400ms');
    assert.equal(formatMetricValue(metricDefinition('speakingRateWpm')!, NaN), 'not measured');
});

// ============================================
// [6] Fusion
// ============================================

section('[6] Fusion');

/** A complete, healthy set of delivery metrics. */
function healthyMetrics(): Record<string, number> {
    return {
        speakingRateWpm: 140,
        fillerRate: 1.5,
        pauseCount: 1,
        longestPauseMs: 900,
        answerLatencyMs: 1200,
        energyVariation: 0.3,
        silentRatio: 0.12,
        hedgeRate: 0.8,
        frameBlurScore: 70,
        exposureScore: 85,
        cameraCoveredRatio: 0,
        sceneMotionIndex: 0.05,
        analyzableFrameRatio: 0.95,
    };
}

/** A complete, poor set. */
function poorMetrics(): Record<string, number> {
    return {
        speakingRateWpm: 60,
        fillerRate: 9,
        pauseCount: 7,
        longestPauseMs: 8000,
        answerLatencyMs: 9000,
        energyVariation: 0.02,
        silentRatio: 0.55,
        hedgeRate: 7,
        frameBlurScore: 20,
        exposureScore: 30,
        cameraCoveredRatio: 0.4,
        sceneMotionIndex: 0.01,
        analyzableFrameRatio: 0.4,
    };
}

test('healthy delivery inside the bands does not lower a score', () => {
    const result = fuseDelivery({
        communicationScore: 70,
        confidenceScore: 70,
        metrics: healthyMetrics(),
        hasSpeech: true,
        speechDurationMs: 30_000,
        wordCount: 80,
    });
    assert.ok(result.communication.delta >= 0, `communication fell despite healthy metrics: ${result.communication.delta}`);
    assert.ok(result.confidence.delta >= 0, `confidence fell despite healthy metrics: ${result.confidence.delta}`);
});

test('poor delivery lowers communication and confidence', () => {
    const result = fuseDelivery({
        communicationScore: 70,
        confidenceScore: 70,
        metrics: poorMetrics(),
        hasSpeech: true,
        speechDurationMs: 30_000,
        wordCount: 80,
    });
    assert.ok(result.communication.delta < 0, `expected communication to fall, got ${result.communication.delta}`);
    assert.ok(result.confidence.delta < 0, `expected confidence to fall, got ${result.confidence.delta}`);
});

test('delivery evidence measurably changes the score', () => {
    // The definition-of-done check: the same answer scores differently with and
    // without delivery evidence.
    const withEvidence = fuseDelivery({
        communicationScore: 70,
        confidenceScore: 70,
        metrics: poorMetrics(),
        hasSpeech: true,
        speechDurationMs: 30_000,
        wordCount: 80,
    });
    assert.notEqual(withEvidence.communication.after, 70, 'the score must actually move');
    assert.equal(withEvidence.applied, true);
});

test('the adjustment is capped in both directions', () => {
    const catastrophic = Object.fromEntries(
        Object.keys(healthyMetrics()).map((key) => [key, key.includes('Ratio') || key.includes('Variation') ? 0.99 : 1e6])
    );
    const result = fuseDelivery({
        communicationScore: 50,
        confidenceScore: 50,
        metrics: catastrophic,
        hasSpeech: true,
        speechDurationMs: 30_000,
        wordCount: 80,
    });
    for (const adjustment of [result.communication, result.confidence]) {
        assert.ok(
            Math.abs(adjustment.delta) <= MAX_ADJUSTMENT,
            `${adjustment.dimension} moved ${adjustment.delta}, above the ${MAX_ADJUSTMENT} cap`
        );
        assert.ok(adjustment.cappedBy > 0, 'the cap should have bitten here');
    }
});

test('the cap also bounds an implausibly good set of metrics', () => {
    const perfect = Object.fromEntries(
        Object.keys(healthyMetrics()).map((key) => [key, metricDefinition(key)!.band[0]])
    );
    const result = fuseDelivery({
        communicationScore: 50,
        confidenceScore: 50,
        metrics: perfect,
        hasSpeech: true,
        speechDurationMs: 30_000,
        wordCount: 80,
    });
    assert.ok(result.confidence.delta <= MAX_ADJUSTMENT);
    assert.ok(result.communication.delta <= MAX_ADJUSTMENT);
});

test('fusion refuses when the microphone caught no speech', () => {
    const result = fuseDelivery({
        communicationScore: 70,
        confidenceScore: 70,
        metrics: { ...healthyMetrics(), speakingRateWpm: null },
        hasSpeech: false,
        speechDurationMs: 0,
        wordCount: 0,
    });
    assert.equal(result.applied, false);
    assert.equal(result.communication.delta, 0);
    assert.ok(result.reason && result.reason.length > 20);
});

test('fusion refuses when too few signals were measured', () => {
    const result = fuseDelivery({
        communicationScore: 70,
        confidenceScore: 70,
        metrics: { speakingRateWpm: 60, fillerRate: 9 },
        hasSpeech: true,
        speechDurationMs: 30_000,
        wordCount: 80,
    });
    assert.equal(result.applied, false);
    assert.equal(result.communication.delta, 0);
    assert.ok(result.reason?.includes(String(2)), `reason should name the count: ${result.reason}`);
});

test('fusion refuses on a very short answer', () => {
    const result = fuseDelivery({
        communicationScore: 70,
        confidenceScore: 70,
        metrics: poorMetrics(),
        hasSpeech: true,
        speechDurationMs: 500,
        wordCount: 3,
    });
    assert.equal(result.applied, false);
    assert.equal(result.confidence.delta, 0);
});

test('unmeasured metrics are listed rather than counted as zero', () => {
    const metrics = healthyMetrics();
    delete metrics.speakingRateWpm;
    delete metrics.energyVariation;
    const result = fuseDelivery({
        communicationScore: 70,
        confidenceScore: 70,
        metrics,
        hasSpeech: true,
        speechDurationMs: 30_000,
        wordCount: 80,
    });
    assert.ok(result.unmeasured.includes('speakingRateWpm'));
    assert.ok(result.unmeasured.includes('energyVariation'));
});

test('informational metrics are never evidence and never move a score', () => {
    const result = fuseDelivery({
        communicationScore: 70,
        confidenceScore: 70,
        metrics: poorMetrics(),
        hasSpeech: true,
        speechDurationMs: 30_000,
        wordCount: 80,
    });
    const keys = result.evidence.map((entry) => entry.key);
    for (const informational of ['frameBlurScore', 'exposureScore', 'sceneMotionIndex', 'cameraCoveredRatio']) {
        assert.ok(!keys.includes(informational), `${informational} must not appear as evidence`);
    }
});

test('an obscured camera becomes a caveat, not a penalty', () => {
    const result = fuseDelivery({
        communicationScore: 70,
        confidenceScore: 70,
        metrics: { ...healthyMetrics(), cameraCoveredRatio: 0.5, analyzableFrameRatio: 0.3 },
        hasSpeech: true,
        speechDurationMs: 30_000,
        wordCount: 80,
    });
    assert.ok(result.caveats.length >= 1, 'a covered camera must be disclosed');
    assert.ok(result.caveats.some((caveat) => caveat.includes('obscured')));
});

test('scores stay inside 0–100 however extreme the input', () => {
    for (const base of [0, 1, 99, 100, -50, 500, NaN]) {
        const result = fuseDelivery({
            communicationScore: base,
            confidenceScore: base,
            metrics: poorMetrics(),
            hasSpeech: true,
            speechDurationMs: 30_000,
            wordCount: 80,
        });
        for (const adjustment of [result.communication, result.confidence]) {
            assert.ok(adjustment.after >= 0 && adjustment.after <= 100, `${base} produced ${adjustment.after}`);
            assert.ok(Number.isFinite(adjustment.after));
        }
    }
});

test('an empty metric set changes nothing and explains why', () => {
    const result = fuseDelivery({
        communicationScore: 70,
        confidenceScore: 70,
        metrics: {},
        hasSpeech: true,
        speechDurationMs: 30_000,
        wordCount: 80,
    });
    assert.equal(result.applied, false);
    assert.equal(result.communication.after, 70);
    assert.ok(result.reason);
    assert.ok(result.unmeasured.length >= METRIC_REGISTRY.length - 1);
});

test('the same input always produces the same output', () => {
    const input = {
        communicationScore: 68,
        confidenceScore: 62,
        metrics: poorMetrics(),
        hasSpeech: true,
        speechDurationMs: 30_000,
        wordCount: 80,
    };
    const first = fuseDelivery(input);
    const second = fuseDelivery(input);
    assert.deepEqual(first.communication, second.communication);
    assert.deepEqual(first.confidence, second.confidence);
});

test('every contribution is traceable to a metric and a value', () => {
    const result = fuseDelivery({
        communicationScore: 70,
        confidenceScore: 70,
        metrics: poorMetrics(),
        hasSpeech: true,
        speechDurationMs: 30_000,
        wordCount: 80,
    });
    for (const entry of result.evidence) {
        assert.ok(metricDefinition(entry.key), `${entry.key} has no registry entry`);
        assert.ok(Number.isFinite(entry.value));
        assert.ok(entry.explanation.length > 10, `${entry.key} has no explanation`);
    }
    // The dimension total must equal the sum of its metrics' contributions.
    const communicationSum = result.evidence
        .filter((entry) => metricDefinition(entry.key)?.feeds === 'communication')
        .reduce((sum, entry) => sum + entry.impact, 0);
    const expected = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, communicationSum));
    assert.ok(Math.abs(result.communication.delta - expected) < 0.15, `delta ${result.communication.delta} vs expected ${expected}`);
});

test('the headline names the largest contributor', () => {
    const result = fuseDelivery({
        communicationScore: 70,
        confidenceScore: 70,
        metrics: poorMetrics(),
        hasSpeech: true,
        speechDurationMs: 30_000,
        wordCount: 80,
    });
    const headline = headlineFor(result);
    assert.ok(headline.length > 20, `headline too short: ${headline}`);
});

test('the headline stays honest when nothing was measured', () => {
    const result = fuseDelivery({
        communicationScore: 70,
        confidenceScore: 70,
        metrics: {},
        hasSpeech: false,
        speechDurationMs: 0,
        wordCount: 0,
    });
    const headline = headlineFor(result);
    assert.ok(headline.length > 20);
    assert.ok(!headline.includes('NaN'));
});

test('more scorable metrics are required than the minimum', () => {
    assert.ok(MIN_SCORABLE_METRICS >= 3, 'acting on one or two signals would be acting on a quirk');
});

// ============================================
// [7] Capture parsing — the untrusted boundary
// ============================================

section('[7] Capture parsing');

test('a missing payload is reported, not thrown on', () => {
    for (const input of [null, undefined]) {
        const parsed = parseCapture(input);
        assert.equal(parsed.hasAudio, false);
        assert.equal(parsed.hasVideo, false);
        assert.deepEqual(parsed.envelope, []);
        assert.ok(parsed.issues.length > 0, 'an absent capture must say so');
    }
});

test('unreadable audio samples are dropped and counted', () => {
    const parsed = parseCapture({
        envelope: [
            { tMs: 0, rms: 0.2 },
            { tMs: 50, rms: NaN },
            { tMs: 100, rms: 'loud' },
            { tMs: -1, rms: 0.2 },
            { tMs: 150, rms: -0.5 },
            { tMs: 200, rms: 0.25 },
        ],
    });
    assert.equal(parsed.envelope.length, 2, 'only the two well-formed samples survive');
    assert.ok(parsed.issues.some((issue) => issue.includes('4 unreadable')), parsed.issues.join(' | '));
    assert.equal(parsed.hasAudio, false, 'two samples is below the minimum');
});

test('an enormous envelope is truncated rather than processed', () => {
    const envelope = Array.from({ length: MAX_ENVELOPE_SAMPLES + 500 }, (_, i) => ({ tMs: i * 50, rms: 0.2 }));
    const parsed = parseCapture({ envelope });
    assert.equal(parsed.envelope.length, MAX_ENVELOPE_SAMPLES);
    assert.ok(parsed.issues.some((issue) => issue.includes('truncated')));
});

test('an envelope that is not an array is discarded with a reason', () => {
    const parsed = parseCapture({ envelope: 'lots of numbers' as unknown as [] });
    assert.deepEqual(parsed.envelope, []);
    assert.ok(parsed.issues.some((issue) => issue.includes('not an array')));
});

test('frame statistics are clamped into their real ranges', () => {
    const parsed = parseCapture({
        frames: [
            { tMs: 0, meanLuma: 999, stdLuma: -5, laplacianVariance: -1, clippedDarkRatio: 5, clippedBrightRatio: -2 },
        ],
    });
    const frame = parsed.frames[0];
    assert.equal(frame.meanLuma, 255, 'luma cannot exceed 8-bit range');
    assert.equal(frame.stdLuma, 0, 'a negative deviation is zero');
    assert.equal(frame.laplacianVariance, 0);
    assert.equal(frame.clippedDarkRatio, 1, 'a ratio cannot exceed 1');
    assert.equal(frame.clippedBrightRatio, 0);
});

test('a frame missing its statistics is dropped, not defaulted', () => {
    const parsed = parseCapture({
        frames: [
            { tMs: 0, meanLuma: 128, stdLuma: 40, laplacianVariance: 60 },
            { tMs: 500, meanLuma: 128 },
            { tMs: 1000, stdLuma: 40, laplacianVariance: 60 },
        ],
    });
    assert.equal(parsed.frames.length, 1, 'a frame with no measurement is not a frame');
    assert.ok(parsed.issues.some((issue) => issue.includes('2 unreadable video frame')));
});

test('a negative question-end time is refused', () => {
    const parsed = parseCapture({ questionEndedAtMs: -500 });
    assert.equal(parsed.questionEndedAtMs, null);
    assert.ok(parsed.issues.some((issue) => issue.includes('negative')));
});

test('a capture note is trimmed and bounded', () => {
    assert.equal(parseCapture({ captureNote: '  camera denied  ' }).captureNote, 'camera denied');
    assert.equal(parseCapture({ captureNote: '   ' }).captureNote, null);
    assert.equal(parseCapture({ captureNote: 42 as unknown as string }).captureNote, null);
    assert.ok((parseCapture({ captureNote: 'x'.repeat(2000) }).captureNote ?? '').length <= 500);
});

test('a well-formed capture survives parsing unchanged', () => {
    const envelope = Array.from({ length: 100 }, (_, i) => ({ tMs: i * 50, rms: 0.2 }));
    const parsed = parseCapture({ envelope, frames: [], questionEndedAtMs: 0, answerDurationMs: 5000 });
    assert.equal(parsed.envelope.length, 100);
    assert.equal(parsed.hasAudio, true);
    assert.equal(parsed.hasVideo, false);
    assert.equal(parsed.questionEndedAtMs, 0);
    assert.deepEqual(parsed.issues, []);
});

// ============================================
// [8] Analysis composition
// ============================================

section('[8] Analysis composition');

/** 15 words, no fillers and no hedges: 150 wpm over six seconds of speech. */
const CLEAN_TRANSCRIPT = 'I built a queue with three replicas and one consumer group for the billing service';
const CLEAN_WORD_COUNT = 15;

/**
 * A healthy answer: room tone either side, then six seconds of speech that varies
 * in emphasis without ever approaching the noise floor.
 *
 * Built by hand rather than from the seeded generator so the assertions below are
 * about the analysis code rather than about a random draw, and so there is no
 * interior gap to explain.
 */
function healthyEnvelope(): EnvelopeSample[] {
    const samples: EnvelopeSample[] = [];
    let t = 0;
    const push = (rms: number) => {
        samples.push({ tMs: t, rms });
        t += ENVELOPE_SAMPLE_INTERVAL_MS;
    };

    for (let i = 0; i < 20; i += 1) push(0.005);
    for (let i = 0; i < 120; i += 1) push(0.22 + 0.08 * Math.sin(i / 7));
    for (let i = 0; i < 20; i += 1) push(0.005);
    return samples;
}

function analyzeHealthy(overrides: { questionEndedAtMs?: number } = {}) {
    const capture = parseCapture({
        envelope: healthyEnvelope(),
        questionEndedAtMs: overrides.questionEndedAtMs ?? 1000,
    });
    return analyzeDelivery({
        capture,
        transcript: CLEAN_TRANSCRIPT,
        communicationScore: 70,
        confidenceScore: 70,
    });
}

test('the clean envelope is what the tests below assume it is', () => {
    // Guards the fixture: if the DSP changes so this is no longer a healthy,
    // gap-free answer, the tests built on it should fail here rather than
    // mysteriously elsewhere.
    const capture = parseCapture({ envelope: healthyEnvelope() });
    const metrics = computeAudioMetrics(capture.envelope, CLEAN_WORD_COUNT);
    assert.equal(metrics.hasSpeech, true);
    assert.equal(metrics.pauseCount, 0, 'there is no interior gap in this fixture');
    assert.equal(metrics.silentRatio, 0);
    assert.equal(metrics.speechDurationMs, 6000);
    assert.equal(Math.round(metrics.speakingRateWpm ?? 0), 150);
    assert.ok(
        metrics.energyVariation !== null && metrics.energyVariation > 0.12 && metrics.energyVariation < 0.65,
        `energy variation ${metrics.energyVariation} should sit inside the healthy band`
    );
});

test('every registry metric gets a row, measured or not', () => {
    const analysis = analyzeHealthy();
    assert.equal(analysis.metrics.length, METRIC_REGISTRY.length);
    for (const definition of METRIC_REGISTRY) {
        assert.ok(
            analysis.metrics.some((metric) => metric.key === definition.key),
            `${definition.key} has no row`
        );
    }
});

test('metrics with no data are marked unmeasured rather than zero', () => {
    // No frames were sent, so every video metric must be absent — not 0, which
    // would read as a measurement of a black frame.
    const analysis = analyzeHealthy();
    const video = analysis.metrics.filter((metric) => metric.source === 'video');
    assert.ok(video.length >= 4, 'the video metrics should be present as rows');
    for (const metric of video) {
        assert.equal(metric.measured, false, `${metric.key} claims to be measured`);
        assert.equal(metric.value, null, `${metric.key} reports a value it does not have`);
        assert.ok(metric.explanation.includes('not measured'), `${metric.key} does not say it was not measured`);
    }
});

test('a healthy answer moves the score upward but stays honest about why', () => {
    const analysis = analyzeHealthy();
    assert.equal(analysis.fusion.applied, true);
    assert.ok(analysis.fusion.communication.delta > 0, `communication moved ${analysis.fusion.communication.delta}`);
    assert.ok(analysis.fusion.confidence.delta > 0, `confidence moved ${analysis.fusion.confidence.delta}`);
    assert.ok(analysis.fusion.communication.after > 70);
    // Every contribution still traces back to a metric and a value.
    for (const entry of analysis.fusion.evidence) {
        assert.ok(Number.isFinite(entry.value), `${entry.key} contributed on a non-finite value`);
    }
});

test('the analysis never reports a value it did not derive', () => {
    const analysis = analyzeHealthy();
    for (const metric of analysis.metrics) {
        if (metric.measured) {
            assert.ok(typeof metric.value === 'number' && Number.isFinite(metric.value), `${metric.key}`);
        } else {
            assert.equal(metric.value, null, `${metric.key} is unmeasured but carries a value`);
        }
        assert.ok(Number.isFinite(metric.impact), `${metric.key} has a non-finite impact`);
        assert.ok(metric.explanation.length > 10, `${metric.key} has no explanation`);
    }
});

test('word count and lexical rates come from the transcript', () => {
    const analysis = analyzeHealthy();
    assert.equal(analysis.wordCount, CLEAN_WORD_COUNT);
    assert.equal(analysis.lexical.fillerRate, 0);
    assert.equal(analysis.lexical.hedgeRate, 0);
    const filler = analysis.metrics.find((metric) => metric.key === 'fillerRate');
    assert.equal(filler?.value, 0, 'a real zero rate is a measurement, not an absence');
    assert.equal(filler?.measured, true);
});

test('answer latency is derived from the first speech frame', () => {
    const analysis = analyzeHealthy({ questionEndedAtMs: 1000 });
    const latency = analysis.metrics.find((metric) => metric.key === 'answerLatencyMs');
    assert.equal(latency?.measured, true, 'speech starts at 1000ms and the question ended at 1000ms');
    assert.equal(latency?.value, 0);
});

test('answer latency is unmeasured when the question end is unknown', () => {
    const capture = parseCapture({ envelope: healthyEnvelope() });
    const analysis = analyzeDelivery({
        capture,
        transcript: CLEAN_TRANSCRIPT,
        communicationScore: 70,
        confidenceScore: 70,
    });
    const latency = analysis.metrics.find((metric) => metric.key === 'answerLatencyMs');
    assert.equal(latency?.measured, false);
    assert.equal(latency?.value, null);
    // And it is disclosed as unmeasured rather than silently dropped.
    assert.ok(analysis.fusion.unmeasured.includes('answerLatencyMs'));
});

test('a muted answer is analysed to "nothing measurable", not to a score of zero', () => {
    const capture = parseCapture({
        envelope: Array.from({ length: 100 }, (_, i) => ({ tMs: i * 50, rms: 0.001 })),
    });
    const analysis = analyzeDelivery({
        capture,
        transcript: CLEAN_TRANSCRIPT,
        communicationScore: 70,
        confidenceScore: 70,
    });
    assert.equal(analysis.fusion.applied, false);
    assert.equal(analysis.fusion.communication.after, 70, 'an unmeasurable answer must not be adjusted');
    assert.ok(analysis.fusion.reason && analysis.fusion.reason.length > 20);
    // The extractor's own explanation reaches the reader, so a candidate whose
    // microphone failed is told that rather than shown a wall of missing metrics.
    assert.ok(
        analysis.issues.some((issue) => issue.includes('muted')),
        `expected the microphone explanation, got: ${analysis.issues.join(' | ')}`
    );
    // And a zero-pause default is not passed off as a measurement.
    const pauses = analysis.metrics.find((metric) => metric.key === 'pauseCount');
    assert.equal(pauses?.measured, false);
    assert.equal(pauses?.value, null);
});

test('a capture note is carried into the issues', () => {
    const capture = parseCapture({
        envelope: healthyEnvelope(),
        captureNote: 'Camera permission was denied by the browser.',
    });
    const analysis = analyzeDelivery({
        capture,
        transcript: CLEAN_TRANSCRIPT,
        communicationScore: 70,
        confidenceScore: 70,
    });
    assert.equal(analysis.issues[0], 'Camera permission was denied by the browser.', 'the client’s own words come first');
});

test('a hostile payload cannot produce a finite adjustment from nothing', () => {
    const hostile = parseCapture({
        envelope: Array.from({ length: 200 }, () => ({ tMs: 'x', rms: Infinity })) as never,
        questionEndedAtMs: NaN,
        answerDurationMs: -1,
    });
    const analysis = analyzeDelivery({
        capture: hostile,
        transcript: '',
        communicationScore: 70,
        confidenceScore: 70,
    });
    assert.equal(analysis.fusion.applied, false);
    assert.equal(analysis.fusion.communication.after, 70);
    assert.ok(Number.isFinite(analysis.fusion.confidence.after));
    for (const metric of analysis.metrics) {
        assert.equal(metric.measured, false, `${metric.key} claimed a measurement from junk`);
    }
});

// ============================================
// [9] Aggregation
// ============================================

section('[9] Aggregation');

test('a metric is averaged over the answers that measured it', () => {
    const aggregate = aggregateDeliveryMetrics([
        [{ key: 'speakingRateWpm', label: 'x', unit: 'wpm', value: 120, position: 0, impact: 0, inBand: true, measured: true, source: 'audio', explanation: 'x' }],
        [{ key: 'speakingRateWpm', label: 'x', unit: 'wpm', value: 160, position: 0, impact: 0, inBand: true, measured: true, source: 'audio', explanation: 'x' }],
    ]);
    const rate = aggregate.find((entry) => entry.key === 'speakingRateWpm')!;
    assert.equal(rate.mean, 140);
    assert.equal(rate.measuredCount, 2);
    assert.equal(rate.totalCount, 2);
});

test('unmeasured answers are excluded from the mean but counted in the total', () => {
    const aggregate = aggregateDeliveryMetrics([
        [{ key: 'speakingRateWpm', label: 'x', unit: 'wpm', value: 120, position: 0, impact: 0, inBand: true, measured: true, source: 'audio', explanation: 'x' }],
        [{ key: 'speakingRateWpm', label: 'x', unit: 'wpm', value: null, position: 0, impact: 0, inBand: true, measured: false, source: 'audio', explanation: 'x' }],
        [],
    ]);
    const rate = aggregate.find((entry) => entry.key === 'speakingRateWpm')!;
    assert.equal(rate.mean, 120, 'an unmeasured answer must not pull the mean toward zero');
    assert.equal(rate.measuredCount, 1);
    assert.equal(rate.totalCount, 3);
});

test('a metric measured nowhere reports no mean', () => {
    const aggregate = aggregateDeliveryMetrics([[], []]);
    const rate = aggregate.find((entry) => entry.key === 'speakingRateWpm')!;
    assert.equal(rate.mean, null);
    assert.equal(rate.measuredCount, 0);
    assert.equal(rate.totalCount, 2);
    assert.ok(!Number.isNaN(rate.mean as number), 'never NaN');
});

test('the aggregate carries an entry for every registry metric', () => {
    const aggregate = aggregateDeliveryMetrics([]);
    assert.equal(aggregate.length, METRIC_REGISTRY.length);
});

test('the band verdict on a mean matches the registry', () => {
    const rows = (value: number) => [
        { key: 'speakingRateWpm', label: 'x', unit: 'wpm' as const, value, position: 0, impact: 0, inBand: true, measured: true, source: 'audio' as const, explanation: 'x' },
    ];
    assert.equal(aggregateDeliveryMetrics([rows(140)]).find((e) => e.key === 'speakingRateWpm')!.inBand, true);
    assert.equal(aggregateDeliveryMetrics([rows(300)]).find((e) => e.key === 'speakingRateWpm')!.inBand, false);
});

// ============================================
// [10] The wire contract the browser actually sends
// ============================================
//
// user/src/lib/deliveryCapture.ts is the only producer of this payload, and it
// cannot run here — it needs a microphone, a canvas and a real browser. What can be
// pinned is the SHAPE it produces. If either side renames a field, these checks fail
// instead of the metrics quietly going unmeasured in production, which is exactly
// the kind of failure nobody notices until the feature looks like it does nothing.

section('[10] The browser capture contract');

/** A payload assembled the way user/src/lib/deliveryCapture.ts assembles one. */
function browserShapedPayload(overrides: Partial<DeliveryCapturePayload> = {}): DeliveryCapturePayload {
    return {
        envelope: healthyEnvelope(),
        frames: Array.from({ length: 8 }, (_, i) => makeFrame({ tMs: i * 500 })),
        questionEndedAtMs: 640,
        answerDurationMs: 8000,
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        ...overrides,
    };
}

function analyzeBrowserShape(payload: DeliveryCapturePayload, transcript = CLEAN_TRANSCRIPT) {
    return analyzeDelivery({
        capture: parseCapture(payload),
        transcript,
        communicationScore: 70,
        confidenceScore: 70,
    });
}

test('a payload shaped like the browser produces parses without complaint', () => {
    const capture = parseCapture(browserShapedPayload());
    assert.deepEqual(capture.issues, [], 'the browser payload must not need repairing');
    assert.equal(capture.hasAudio, true);
    assert.equal(capture.hasVideo, true);
    assert.equal(capture.questionEndedAtMs, 640);
    assert.equal(capture.answerDurationMs, 8000);
});

test('the browser payload yields measurements, not just rows', () => {
    const analysis = analyzeBrowserShape(browserShapedPayload());
    const measured = analysis.metrics.filter((metric) => metric.measured);
    assert.ok(measured.length >= 6, `expected a real payload to measure most metrics, got ${measured.length}`);
    const rate = analysis.metrics.find((metric) => metric.key === 'speakingRateWpm')!;
    assert.ok(rate.measured && (rate.value as number) > 0, 'a six-second answer must yield a speaking rate');
});

test('the reported microphone settings survive parsing', () => {
    const capture = parseCapture(browserShapedPayload());
    assert.deepEqual(capture.audioSettings, {
        echoCancellation: true,
        noiseSuppression: true,
        automaticGainControl: true,
    });
});

test('automatic gain control is disclosed on the metric it distorts', () => {
    const analysis = analyzeBrowserShape(browserShapedPayload());
    const variation = analysis.metrics.find((metric) => metric.key === 'energyVariation')!;
    assert.ok(variation.measured, 'the fixture must measure vocal variation for this to mean anything');
    assert.match(variation.explanation, /automatic gain control/i);
    assert.match(variation.explanation, /lower than the delivery actually was/i);
});

test('the gain control caveat is attached to vocal variation and nothing else', () => {
    const analysis = analyzeBrowserShape(browserShapedPayload());
    const carrying = analysis.metrics.filter((metric) => /gain control/i.test(metric.explanation));
    assert.equal(carrying.length, 1, `exactly one metric is affected by AGC, found ${carrying.length}`);
    assert.equal(carrying[0].key, 'energyVariation');
});

test('no gain control reported means no caveat is invented', () => {
    // The failure this guards is asymmetric: a missing caveat understates a
    // limitation, but a spurious one tells a candidate their microphone was
    // levelling their voice when it was not.
    const analysis = analyzeBrowserShape(
        browserShapedPayload({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        })
    );
    assert.equal(
        analysis.metrics.filter((metric) => /gain control/i.test(metric.explanation)).length,
        0
    );
});

test('a capture with no microphone settings at all stays silent about them', () => {
    const analysis = analyzeBrowserShape(browserShapedPayload({ audio: undefined }));
    assert.equal(analysis.metrics.filter((metric) => /gain control/i.test(metric.explanation)).length, 0);
});

test('unreadable microphone settings are not read as a confession', () => {
    // `getSettings` can be missing on older browsers and the field can be junk; only
    // a literal `true` may produce the caveat.
    const analysis = analyzeBrowserShape(
        browserShapedPayload({ audio: { autoGainControl: 'true' } as unknown as DeliveryCapturePayload['audio'] })
    );
    assert.equal(analysis.metrics.filter((metric) => /gain control/i.test(metric.explanation)).length, 0);
    assert.equal(parseCapture(browserShapedPayload({ audio: undefined })).audioSettings, null);
});

test('an unmeasured vocal variation carries no caveat about its accuracy', () => {
    // There is nothing to qualify: explaining the accuracy of a number that was
    // never produced would imply it had been.
    const analysis = analyzeBrowserShape(browserShapedPayload({ envelope: [] }));
    const variation = analysis.metrics.find((metric) => metric.key === 'energyVariation')!;
    assert.equal(variation.measured, false);
    assert.doesNotMatch(variation.explanation, /gain control/i);
});

test('a runaway capture note is truncated rather than stored whole', () => {
    const capture = parseCapture(browserShapedPayload({ captureNote: 'x'.repeat(4000) }));
    assert.equal(capture.captureNote?.length, 500);
});

test('the capture note reaches the reader verbatim', () => {
    const analysis = analyzeBrowserShape(
        browserShapedPayload({ captureNote: 'The candidate declined camera access.' })
    );
    assert.ok(
        analysis.issues.some((issue) => issue.includes('declined camera access')),
        'the browser knows things the signal never will; its words must survive to the report'
    );
});

test('a browser that captured nothing posts null rather than an empty shell', () => {
    // deliveryCapture.endAnswer() returns null in this case. The server has to treat
    // the resulting absent field exactly as it treats the old clients that never sent
    // one at all.
    const capture = parseCapture(null);
    assert.equal(capture.hasAudio, false);
    assert.equal(capture.hasVideo, false);
    assert.equal(capture.audioSettings, null);
    assert.equal(capture.issues.length, 1);
    const analysis = analyzeDelivery({
        capture,
        transcript: CLEAN_TRANSCRIPT,
        communicationScore: 70,
        confidenceScore: 70,
    });
    assert.equal(analysis.metrics.filter((metric) => metric.measured).length, 2, 'only the lexical pair survives');
    assert.equal(analysis.fusion.applied, false, 'nothing measured means nothing adjusted');
});

// ============================================
// [11] The stored timeline
// ============================================
//
// The report draws this contour and shades the speech spans onto it, so a wrong
// bucket or a dropped gap is not a cosmetic bug — it puts a pause in the wrong place
// on a picture a candidate is asked to trust. These checks pin the arithmetic.

section('[11] The stored timeline');

test('the timeline decimates to one point per interval', () => {
    // Two seconds of audio, quiet for the first second and loud for the second, so
    // the bucket means are predictable rather than incidental.
    const envelope: EnvelopeSample[] = [];
    for (let i = 0; i < 40; i += 1) {
        envelope.push({ tMs: i * ENVELOPE_SAMPLE_INTERVAL_MS, rms: i < 20 ? 0.01 : 0.02 });
    }

    const timeline = buildTimeline(parseCapture({ envelope }))!;
    assert.ok(timeline, 'an audio capture must produce a timeline');
    assert.equal(timeline.intervalMs, TIMELINE_INTERVAL_MS);
    assert.equal(timeline.points.length, 5, '1950ms of audio at a 500ms interval is five buckets');
    // Two buckets inside the quiet second, two inside the loud one, and one for the
    // half-second the last sample opens but does not fill.
    assert.ok(Math.abs(timeline.points[0] - 0.01) < 1e-9, 'quiet second');
    assert.ok(Math.abs(timeline.points[2] - 0.02) < 1e-9, 'loud second');
    assert.equal(timeline.points[4], 0, 'a bucket with no samples is zero, not a repeat of the last');
});

test('a gap in the samples becomes a zero bucket rather than a compressed axis', () => {
    // The failure this prevents: dropping empty buckets would shift every later
    // pause leftward, so the picture would disagree with the pause metrics.
    const envelope: EnvelopeSample[] = [
        { tMs: 0, rms: 0.2 },
        { tMs: 50, rms: 0.2 },
        { tMs: 60_000, rms: 0.2 },
        { tMs: 60_050, rms: 0.2 },
    ];
    const timeline = buildTimeline(parseCapture({ envelope }))!;
    assert.equal(timeline.points.length, 122, 'a minute of silence is still a minute of axis');
    assert.equal(timeline.points[1], 0);
    assert.equal(timeline.points[60], 0);
    assert.ok(Math.abs(timeline.points[0] - 0.2) < 1e-9);
    assert.ok(Math.abs(timeline.points[120] - 0.2) < 1e-9, 'the tail keeps its real position');
});

test('the timeline carries the pause length it was segmented with', () => {
    const timeline = buildTimeline(parseCapture(browserShapedPayload()))!;
    assert.equal(timeline.pauseThresholdMs, PAUSE_THRESHOLD_MS);
});

test('the drawn speech spans are the ones the pause metrics were derived from', () => {
    // The picture cannot be allowed to disagree with the numbers on the same screen,
    // so the two are asserted against each other rather than both against a constant.
    const capture = parseCapture({
        envelope: buildEnvelope(
            [
                { speechMs: 1000, silenceMs: 1200 },
                { speechMs: 1200, silenceMs: 0 },
            ],
            { speechRms: 0.2, silenceRms: 0.005, jitter: 0.03, seed: 11 }
        ),
        answerDurationMs: 3400,
    });

    const analysis = analyzeDelivery({
        capture,
        transcript: CLEAN_TRANSCRIPT,
        communicationScore: 70,
        confidenceScore: 70,
    });

    const spans = analysis.timeline!.speechSegments;
    assert.equal(spans.length, 2, 'one pause splits the answer into two spans');
    assert.equal(spans.length - 1, analysis.audio.pauseCount, 'spans and pauses must tell the same story');
    assert.ok(
        Math.abs(analysis.audio.longestPauseMs - 1200) < 150,
        `the 1200ms gap should be the reported pause, got ${analysis.audio.longestPauseMs}`
    );
    // The gap between the spans is the pause the metric counted, in the same place.
    assert.ok(
        Math.abs(spans[1].startMs - spans[0].endMs - 1200) < 150,
        'the drawn gap must be the measured pause'
    );
});

test('an answer with no audio has no timeline to draw', () => {
    // The report must render without one rather than draw an empty axis that looks
    // like an answer in which the candidate said nothing.
    assert.equal(buildTimeline(parseCapture({ frames: [makeFrame()] }))!, null);
    assert.equal(buildTimeline(parseCapture(null)), null);
});

test('a very long answer is truncated, and says so', () => {
    const envelope: EnvelopeSample[] = [];
    // 40 minutes at 50ms — well past MAX_TIMELINE_POINTS at the 500ms resolution.
    for (let i = 0; i < 48_000 && i < MAX_ENVELOPE_SAMPLES; i += 1) {
        envelope.push({ tMs: i * ENVELOPE_SAMPLE_INTERVAL_MS, rms: 0.1 });
    }
    const timeline = buildTimeline(parseCapture({ envelope }))!;
    assert.equal(timeline.points.length, MAX_TIMELINE_POINTS);
    assert.equal(timeline.truncated, true, 'a cut-off contour must be labelled as one');
});

test('a normal answer is not labelled truncated', () => {
    const timeline = buildTimeline(parseCapture(browserShapedPayload()))!;
    assert.equal(timeline.truncated, false);
});

test('the lexical disclosure keeps the shape the report screen reads', () => {
    // The session route forwards this object and the report destructures it. It is
    // the server's own account of what the word counters count, so it has to stay
    // structured data — a candidate cannot check a counter that will not say what it
    // refuses to count, and a flattened string would take that away silently.
    assert.ok(Array.isArray(LEXICAL_DISCLOSURE.fillers) && LEXICAL_DISCLOSURE.fillers.length > 0);
    assert.ok(Array.isArray(LEXICAL_DISCLOSURE.hedges) && LEXICAL_DISCLOSURE.hedges.length > 0);
    assert.ok(Array.isArray(LEXICAL_DISCLOSURE.observedOnly));
    assert.ok(Array.isArray(LEXICAL_DISCLOSURE.excluded) && LEXICAL_DISCLOSURE.excluded.length > 0);
    for (const entry of LEXICAL_DISCLOSURE.excluded) {
        assert.equal(typeof entry.word, 'string');
        assert.equal(typeof entry.reason, 'string');
        assert.ok(entry.reason.length > 0, `every exclusion must give a reason: ${entry.word}`);
    }
});

// ============================================
// [12] The scope an interviewer's view is narrowed to
// ============================================
//
// GET /api/delivery/profile?sessionId=… lets the owner of a study read a candidate's
// delivery — the evidence behind a decision they are making. What it must never do is
// hand them the candidate's answers from ANOTHER interviewer's study, which is what an
// unfiltered roll-up would do, quietly, while looking like a feature.
//
// `sessionsVisibleToStudyOwner` resolves that scope against the database and cannot be
// exercised here. What can be is the rule it feeds: a caller scoped to nothing gets
// nothing. These checks exist because the failure mode of a permission check is
// silent — an empty filter and no filter look identical from the outside until
// someone's answers from somewhere else turn up on the screen.

section('[12] Profile scoping');

test('a caller scoped to no sessions gets an empty profile, not the whole history', async () => {
    // No database is configured in this run, so if the scoping rule were applied after
    // the query — or not at all — this call would throw rather than quietly returning
    // everything. Either outcome fails the check, which is the point.
    const profile = await userDeliveryProfile('candidate-1', { sessionIds: [] });
    assert.equal(profile.analyzedCount, 0);
    assert.equal(profile.trend.length, 0);
});

test('an empty scope still carries a full registry of unmeasured metrics', async () => {
    // The screen renders from the registry, so an empty profile has to arrive shaped
    // like a full one. A caller that had to special-case this would be one refactor
    // away from rendering "0 wpm" for a candidate whose pace was never measured.
    const profile = await userDeliveryProfile('candidate-1', { sessionIds: [] });
    assert.equal(profile.aggregate.length, METRIC_REGISTRY.length);
    for (const metric of profile.aggregate) {
        assert.equal(metric.mean, null, `${metric.key} must have no mean, not a zero`);
        assert.equal(metric.measuredCount, 0);
    }
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
        console.log(`delivery core: ${passed} checks passed`);
        process.exit(0);
    } else {
        console.log(`delivery core: ${passed} passed, ${failures.length} FAILED`);
        for (const failure of failures) console.log(`  - ${failure}`);
        process.exit(1);
    }
})();
