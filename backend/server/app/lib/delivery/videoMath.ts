// ============================================
// videoMath.ts — delivery signals from sampled video frames
// Feature 2 — Multimodal Delivery Analysis
// ============================================
//
// Input is a set of per-frame luminance statistics the browser computes on a
// downscaled canvas. Output is image-quality and motion metrics.
//
// WHAT THIS FILE CAN AND CANNOT DO — read this before adding a metric
//
// A luminance histogram supports real, verifiable measurements: sharpness,
// exposure, whether the lens is covered, how much the image moved between
// samples. Those are computed here, and they are genuine.
//
// A luminance histogram cannot find a face, estimate gaze, or recover head pose.
// Those need a detector — a model, running somewhere. Rather than approximate
// them badly and label the result "confidence", this file does not attempt them.
// `FaceAnalyzer` below is the seam where a real detector plugs in, and its
// contract requires it to say `available: false` rather than return a guess.
//
// That is the central discipline of this feature: a delivery metric that is
// fabricated is worse than one that is missing, because a candidate cannot tell
// the difference and the platform would be judging them on noise.
//
// This file is pure: no DOM, no canvas, no DB. The browser does the pixel work
// and hands over the numbers.

/** Per-frame statistics computed in the browser on a downscaled frame. */
export interface FrameStats {
    tMs: number;
    /** Mean luminance, 0–255. */
    meanLuma: number;
    /** Standard deviation of luminance — how much contrast the frame has. */
    stdLuma: number;
    /**
     * Variance of the Laplacian over the luma channel.
     *
     * This is the standard no-reference sharpness measure: a sharp image has
     * strong second derivatives at edges, a blurred one does not. Scale-dependent,
     * which is why every frame is downscaled to the same size before this is
     * computed — otherwise a resolution change would read as a sharpness change.
     */
    laplacianVariance: number;
    /** Share of pixels at or below 8 luma — crushed blacks, i.e. an unlit room. */
    clippedDarkRatio: number;
    /** Share of pixels at or above 247 luma — blown highlights, e.g. a window behind. */
    clippedBrightRatio: number;
}

export interface VideoDeliveryMetrics {
    /** Mean sharpness across sampled frames, 0–100. Higher is sharper. */
    frameBlurScore: number | null;
    /** Mean exposure quality, 0–100. 100 is a well-lit, unclipped frame. */
    exposureScore: number | null;
    /** Share of frames with no usable image — lens covered, or camera off. */
    cameraCoveredRatio: number;
    /** Mean frame-to-frame luminance change. Image-space motion, nothing more. */
    sceneMotionIndex: number | null;
    /** Share of the answer's duration covered by usable sampled frames. */
    analyzableFrameRatio: number;
    /** Frames that were sampled and usable. */
    usableFrameCount: number;
    /** Frames the client reported sampling, usable or not. */
    sampledFrameCount: number;
    note: string | null;
}

// --------------------------------------------
// Tuning
// --------------------------------------------

/**
 * Laplacian variance below this reads as soft; above it, sharp.
 *
 * Calibrated for a frame downscaled to roughly 64×48 with 8-bit luma. The value
 * is empirical — the constant is a choice, and it is documented as one rather
 * than presented as a physical threshold.
 */
export const BLUR_SOFT = 12;
export const BLUR_SHARP = 120;

/** A frame is "covered" when it has essentially no contrast and no light. */
export const COVERED_STD_LUMA = 4;
export const COVERED_MEAN_LUMA = 40;

/** Below this many usable frames, video metrics are reported as unmeasurable. */
export const MIN_USABLE_FRAMES = 5;

/** A frame must be covered for this share of the answer before it is reported. */
export const COVERED_SIGNIFICANT_RATIO = 0.2;

// --------------------------------------------
// Frame classification
// --------------------------------------------

/**
 * True when a frame carries no usable image.
 *
 * Two things make a frame useless: no contrast (a covered lens produces a flat
 * grey or flat black field) and no light. Both are required, because a genuinely
 * dark room with a lit face still has contrast, and a bright white wall has light
 * but no contrast — neither is a covered camera.
 */
