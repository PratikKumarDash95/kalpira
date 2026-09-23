// ============================================
// audioMath.ts — delivery signals from a vocal energy envelope
// Feature 2 — Multimodal Delivery Analysis
// ============================================
//
// Input is an *envelope*, not raw audio: the browser samples RMS amplitude at a
// fixed interval while the candidate speaks, and sends the series. At 20 Hz a
// three-minute answer is 3,600 numbers — small enough to store, and enough to
// recover everything below.
//
// WHY AN ENVELOPE AND NOT THE AUDIO FILE
//
// Two reasons, and both are honest ones:
//
//  1. The platform already runs speech recognition in the browser. Uploading
//     hundreds of megabytes of video so a server can re-derive what the client
//     already knows would be slower, more expensive, and more invasive.
//  2. Pause structure, energy variation and speaking rate are all recoverable
//     from the envelope. Nothing here needs the waveform itself. What the
//     envelope *cannot* do — identify words — is what the transcript is for.
//
// This file is pure: no DOM, no DB, no provider. Everything is a function of the
// envelope and the elapsed clock, so the whole DSP layer is unit-testable.
//
// THE HARD PART IS THE THRESHOLD
//
// A fixed dB threshold does not survive contact with real microphones. A laptop
// mic in a quiet room and a headset in a café produce envelopes an order of
// magnitude apart, so the same threshold marks one candidate as silent and the
// other as speaking continuously. The threshold here is therefore derived *per
// answer* from the envelope's own distribution, with hysteresis and minimum
// durations so it does not chatter. That is the difference between a measurement
// and a number.

/** One RMS sample: amplitude at a point in time. */
export interface EnvelopeSample {
    /** Milliseconds from the start of the answer's capture window. */
    tMs: number;
    /** Root-mean-square amplitude, nominally 0…1 but not guaranteed to be. */
    rms: number;
}

export interface SpeechSegment {
    startMs: number;
    endMs: number;
    durationMs: number;
    /** Mean RMS across the segment — how loud this stretch of speech was. */
    meanRms: number;
}

export interface SilenceGap {
    startMs: number;
    endMs: number;
    durationMs: number;
}

export interface AudioDeliveryMetrics {
    /** Words per minute over speech time only — silence is excluded. */
    speakingRateWpm: number | null;
    /** Silences of at least `pauseThresholdMs` that fall inside the answer. */
    pauseCount: number;
    longestPauseMs: number;
    /** Share of the answer that was silence rather than speech. */
    silentRatio: number;
    /**
     * Coefficient of variation of RMS across speech frames: standard deviation
     * divided by the mean. Scale-free, so it compares across microphones.
     */
    energyVariation: number | null;
    /** Speech duration in ms — the denominator behind speakingRateWpm. */
    speechDurationMs: number;
    /** Total duration covered by the envelope. */
    totalDurationMs: number;
    /** True when the envelope had enough speech to measure anything. */
    hasSpeech: boolean;
    /** Why the numbers are absent, when they are. Safe to show a person. */
    note: string | null;
}

// --------------------------------------------
// Tuning
// --------------------------------------------

/** Expected sampling interval. Used to tolerate jitter, not to resample. */
export const ENVELOPE_SAMPLE_INTERVAL_MS = 50;

/** A run of speech shorter than this is noise, not a word. */
export const MIN_SPEECH_MS = 150;

/** A silence shorter than this is a stop consonant, not a pause. */
export const MIN_SILENCE_MS = 200;

/** Silence at or above this counts as a pause for `pauseCount`. */
export const PAUSE_THRESHOLD_MS = 700;

/**
 * Below this many milliseconds of speech, a rate is meaningless — dividing four
 * words by a fraction of a second produces a number in the thousands that means
 * nothing. Answers this short are reported as unmeasurable instead.
 */
export const MIN_SPEECH_FOR_RATE_MS = 2000;

/** Used when the envelope is too flat to derive a threshold from its distribution. */
const ABSOLUTE_SILENCE_FLOOR = 0.004;

// --------------------------------------------
// Segmentation
// --------------------------------------------

