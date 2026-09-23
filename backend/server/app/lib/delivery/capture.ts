// ============================================
// capture.ts — the capture payload contract and the analysis composition
// Feature 2 — Multimodal Delivery Analysis
// ============================================
//
// THE SPLIT THIS FILE DEFINES
//
// Two things happen to produce a delivery measurement, and they happen on
// different sides of the network on purpose:
//
//   · The BROWSER extracts raw signals. It has to: the microphone and camera are
//     there and nowhere else. What it produces is an RMS envelope (amplitude at a
//     fixed interval) and per-frame luminance statistics — measurements, not
//     judgements.
//
//   · The SERVER derives every metric and applies every adjustment, from those
//     raw signals. This is the part that matters: a score computed on the client
//     is a score the candidate can edit. Nothing in this file trusts the browser
//     for anything except the signal itself, and even that is sanitised below.
//
// The payload is small because of that split — a three-minute answer is ~3,600
// envelope samples, tens of kilobytes — so there is no reason to accept a client
// that wants to send more. See MAX_ENVELOPE_SAMPLES.
//
// This file is pure: payload in, an analysis out. No DB, no DOM, no network. The
// persistence and job lifecycle live in deliveryService.ts.

import {
    PAUSE_THRESHOLD_MS,
    answerLatencyMs,
    computeAudioMetrics,
    deriveThresholds,
    segmentEnvelope,
    type AudioDeliveryMetrics,
    type EnvelopeSample,
} from './audioMath';
import { computeLexicalMetrics, type LexicalMetrics } from './lexicalMath';
import { computeVideoMetrics, type FrameStats, type VideoDeliveryMetrics } from './videoMath';
import {
    fuseDelivery,
    type FusionResult,
    type MetricValues,
} from './fusion';
import { METRIC_REGISTRY, evaluateMetric, metricDefinition, type MetricUnit } from './contract';

// --------------------------------------------
// Bounds on what the client may send
// --------------------------------------------

/**
 * Roughly sixteen minutes of envelope at the 50ms sampling interval.
 *
 * A cap is not optional here. The array arrives from the browser, and without a
 * limit a malformed or hostile client could post an array large enough to lock up
 * the request that saves the candidate's answer. Sixteen minutes is far beyond any
 * interview answer and still a trivial amount of work to process.
 */
export const MAX_ENVELOPE_SAMPLES = 20_000;

/** ~2000 frames at one per half-second is over sixteen minutes of sampled video. */
export const MAX_FRAMES = 2_000;

/** Transcripts are handled elsewhere; this bounds the copy we accept here. */
export const MAX_TRANSCRIPT_CHARS = 40_000;

/** Below this, a payload is not a capture — it is noise, and is treated as absent. */
export const MIN_ENVELOPE_SAMPLES = 4;

/**
 * Resolution of the timeline kept for display: one loudness value per half-second.
 *
 * The raw envelope is sampled at 50ms and is deliberately NOT kept — it is cleared
 * when the analysis succeeds, because a 20Hz loudness recording of someone's voice
 * is a recording of their voice, and the metrics are what the platform actually
 * needs. What is kept is this: a tenfold-decimated contour, enough to draw the
 * shape of an answer and mark where the pauses were, and not enough to reconstruct
 * what was said.
 */
export const TIMELINE_INTERVAL_MS = 500;

/** A sixteen-minute answer at the timeline resolution. Beyond this the tail is dropped. */
export const MAX_TIMELINE_POINTS = 2_000;

/**
 * The stored shape of an answer's delivery, for drawing.
 *
 * Derived, not captured: `speechSegments` comes from the same segmentation that
 * produced the pause metrics, so the picture and the numbers on the same screen
 * cannot disagree about where a pause was.
 */
export interface DeliveryTimeline {
    /** Mean RMS per bucket, oldest first. Buckets with no samples are 0. */
    points: number[];
    intervalMs: number;
    /** Where speech was detected, in milliseconds from the start of the window. */
    speechSegments: Array<{ startMs: number; endMs: number }>;
    /** The pause length that was counted as a pause, so the picture can label it. */
    pauseThresholdMs: number;
    /** Length of the answer, so a truncated timeline can say how much it covers. */
    totalMs: number;
    truncated: boolean;
}

// --------------------------------------------
// The wire format
// --------------------------------------------