export function isFrameCovered(frame: FrameStats): boolean {
    if (!Number.isFinite(frame.stdLuma) || !Number.isFinite(frame.meanLuma)) return true;
    return frame.stdLuma <= COVERED_STD_LUMA && frame.meanLuma <= COVERED_MEAN_LUMA;
}

/**
 * Sharpness as 0–100.
 *
 * Laplacian variance is unbounded and grows faster than linearly with edge
 * content, so it is mapped through a square root before scaling. Without that, a
 * high-detail background would peg the score at 100 and hide a genuinely soft
 * face.
 */
export function sharpnessScore(laplacianVariance: number): number {
    if (!Number.isFinite(laplacianVariance) || laplacianVariance <= 0) return 0;
    const scaled = Math.sqrt(laplacianVariance);
    const low = Math.sqrt(BLUR_SOFT);
    const high = Math.sqrt(BLUR_SHARP);
    const ratio = (scaled - low) / (high - low);
    return clamp(round1(ratio * 100), 0, 100);
}

/**
 * Exposure quality as 0–100.
 *
 * Penalises both crushed blacks and blown highlights, and separately penalises
 * sitting far from mid-grey. A face lit from a window behind it lands near 0 on
 * both counts; a normally lit face lands near 100.
 */
export function exposureScore(frame: FrameStats): number {
    if (!Number.isFinite(frame.meanLuma)) return 0;

    // Distance from mid-grey, normalised so ±100 luma is fully wrong.
    const midGreyPenalty = Math.min(1, Math.abs(frame.meanLuma - 128) / 100);
    // Clipping, with headroom: a little is normal, a lot is a problem.
    const clipping = clamp(frame.clippedDarkRatio + frame.clippedBrightRatio, 0, 1);
    const clippingPenalty = Math.min(1, clipping / 0.35);

    const quality = 1 - Math.max(midGreyPenalty, clippingPenalty);
    return clamp(round1(quality * 100), 0, 100);
}

/**
 * Mean absolute luminance change between consecutive sampled frames.
 *
 * NAMED FOR WHAT IT IS. This is not head pose and not head stability. A nodding
 * head and a hand reaching for a glass produce the same number. It is recorded
 * because it is a useful data-validity signal — a frame-difference of zero across
 * a long answer means the camera froze — and because it costs nothing, but it
 * feeds no score and the UI does not present it as body language.
 */
export function sceneMotion(frames: FrameStats[]): number | null {
    if (frames.length < 2) return null;
    const ordered = [...frames].sort((a, b) => a.tMs - b.tMs);
    let total = 0;
    let comparisons = 0;
    for (let i = 1; i < ordered.length; i += 1) {
        const previous = ordered[i - 1].meanLuma;
        const current = ordered[i].meanLuma;
        if (!Number.isFinite(previous) || !Number.isFinite(current)) continue;
        total += Math.abs(current - previous);
        comparisons += 1;
    }
    if (comparisons === 0) return null;
    return round3(total / comparisons / 255);
}

// --------------------------------------------
// Aggregate
// --------------------------------------------

/**
 * Aggregates per-frame statistics into the video delivery metrics for one answer.
 *
 * Frames the client reported sampling but which were unusable are still counted in
 * `sampledFrameCount`, so `analyzableFrameRatio` reflects the truth: an answer
 * where the camera was covered half the time is not an answer with half the data,
 * it is an answer whose video metrics should be trusted less.
 */