export interface Thresholds {
    /** RMS above which a frame is speech. */
    enter: number;
    /** RMS below which speech ends. Lower than `enter`, for hysteresis. */
    exit: number;
    /** The estimated noise floor the thresholds were derived from. */
    noiseFloor: number;
    /** The upper percentile used as the loud end of the range. */
    speechPeak: number;
}

/**
 * Derives speech/silence thresholds from the envelope's own distribution.
 *
 * `sorted` must be ascending. The noise floor is a low percentile rather than the
 * minimum, because a single dropout frame should not drag it to zero; the peak is
 * a high percentile rather than the maximum, because one cough should not define
 * the scale.
 *
 * The exit threshold sits below the enter threshold so a frame hovering at the
 * boundary does not toggle speech on and off dozens of times a second — but it
 * always sits *above* the noise floor. That second property is not cosmetic: an
 * exit threshold below room tone can never fire, so the first blip latches the
 * rest of the answer into "speech" and the candidate is recorded as having talked
 * continuously. See the note on `exit` below.
 */
export function deriveThresholds(sorted: number[]): Thresholds {
    if (sorted.length === 0) {
        return { enter: ABSOLUTE_SILENCE_FLOOR, exit: ABSOLUTE_SILENCE_FLOOR, noiseFloor: 0, speechPeak: 0 };
    }

    const noiseFloor = percentileSorted(sorted, 0.1);
    const speechPeak = percentileSorted(sorted, 0.95);
    const range = speechPeak - noiseFloor;

    // A recording with almost no dynamic range is either silence, a constant hum,
    // or a held tone. All three mean "nothing was said", so the bar is placed
    // just above the loud end of what was observed and nothing can qualify. The
    // loud end is a percentile rather than the maximum for the same reason it is
    // above: one click must not raise the bar for the whole answer.
    if (range <= ABSOLUTE_SILENCE_FLOOR) {
        const enter = Math.max(speechPeak + ABSOLUTE_SILENCE_FLOOR, ABSOLUTE_SILENCE_FLOOR);
        // No hysteresis here. With a single amplitude level there is nothing to
        // be hysteretic about, and an exit below the level would let one blip
        // latch the answer into speech — which is the failure this branch exists
        // to avoid.
        return { enter, exit: enter, noiseFloor, speechPeak };
    }

    // 18% of the way up from the noise floor. Low enough to catch a quiet
    // speaker's normal voice, high enough to exclude room tone.
    const enter = noiseFloor + range * 0.18;

    // The scaled value is the hysteresis band we want, and is used whenever it is
    // safe. The floor term exists because it is not always safe: with a noisy
    // room and a quiet speaker, `enter * 0.65` lands *below* room tone, and then
    // no sample can ever end a speech run. Taking the larger of the two keeps the
    // band wherever it is usable and lifts it clear of room tone wherever it is
    // not.
    const exit = Math.max(enter * 0.65, noiseFloor + (enter - noiseFloor) * 0.25);

    return { enter, exit, noiseFloor, speechPeak };
}

function percentileSorted(sorted: number[], fraction: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
    return sorted[index];
}

interface Run {
    isSpeech: boolean;
    startMs: number;
    endMs: number;
}

/** Collapses adjacent runs of the same kind, so the list alternates strictly. */
function coalesce(runs: Run[]): Run[] {
    const out: Run[] = [];
    for (const run of runs) {
        const previous = out[out.length - 1];
        if (previous && previous.isSpeech === run.isSpeech) {
            previous.endMs = Math.max(previous.endMs, run.endMs);
        } else {
            out.push({ ...run });
        }
    }
    return out;
}