/** One envelope sample as it arrives: untrusted, so every field is optional and unvalidated. */
export interface RawEnvelopeSample {
    tMs?: unknown;
    rms?: unknown;
}

/** One frame's statistics as they arrive: untrusted for the same reason. */
export interface RawFrameStats {
    tMs?: unknown;
    meanLuma?: unknown;
    stdLuma?: unknown;
    laplacianVariance?: unknown;
    clippedDarkRatio?: unknown;
    clippedBrightRatio?: unknown;
}

/** The audio constraints that were actually in force, as the browser reported them. */
export interface RawAudioSettings {
    echoCancellation?: unknown;
    noiseSuppression?: unknown;
    autoGainControl?: unknown;
}

/** What the browser posts alongside an answer, when it captured one. */
export interface DeliveryCapturePayload {
    envelope?: RawEnvelopeSample[];
    frames?: RawFrameStats[];
    /**
     * Milliseconds from the start of the capture window to the moment the question
     * finished. Supplied rather than inferred because the question's end is not
     * visible in the envelope — and subtracted here rather than accepted as a
     * latency so the arithmetic stays on the server.
     */
    questionEndedAtMs?: unknown;
    /** Total length of the answer, used to judge frame coverage over time. */
    answerDurationMs?: unknown;
    /**
     * Free text the client wants on the record — e.g. "camera permission denied".
     * Surfaced to the reader, never scored. Length-capped.
     */
    captureNote?: unknown;
    /**
     * The microphone settings the browser applied, reported so a metric can be
     * qualified by the conditions it was measured under. See `automaticGainControl`
     * in the analysis, which is the reason this field exists.
     */
    audio?: RawAudioSettings;
}

/** The sanitised audio settings, or null when the client did not report them. */
export interface CaptureAudioSettings {
    echoCancellation: boolean;
    noiseSuppression: boolean;
    automaticGainControl: boolean;
}

/** A sanitised capture: every number finite, every array bounded, or the field is gone. */
export interface ParsedCapture {
    envelope: EnvelopeSample[];
    frames: FrameStats[];
    questionEndedAtMs: number | null;
    answerDurationMs: number | null;
    captureNote: string | null;
    /** The microphone conditions the answer was measured under, when reported. */
    audioSettings: CaptureAudioSettings | null;
    /**
     * What had to be corrected or dropped, in plain words.
     *
     * Recorded rather than swallowed: if the browser sent a truncated envelope,
     * the resulting metrics are computed over less of the answer, and a reader
     * who is judging how much to trust them needs to know that.
     */
    issues: string[];
    /** True when there is enough audio to say anything at all. */
    hasAudio: boolean;
    /** True when there are enough frames to say anything about the image. */
    hasVideo: boolean;
}

// --------------------------------------------
// Parsing untrusted input
// --------------------------------------------

function finiteOr(value: unknown, fallback: number | null = null): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/**
 * Turns whatever the client posted into something the metric layer can trust.
 *
 * Tolerant on purpose, and loud about it. A field that cannot be read is dropped
 * and named in `issues` rather than repaired silently or allowed to throw: a
 * candidate mid-interview must never see a failure because their browser could not
 * measure something, and a metric computed from a field we guessed at is worse
 * than one reported as unmeasured.
 */