export function computeVideoMetrics(
    frames: FrameStats[],
    answerDurationMs: number
): VideoDeliveryMetrics {
    const sampledFrameCount = frames.length;
    const usable = frames.filter(
        (frame) => !isFrameCovered(frame) && Number.isFinite(frame.meanLuma) && Number.isFinite(frame.stdLuma)
    );

    const base: VideoDeliveryMetrics = {
        frameBlurScore: null,
        exposureScore: null,
        cameraCoveredRatio: sampledFrameCount > 0 ? round3(1 - usable.length / sampledFrameCount) : 0,
        sceneMotionIndex: null,
        analyzableFrameRatio: 0,
        usableFrameCount: usable.length,
        sampledFrameCount,
        note: null,
    };

    if (sampledFrameCount === 0) {
        return { ...base, note: 'No video frames were sampled — the camera may have been off.' };
    }

    const { sceneMotionIndex } = { sceneMotionIndex: sceneMotion(usable) };

    if (usable.length < MIN_USABLE_FRAMES) {
        return {
            ...base,
            sceneMotionIndex,
            analyzableFrameRatio: 1 - base.cameraCoveredRatio,
            note:
                base.cameraCoveredRatio > COVERED_SIGNIFICANT_RATIO
                    ? 'The camera was obscured for most of this answer, so no image metrics could be measured.'
                    : 'Too few usable frames to measure image quality.',
        };
    }

    const frameBlurScore =
        usable.reduce((sum, frame) => sum + sharpnessScore(frame.laplacianVariance), 0) / usable.length;
    const exposure = usable.reduce((sum, frame) => sum + exposureScore(frame), 0) / usable.length;

    // Coverage is measured over the answer's duration, not over the frame count:
    // sampling ten frames in a five-second burst says nothing about the other
    // fifty-five seconds.
    const span = usable.length > 0
        ? Math.max(...usable.map((frame) => frame.tMs)) - Math.min(...usable.map((frame) => frame.tMs))
        : 0;
    const analyzableFrameRatio =
        answerDurationMs > 0 ? clamp(round3(span / answerDurationMs), 0, 1) : 0;

    return {
        frameBlurScore: round1(frameBlurScore),
        exposureScore: round1(exposure),
        cameraCoveredRatio: base.cameraCoveredRatio,
        sceneMotionIndex,
        analyzableFrameRatio,
        usableFrameCount: usable.length,
        sampledFrameCount,
        note: null,
    };
}

// --------------------------------------------
// The face-detector seam
// --------------------------------------------

export interface FaceSignals {
    /** Frames in which at least one face was found. */
    framesWithFace: number;
    /** Frames in which more than one face was found. */
    framesWithMultipleFaces: number;
    /** Frames analysed by the detector. */
    framesAnalyzed: number;
    /** Share of analysed frames with a face off-centre or turned away. */
    gazeOffRatio: number;
}

export interface FaceAnalysisResult {
    /**
     * False when no detector is present. Callers MUST check this and record the
     * metrics as unmeasured, never as zero.
     */
    available: boolean;
    /** Why it is unavailable, in words a person can read. */
    reason: string | null;
    signals: FaceSignals | null;
}

/**
 * The contract a real face/gaze detector must satisfy.
 *
 * Deliberately small, and deliberately allowed to say no. A detector that cannot
 * run must report `available: false`; a detector that is not sure must not report
 * a face. Anything else leaks a guess into a candidate's record.
 */
export interface FaceAnalyzer {
    readonly name: string;
    analyze: (frames: ImageDataLike[]) => Promise<FaceAnalysisResult>;
}

/** Minimal shape of the pixel data a detector needs, so this file stays DOM-free. */
export interface ImageDataLike {
    width: number;
    height: number;
    data: Uint8ClampedArray;
}

/**
 * The analyzer used when the browser provides no face detector.
 *
 * It exists so that "we did not measure this" is an explicit, typed outcome rather
 * than a zero that looks like a measurement. Chrome's `FaceDetector` is the only
 * built-in candidate and it is not available everywhere; where it is missing, the
 * honest output is a reason, and that is what this returns.
 */
export const UNAVAILABLE_FACE_ANALYZER: FaceAnalyzer = {
    name: 'unavailable',
    analyze: async () => ({
        available: false,
        reason:
            'This browser does not expose a face detector, so face presence and gaze were not measured. Nothing was estimated in their place.',
        signals: null,
    }),
};

// --------------------------------------------
// Small numeric helpers
// --------------------------------------------

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

function round3(value: number): number {
    return Math.round(value * 1000) / 1000;
}