/**
 * Splits an envelope into speech and silence runs.
 *
 * Four passes, because a single threshold comparison is not enough:
 *
 *  1. classify with hysteresis — enter high, exit low
 *  2. coalesce neighbours, so the run list strictly alternates
 *  3. a speech run shorter than MIN_SPEECH_MS is a click, not a word: reclassify
 *     it as silence and coalesce again
 *  4. a silence run shorter than MIN_SILENCE_MS is a stop consonant inside a
 *     word: reclassify it as speech and coalesce again
 *
 * Without pass 3 every mouse click becomes a word; without pass 4 every "t" in
 * "butter" becomes a pause and every candidate looks hesitant.
 *
 * Leading and trailing silence is then dropped. It is real, but it is not *inside*
 * the answer: counting the wait before someone starts would double-count answer
 * latency, and counting the trailing tail would penalise a candidate for the
 * moment between finishing and the next question arriving.
 */
export function segmentEnvelope(
    samples: EnvelopeSample[],
    thresholds: Thresholds
): { speech: SpeechSegment[]; silence: SilenceGap[] } {
    if (samples.length === 0) return { speech: [], silence: [] };

    const ordered = [...samples].sort((a, b) => a.tMs - b.tMs);

    // Pass 1 — hysteresis classification.
    const raw: Run[] = [];
    let inSpeech = false;
    let runStart = ordered[0].tMs;

    for (const sample of ordered) {
        const amplitude = Number.isFinite(sample.rms) ? sample.rms : 0;
        if (!inSpeech && amplitude >= thresholds.enter) {
            raw.push({ isSpeech: false, startMs: runStart, endMs: sample.tMs });
            inSpeech = true;
            runStart = sample.tMs;
        } else if (inSpeech && amplitude < thresholds.exit) {
            raw.push({ isSpeech: true, startMs: runStart, endMs: sample.tMs });
            inSpeech = false;
            runStart = sample.tMs;
        }
    }
    const lastMs = ordered[ordered.length - 1].tMs;
    raw.push({ isSpeech: inSpeech, startMs: runStart, endMs: lastMs });

    // Pass 2.
    let runs = coalesce(raw.filter((run) => run.endMs >= run.startMs));

    // Pass 3 — blips are not speech.
    runs = coalesce(
        runs.map((run) =>
            run.isSpeech && run.endMs - run.startMs < MIN_SPEECH_MS
                ? { ...run, isSpeech: false }
                : run
        )
    );

    // Pass 4 — brief gaps are not pauses.
    runs = coalesce(
        runs.map((run) =>
            !run.isSpeech && run.endMs - run.startMs < MIN_SILENCE_MS
                ? { ...run, isSpeech: true }
                : run
        )
    );

    // Drop leading and trailing silence — see the note above.
    const firstSpeech = runs.findIndex((run) => run.isSpeech);
    if (firstSpeech === -1) return { speech: [], silence: [] };
    let lastSpeech = runs.length - 1;
    while (lastSpeech > firstSpeech && !runs[lastSpeech].isSpeech) lastSpeech -= 1;
    const inside = runs.slice(firstSpeech, lastSpeech + 1);

    const meanRmsFor = (startMs: number, endMs: number): number => {
        const inRange = ordered.filter((sample) => sample.tMs >= startMs && sample.tMs <= endMs);
        if (inRange.length === 0) return 0;
        return (
            inRange.reduce((sum, sample) => sum + (Number.isFinite(sample.rms) ? sample.rms : 0), 0) /
            inRange.length
        );
    };

    const speech: SpeechSegment[] = [];
    const silence: SilenceGap[] = [];
    for (const run of inside) {
        const durationMs = run.endMs - run.startMs;
        if (durationMs <= 0) continue;
        if (run.isSpeech) {
            speech.push({
                startMs: run.startMs,
                endMs: run.endMs,
                durationMs,
                meanRms: meanRmsFor(run.startMs, run.endMs),
            });
        } else {
            silence.push({ startMs: run.startMs, endMs: run.endMs, durationMs });
        }
    }

    return { speech, silence };
}

// --------------------------------------------
// Metrics
// --------------------------------------------

/**
 * Computes the audio delivery metrics for one answer.
 *
 * @param samples   the RMS envelope for this answer
 * @param wordCount words in the transcript for this answer
 */