export function parseCapture(raw: DeliveryCapturePayload | null | undefined): ParsedCapture {
    const issues: string[] = [];
    const envelope: EnvelopeSample[] = [];
    const frames: FrameStats[] = [];

    if (!raw || typeof raw !== 'object') {
        return {
            envelope,
            frames,
            questionEndedAtMs: null,
            answerDurationMs: null,
            captureNote: null,
            audioSettings: null,
            issues: ['No capture data was sent with this answer.'],
            hasAudio: false,
            hasVideo: false,
        };
    }

    // ── Envelope ─────────────────────────────────────────────────────────────
    if (Array.isArray(raw.envelope)) {
        const incoming = raw.envelope.slice(0, MAX_ENVELOPE_SAMPLES);
        if (raw.envelope.length > MAX_ENVELOPE_SAMPLES) {
            issues.push(
                `The audio envelope was truncated to the first ${MAX_ENVELOPE_SAMPLES} samples.`
            );
        }
        let dropped = 0;
        for (const sample of incoming) {
            const tMs = finiteOr(sample?.tMs);
            const rms = finiteOr(sample?.rms);
            if (tMs === null || rms === null || tMs < 0 || rms < 0) {
                dropped += 1;
                continue;
            }
            envelope.push({ tMs, rms });
        }
        if (dropped > 0) {
            issues.push(`${dropped} unreadable audio sample(s) were discarded.`);
        }
    } else if (raw.envelope !== undefined) {
        issues.push('The audio envelope was not an array and was discarded.');
    }

    // ── Frames ───────────────────────────────────────────────────────────────
    if (Array.isArray(raw.frames)) {
        const incoming = raw.frames.slice(0, MAX_FRAMES);
        if (raw.frames.length > MAX_FRAMES) {
            issues.push(`The frame list was truncated to the first ${MAX_FRAMES} frames.`);
        }
        let dropped = 0;
        for (const frame of incoming) {
            const tMs = finiteOr(frame?.tMs);
            const meanLuma = finiteOr(frame?.meanLuma);
            const stdLuma = finiteOr(frame?.stdLuma);
            const laplacianVariance = finiteOr(frame?.laplacianVariance);
            if (tMs === null || meanLuma === null || stdLuma === null || laplacianVariance === null) {
                dropped += 1;
                continue;
            }
            frames.push({
                tMs,
                // Luma statistics have defined ranges, so they are clamped rather
                // than rejected — a clamped frame is still a usable observation,
                // whereas a rejected one would silently thin the sample.
                meanLuma: clampNumber(meanLuma, 0, 255),
                stdLuma: Math.max(0, stdLuma),
                laplacianVariance: Math.max(0, laplacianVariance),
                clippedDarkRatio: clampNumber(finiteOr(frame?.clippedDarkRatio) ?? 0, 0, 1),
                clippedBrightRatio: clampNumber(finiteOr(frame?.clippedBrightRatio) ?? 0, 0, 1),
            });
        }
        if (dropped > 0) {
            issues.push(`${dropped} unreadable video frame(s) were discarded.`);
        }
    } else if (raw.frames !== undefined) {
        issues.push('The frame list was not an array and was discarded.');
    }

    // ── Scalars ──────────────────────────────────────────────────────────────
    const questionEndedAtMs = finiteOr(raw.questionEndedAtMs);
    if (questionEndedAtMs !== null && questionEndedAtMs < 0) {
        issues.push('The question end time was negative and was ignored.');
    }

    const answerDurationMs = finiteOr(raw.answerDurationMs);

    const note = typeof raw.captureNote === 'string' ? raw.captureNote.trim() : '';
    const captureNote = note.length > 0 ? note.slice(0, 500) : null;

    // ── Microphone conditions ────────────────────────────────────────────────
    // Only read when the client sent an object, and each flag only when it is
    // literally `true`. A missing or unreadable flag is recorded as `false`, which
    // means "not reported" — and the consumer below treats an unreported setting as
    // a reason to stay silent rather than a reason to warn.
    const rawAudio = raw.audio;
    const audioSettings: CaptureAudioSettings | null =
        rawAudio !== null && typeof rawAudio === 'object'
            ? {
                  echoCancellation: rawAudio.echoCancellation === true,
                  noiseSuppression: rawAudio.noiseSuppression === true,
                  automaticGainControl: rawAudio.autoGainControl === true,
              }
            : null;

    const hasAudio = envelope.length >= MIN_ENVELOPE_SAMPLES;
    if (envelope.length > 0 && !hasAudio) {
        issues.push('Too little audio was captured to measure anything from it.');
    }

    return {
        envelope,
        frames,
        questionEndedAtMs:
            questionEndedAtMs !== null && questionEndedAtMs >= 0 ? questionEndedAtMs : null,
        answerDurationMs: answerDurationMs !== null && answerDurationMs >= 0 ? answerDurationMs : null,
        captureNote,
        audioSettings,
        issues,
        hasAudio,
        hasVideo: frames.length > 0,
    };
}

// --------------------------------------------
// The analysis
// --------------------------------------------

/** One measured (or deliberately unmeasured) metric, ready to persist and display. */
export interface DeliveryMetricResult {
    key: string;
    label: string;
    unit: MetricUnit;
    /** Null when the metric could not be measured. Never 0 as a stand-in. */
    value: number | null;
    position: number;
    impact: number;
    inBand: boolean;
    measured: boolean;
    source: 'audio' | 'lexical' | 'video';
    explanation: string;
}

export interface DeliveryAnalysis {
    metrics: DeliveryMetricResult[];
    fusion: FusionResult;
    audio: AudioDeliveryMetrics;
    lexical: LexicalMetrics;
    video: VideoDeliveryMetrics;
    /** Word count from the transcript, kept for display alongside the rates. */
    wordCount: number;
    /** A display-resolution contour of the answer, or null when there was no audio. */
    timeline: DeliveryTimeline | null;
    /** Everything the client could not supply, plus anything dropped in parsing. */
    issues: string[];
    hasAudio: boolean;
    hasVideo: boolean;
}

/** Which source each metric key came from, so the UI can group and explain it. */
const METRIC_SOURCES: Record<string, 'audio' | 'lexical' | 'video'> = {
    speakingRateWpm: 'audio',
    pauseCount: 'audio',
    longestPauseMs: 'audio',
    silentRatio: 'audio',
    energyVariation: 'audio',
    answerLatencyMs: 'audio',
    fillerRate: 'lexical',
    hedgeRate: 'lexical',
    frameBlurScore: 'video',
    exposureScore: 'video',
    cameraCoveredRatio: 'video',
    sceneMotionIndex: 'video',
    analyzableFrameRatio: 'video',
};

/**
 * Derives every delivery metric for one answer and folds the scorable ones into
 * the score adjustments.
 *
 * @param capture   the sanitised capture from `parseCapture`
 * @param transcript the answer text, from the same place the rest of the scoring
 *                   gets it — not from the capture payload, so there is one copy
 *                   of the transcript rather than two that can disagree
 * @param scores    the text-derived scores the adjustments apply to
 */