export function computeAudioMetrics(
    samples: EnvelopeSample[],
    wordCount: number
): AudioDeliveryMetrics {
    const totalDurationMs = samples.length > 0
        ? Math.max(...samples.map((sample) => sample.tMs)) - Math.min(...samples.map((sample) => sample.tMs))
        : 0;

    const empty: AudioDeliveryMetrics = {
        speakingRateWpm: null,
        pauseCount: 0,
        longestPauseMs: 0,
        silentRatio: 0,
        energyVariation: null,
        speechDurationMs: 0,
        totalDurationMs,
        hasSpeech: false,
        note: null,
    };

    if (samples.length < 4 || totalDurationMs <= 0) {
        return { ...empty, note: 'No audio envelope was captured for this answer.' };
    }

    const amplitudes = samples
        .map((sample) => (Number.isFinite(sample.rms) ? sample.rms : 0))
        .sort((a, b) => a - b);
    const thresholds = deriveThresholds(amplitudes);
    const { speech, silence } = segmentEnvelope(samples, thresholds);

    const speechDurationMs = speech.reduce((sum, segment) => sum + segment.durationMs, 0);
    if (speechDurationMs <= 0) {
        return {
            ...empty,
            note: 'No speech was detected in this answer — the microphone may have been muted.',
        };
    }

    const pauseCount = silence.filter((gap) => gap.durationMs >= PAUSE_THRESHOLD_MS).length;
    const longestPauseMs = silence.reduce((longest, gap) => Math.max(longest, gap.durationMs), 0);
    // Silence is measured *inside* the answer, between the first and last word.
    // Counting the lead-in before someone starts would double-count latency.
    const answeredSpanMs = speech[speech.length - 1].endMs - speech[0].startMs;
    const insideSilenceMs = silence.reduce((sum, gap) => sum + gap.durationMs, 0);
    const silentRatio = answeredSpanMs > 0 ? Math.min(1, insideSilenceMs / answeredSpanMs) : 0;

    const speechRms = samples.filter(
        (sample) => sample.tMs >= speech[0].startMs && sample.tMs <= speech[speech.length - 1].endMs
    );
    const energyVariation = coefficientOfVariation(
        speechRms.map((sample) => (Number.isFinite(sample.rms) ? sample.rms : 0))
    );

    // A rate needs both enough speech to be meaningful and a word count to divide.
    const measurable = speechDurationMs >= MIN_SPEECH_FOR_RATE_MS && wordCount > 0;
    const speakingRateWpm = measurable
        ? (wordCount / (speechDurationMs / 60000))
        : null;

    return {
        speakingRateWpm,
        pauseCount,
        longestPauseMs,
        silentRatio,
        energyVariation,
        speechDurationMs,
        totalDurationMs,
        hasSpeech: true,
        note: measurable
            ? null
            : wordCount <= 0
              ? 'No transcript was captured, so no speaking rate could be measured.'
              : 'The answer was too short to measure a speaking rate.',
    };
}

/**
 * Standard deviation over the mean. Scale-free, which is why it is used instead
 * of raw variance: it compares a quiet headset to a loud laptop mic.
 */
export function coefficientOfVariation(values: number[]): number | null {
    const usable = values.filter(Number.isFinite);
    if (usable.length < 2) return null;

    const mean = usable.reduce((sum, value) => sum + value, 0) / usable.length;
    if (mean <= 0) return null;

    const variance =
        usable.reduce((sum, value) => sum + (value - mean) ** 2, 0) / usable.length;
    return Math.sqrt(variance) / mean;
}

/**
 * From the question ending to the candidate's first word.
 *
 * @param questionEndedAtMs when the interviewer's question finished
 * @param answerStartedAtMs when the first speech frame in the envelope occurred
 */
export function answerLatencyMs(
    questionEndedAtMs: number,
    answerStartedAtMs: number
): number | null {
    if (!Number.isFinite(questionEndedAtMs) || !Number.isFinite(answerStartedAtMs)) return null;
    const latency = answerStartedAtMs - questionEndedAtMs;
    // A negative latency means the clocks disagree — the candidate cannot have
    // started before the question ended. Reporting it as 0 would invent a
    // measurement, so it is reported as unmeasurable.
    if (latency < 0) return null;
    return latency;
}