export function analyzeDelivery(params: {
    capture: ParsedCapture;
    transcript: string;
    communicationScore: number;
    confidenceScore: number;
}): DeliveryAnalysis {
    const { capture, transcript } = params;

    const lexical = computeLexicalMetrics(transcript ?? '');
    const audio = computeAudioMetrics(capture.envelope, lexical.wordCount);

    // Latency needs the first speech frame, which only the segmented envelope
    // knows — and segmentation is a side effect of computeAudioMetrics, so it is
    // recovered here from the same thresholds rather than re-derived differently.
    const firstSpeechMs = firstSpeechTimestamp(capture.envelope);
    const latency =
        capture.questionEndedAtMs !== null && firstSpeechMs !== null
            ? answerLatencyMs(capture.questionEndedAtMs, firstSpeechMs)
            : null;

    const video = computeVideoMetrics(capture.frames, capture.answerDurationMs ?? audio.totalDurationMs);

    // ── Assemble the raw metric values, keyed by registry key ────────────────
    // Pause structure is only meaningful when there was speech to have pauses in.
    // The audio layer reports 0 for these when it found nothing to segment, and 0
    // is indistinguishable from a genuine measurement of "no pauses" — so the
    // signal is promoted to unmeasured here rather than stored as a zero that a
    // reader would take at face value.
    const speechMeasured = audio.hasSpeech;
    const values: MetricValues = {
        speakingRateWpm: audio.speakingRateWpm,
        pauseCount: speechMeasured ? audio.pauseCount : null,
        longestPauseMs: speechMeasured ? audio.longestPauseMs : null,
        silentRatio: speechMeasured ? audio.silentRatio : null,
        energyVariation: audio.energyVariation,
        answerLatencyMs: latency,
        fillerRate: lexical.wordCount > 0 ? lexical.fillerRate : null,
        hedgeRate: lexical.wordCount > 0 ? lexical.hedgeRate : null,
        frameBlurScore: video.frameBlurScore,
        exposureScore: video.exposureScore,
        cameraCoveredRatio: video.sampledFrameCount > 0 ? video.cameraCoveredRatio : null,
        sceneMotionIndex: video.sceneMotionIndex,
        analyzableFrameRatio: capture.hasVideo ? video.analyzableFrameRatio : null,
    };

    const fusion = fuseDelivery({
        communicationScore: params.communicationScore,
        confidenceScore: params.confidenceScore,
        metrics: values,
        hasSpeech: capture.hasAudio ? audio.hasSpeech : false,
        speechDurationMs: audio.speechDurationMs,
        wordCount: lexical.wordCount,
        // Coverage comes through the metric set; passing it explicitly as well
        // would be a second source for the same fact.
    });

    // ── One row per registry metric, measured or not ─────────────────────────
    // Every metric in the registry gets a row, including the ones that carry
    // nothing. A missing row would be ambiguous — it could mean "not measured" or
    // "this build did not know about that metric" — and the UI needs to be able to
    // say which.
    const evaluationByKey = new Map(fusion.evidence.map((entry) => [entry.key, entry]));
    const metrics: DeliveryMetricResult[] = METRIC_REGISTRY.map((definition) => {
        const value = values[definition.key];
        const measured = typeof value === 'number' && Number.isFinite(value);
        const evaluation = evaluationByKey.get(definition.key);
        return {
            key: definition.key,
            label: definition.label,
            unit: definition.unit,
            value: measured ? (value as number) : null,
            position: evaluation?.position ?? 0,
            impact: evaluation?.impact ?? 0,
            inBand: evaluation?.inBand ?? true,
            measured,
            source: METRIC_SOURCES[definition.key] ?? 'audio',
            explanation:
                evaluation?.explanation ??
                `${definition.label} was not measured for this answer, so it contributed nothing.`,
        };
    });

    // ── A measurement is only as good as the conditions it was taken under ────
    // The interview asks for automatic gain control because it helps speech
    // recognition, but AGC works by levelling loudness — which is precisely the
    // quantity the vocal-variation metric reads. Left unsaid, a candidate whose
    // browser applied it would be shown a flatter delivery than they actually gave
    // and marked down for it, with no way to know why.
    //
    // The caveat is attached to the one metric it affects rather than to the answer
    // as a whole, because the other twelve are unaffected by it.
    if (capture.audioSettings?.automaticGainControl) {
        const variation = metrics.find((metric) => metric.key === 'energyVariation');
        if (variation?.measured) {
            variation.explanation +=
                " The microphone's automatic gain control was on, which evens out loudness differences, so this figure reads lower than the delivery actually was.";
        }
    }

    const issues = [...capture.issues];
    // The client's own words about the capture come first when it gave any: a
    // browser that reports "camera permission denied" explains more than any
    // inference from the data that failed to arrive.
    if (capture.captureNote) issues.unshift(capture.captureNote);
    // The extractors know *why* a metric is absent — a muted microphone and a
    // three-second answer produce the same unmeasured speaking rate but not the
    // same advice. Their explanations are surfaced verbatim instead of being left
    // in an object nobody reads, because "we could not measure this because your
    // microphone was silent" is the single most useful sentence on the screen.
    if (audio.note) issues.push(audio.note);
    if (video.note) issues.push(video.note);
    if (!capture.hasAudio) {
        issues.push('No audio envelope was captured, so nothing about how this answer was spoken could be measured.');
    }
    if (!capture.hasVideo) {
        issues.push('No video frames were captured, so the image-quality signals are absent.');
    }
    if (latency === null && capture.questionEndedAtMs !== null) {
        issues.push('The time taken to start answering could not be established from the capture clocks.');
    }

    return {
        metrics,
        fusion,
        audio,
        lexical,
        video,
        wordCount: lexical.wordCount,
        timeline: buildTimeline(capture),
        issues,
        hasAudio: capture.hasAudio,
        hasVideo: capture.hasVideo,
    };
}

/**
 * Reduces the envelope to a contour that can be drawn, and keeps the speech spans.
 *
 * Decimation is by bucketed mean rather than by picking every nth sample, so a
 * bucket reports the loudness of that half-second rather than the loudness of one
 * arbitrary moment inside it — a single dropped sample would otherwise read as a
 * dip in the middle of a word.
 *
 * Empty buckets are kept as zeroes rather than skipped. The timeline is drawn on a
 * time axis, and a gap that is silently removed would compress the answer and place
 * every later pause at the wrong moment.
 */
export function buildTimeline(capture: ParsedCapture): DeliveryTimeline | null {
    if (!capture.hasAudio) return null;

    const amplitudes = capture.envelope
        .map((sample) => (Number.isFinite(sample.rms) ? sample.rms : 0))
        .sort((a, b) => a - b);
    const { speech } = segmentEnvelope(capture.envelope, deriveThresholds(amplitudes));

    const lastSample = capture.envelope[capture.envelope.length - 1];
    const totalMs = Math.max(
        Math.round(lastSample?.tMs ?? 0),
        capture.answerDurationMs ?? 0
    );
    const bucketCount = Math.max(1, Math.ceil(totalMs / TIMELINE_INTERVAL_MS) + 1);
    const kept = Math.min(bucketCount, MAX_TIMELINE_POINTS);

    const sums = new Array<number>(kept).fill(0);
    const counts = new Array<number>(kept).fill(0);
    for (const sample of capture.envelope) {
        const bucket = Math.min(kept - 1, Math.floor(sample.tMs / TIMELINE_INTERVAL_MS));
        if (bucket < 0) continue;
        sums[bucket] += Number.isFinite(sample.rms) ? sample.rms : 0;
        counts[bucket] += 1;
    }

    return {
        points: sums.map((sum, index) => (counts[index] > 0 ? sum / counts[index] : 0)),
        intervalMs: TIMELINE_INTERVAL_MS,
        speechSegments: speech.map((segment) => ({
            startMs: Math.round(segment.startMs),
            endMs: Math.round(segment.endMs),
        })),
        pauseThresholdMs: PAUSE_THRESHOLD_MS,
        totalMs,
        truncated: bucketCount > kept,
    };
}

/**
 * Timestamp of the first sample classified as speech.
 *
 * Deliberately a small local composition rather than a change to the audio layer's
 * API: the only thing needed here is where speech begins, and the same threshold
 * derivation is reused so this timestamp and the pause structure agree.
 */
function firstSpeechTimestamp(envelope: EnvelopeSample[]): number | null {
    if (envelope.length < MIN_ENVELOPE_SAMPLES) return null;

    const amplitudes = envelope
        .map((sample) => (Number.isFinite(sample.rms) ? sample.rms : 0))
        .sort((a, b) => a - b);
    const { speech } = segmentEnvelope(envelope, deriveThresholds(amplitudes));
    return speech.length > 0 ? speech[0].startMs : null;
}

/** Convenience for callers that only have the capture note to show. */
export function captureNoteFrom(capture: ParsedCapture): string | null {
    return capture.captureNote;
}

/**
 * One metric rolled up across several answers.
 *
 * The mean is taken over measured values only, and `measuredCount` is carried
 * beside it because the two together are the honest statement: "145 wpm, measured
 * on 4 of 6 answers" is a different claim from "145 wpm". A metric whose mean sits
 * inside its band is marked so, using the same `evaluateMetric` the per-answer
 * scoring used, so a person and the score can never disagree about what "inside
 * the band" means.
 */
export interface MetricAggregate {
    key: string;
    label: string;
    unit: MetricUnit;
    /** Mean of the measured values, or null when nothing was measured. */
    mean: number | null;
    /** Answers that yielded a measurement. */
    measuredCount: number;
    /** Answers that were analysed. */
    totalCount: number;
    /** Whether the mean sits inside the healthy band. */
    inBand: boolean;
    /** Points this metric contributed across all analysed answers. */
    impact: number;
}

/**
 * Rolls per-answer metrics up into a profile.
 *
 * Pure, so the aggregate a candidate is shown can be tested against known inputs
 * rather than against whatever the database happened to hold.
 */
export function aggregateDeliveryMetrics(
    perResponse: DeliveryMetricResult[][]
): MetricAggregate[] {
    const totalCount = perResponse.length;

    return METRIC_REGISTRY.map((definition) => {
        const rows = perResponse
            .map((metrics) => metrics.find((metric) => metric.key === definition.key))
            .filter((row): row is DeliveryMetricResult => Boolean(row));

        const measured = rows.filter(
            (row) => row.measured && typeof row.value === 'number' && Number.isFinite(row.value)
        );
        const mean =
            measured.length > 0
                ? measured.reduce((sum, row) => sum + (row.value as number), 0) / measured.length
                : null;

        const impact = rows.reduce((sum, row) => sum + row.impact, 0);

        return {
            key: definition.key,
            label: definition.label,
            unit: definition.unit,
            mean,
            measuredCount: measured.length,
            totalCount,
            // The band is interpreted in exactly one place — contract.ts — so the
            // summary cannot drift from the scoring.
            inBand: mean === null ? true : evaluateMetric(definition, mean).inBand,
            impact,
        };
    });
}

/** The registry entry behind a metric key, for callers formatting a row. */
export { metricDefinition };
