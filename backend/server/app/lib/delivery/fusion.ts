// ============================================
// fusion.ts — folding delivery evidence into the text-derived scores
// Feature 2 — Multimodal Delivery Analysis
// ============================================
//
// The scoring model currently reads `communication` and `confidence` out of a
// transcript. That is judging a singer from sheet music: you cannot hear
// hesitation, pace, or a monotone in text. This file adds the missing evidence.
//
// THREE DECISIONS THAT SHAPE EVERYTHING BELOW
//
// 1. DETERMINISTIC, NOT LLM-DRIVEN.
//    The obvious alternative is to send the metrics to a model and ask it to
//    rescore. That would be non-reproducible, unexplainable, and would make a
//    candidate's score depend on a sampling temperature. The roadmap's own
//    non-negotiable is that every score must be explainable to the person it
//    scores, so fusion is arithmetic: each metric contributes a bounded amount,
//    and the contribution is reported next to the value that produced it.
//
// 2. CAPPED, HARD.
//    Delivery can move a score by at most `MAX_ADJUSTMENT` points, in either
//    direction. A candidate must never fail an interview because they speak
//    slowly, have an accent, or paused to think. Content is what is being
//    measured; delivery is context for it.
//
// 3. IT REFUSES TO ACT ON THIN EVIDENCE.
//    If the microphone was muted, the answer was three seconds long, or only one
//    scorable metric was recovered, fusion returns `applied: false` with a reason
//    instead of adjusting on noise. An adjustment nobody can justify is worse
//    than no adjustment.
//
// This file is pure: metrics in, adjusted scores and an evidence trail out.

import {
    METRIC_REGISTRY,
    evaluateMetric,
    metricDefinition,
    scoringMetrics,
    type DeliveryDimension,
    type MetricEvaluation,
} from './contract';

/**
 * Most a delivery adjustment may move a score, in points on the 0–100 scale.
 *
 * Chosen to be visible but never decisive: it is under half a letter grade, and
 * well under the spread between a strong and a weak answer. A candidate whose
 * content scores 80 lands between 72 and 88 no matter how they spoke.
 */
export const MAX_ADJUSTMENT = 8;

/**
 * Fewer scorable metrics than this and no adjustment is made.
 *
 * With one metric, a single quirk — an unusually slow pace in a considered answer
 * — becomes the entire delivery verdict.
 */
export const MIN_SCORABLE_METRICS = 3;

/** Below this much speech, pacing metrics are not meaningful. */
export const MIN_SPEECH_MS_FOR_FUSION = 2000;

/** Metric values for one response. A key absent, null or non-finite is "not measured". */
export type MetricValues = Record<string, number | null | undefined>;

export interface DimensionAdjustment {
    dimension: DeliveryDimension;
    before: number;
    after: number;
    /** after − before, already clamped. */
    delta: number;
    /** Sum of contributions before the cap was applied, for transparency. */
    rawDelta: number;
    /** How much of the raw adjustment the cap removed. */
    cappedBy: number;
}

export interface FusionResult {
    /** False when delivery evidence was insufficient. `reason` then says why. */
    applied: boolean;
    /** Why no adjustment was made. Safe to show a person. */
    reason: string | null;
    communication: DimensionAdjustment;
    confidence: DimensionAdjustment;
    /** Every scorable metric, measured or not, with its contribution. */
    evidence: MetricEvaluation[];
    /** Keys that carry no measurement, so the UI can say so rather than show a zero. */
    unmeasured: string[];
    /**
     * Statements about the reliability of the evidence. Surfaced verbatim: if the
     * camera was covered, the candidate and the interviewer both deserve to know
     * that the video signals are absent.
     */
    caveats: string[];
}

export interface FusionInput {
    /** Text-derived scores, 0–100, before any delivery evidence. */
    communicationScore: number;
    confidenceScore: number;
    metrics: MetricValues;
    /** Whether the envelope contained any detected speech. */
    hasSpeech?: boolean;
    /** Total speech duration in ms, used to judge whether pacing is meaningful. */
    speechDurationMs?: number;
    /** Word count, used to judge whether a rate could be computed at all. */
    wordCount?: number;
    /** Share of the answer with usable video frames, for a coverage caveat. */
    analyzableFrameRatio?: number;
    /** Share of sampled frames with no usable image. */
    cameraCoveredRatio?: number;
}

/**
 * Folds delivery evidence into the two dimensions it can inform.
 *
 * Pure and total: any input, including nonsense, produces a result. When it cannot
 * justify an adjustment it says so rather than adjusting anyway.
 */
export function fuseDelivery(input: FusionInput): FusionResult {
    const communicationBefore = clampScore(input.communicationScore);
    const confidenceBefore = clampScore(input.confidenceScore);
    const caveats: string[] = [];

    // Coverage is read from the explicit fields when they are given, and
    // otherwise from the metric set itself. A caller who passes the full metrics
    // must not have to remember to repeat these two, or a camera that was
    // obscured for half the answer would go undisclosed — and an undisclosed
    // missing signal is exactly the failure this feature is built to avoid.
    const cameraCoveredRatio = input.cameraCoveredRatio ?? finite(input.metrics.cameraCoveredRatio);
    const analyzableFrameRatio = input.analyzableFrameRatio ?? finite(input.metrics.analyzableFrameRatio);

    const evidence: MetricEvaluation[] = [];
    const unmeasured: string[] = [];

    for (const definition of METRIC_REGISTRY) {
        const raw = input.metrics[definition.key];
        const measured = typeof raw === 'number' && Number.isFinite(raw);

        if (!measured) {
            unmeasured.push(definition.key);
            continue;
        }

        // Informational metrics are recorded and displayed, never scored, so they
        // are not evidence and do not appear in the evidence trail.
        if (definition.feeds === null) continue;

        evidence.push(evaluateMetric(definition, raw as number));
    }

    const scorable = evidence.filter((entry) => {
        const definition = metricDefinition(entry.key);
        return definition?.feeds !== null && entry.impact !== 0;
    });

    const blocked = insufficientEvidenceReason(input, scorable.length, unmeasured);
    if (blocked) {
        return {
            applied: false,
            reason: blocked,
            communication: noChange('communication', communicationBefore),
            confidence: noChange('confidence', confidenceBefore),
            evidence,
            unmeasured,
            caveats,
        };
    }

    if (cameraCoveredRatio !== undefined && cameraCoveredRatio >= 0.2) {
        caveats.push(
            `The camera was obscured for ${Math.round(cameraCoveredRatio * 100)}% of this answer, so no image-based signal was available.`
        );
    }
    if (analyzableFrameRatio !== undefined && analyzableFrameRatio > 0 && analyzableFrameRatio < 0.5) {
        caveats.push(
            `Usable frames covered only ${Math.round(analyzableFrameRatio * 100)}% of the answer, so the video signals are partial.`
        );
    }
    const communication = applyDimension('communication', communicationBefore, evidence);
    const confidence = applyDimension('confidence', confidenceBefore, evidence);

    return {
        applied: communication.delta !== 0 || confidence.delta !== 0,
        reason:
            communication.delta === 0 && confidence.delta === 0
                ? 'Delivery was measured and every metric sat inside its healthy range, so no adjustment was made.'
                : null,
        communication,
        confidence,
        evidence,
        unmeasured,
        caveats,
    };
}

// --------------------------------------------
// Internals
// --------------------------------------------

function noChange(dimension: DeliveryDimension, score: number): DimensionAdjustment {
    return { dimension, before: score, after: score, delta: 0, rawDelta: 0, cappedBy: 0 };
}

/**
 * Sums one dimension's contributions and applies the cap.
 *
 * The cap is applied to the sum rather than to each metric, so a candidate who is
 * slightly slow *and* slightly hedging is not penalised twice for a single
 * impression — which is what per-metric caps would do.
 */
function applyDimension(
    dimension: DeliveryDimension,
    before: number,
    evidence: MetricEvaluation[]
): DimensionAdjustment {
    const rawDelta = evidence
        .filter((entry) => metricDefinition(entry.key)?.feeds === dimension)
        .reduce((sum, entry) => sum + entry.impact, 0);

    const capped = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, rawDelta));
    const after = clampScore(before + capped);

    return {
        dimension,
        before,
        after: round1(after),
        delta: round1(after - before),
        rawDelta: round1(rawDelta),
        cappedBy: round1(Math.abs(rawDelta) - Math.abs(capped)),
    };
}

/**
 * Why no adjustment can be justified, or null when one can.
 *
 * Ordered from the most fundamental problem outward, so the reason a person reads
 * is the one that actually blocked it.
 */
function insufficientEvidenceReason(
    input: FusionInput,
    scorableCount: number,
    unmeasured: string[]
): string | null {
    if (input.hasSpeech === false) {
        return 'No speech was detected in this answer, so there was nothing to measure delivery from.';
    }
    if (
        input.speechDurationMs !== undefined &&
        input.speechDurationMs > 0 &&
        input.speechDurationMs < MIN_SPEECH_MS_FOR_FUSION
    ) {
        return 'The answer was too short to measure delivery from.';
    }
    if (input.wordCount !== undefined && input.wordCount <= 0) {
        return 'No transcript was captured, so pace and wording could not be measured.';
    }
    if (scorableCount < MIN_SCORABLE_METRICS) {
        const missing = unmeasured.slice(0, 4).join(', ');
        return `Only ${scorableCount} of the delivery signals could be measured, which is too few to justify changing a score${missing ? ` (missing: ${missing})` : ''}.`;
    }
    return null;
}

function clampScore(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, value));
}

/** A metric value, or undefined when it carries no measurement. */
function finite(value: number | null | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

// --------------------------------------------
// Presentation helpers for the evidence trail
// --------------------------------------------

/** Metrics that were measured and can move a score. */
export function impactMetrics(evidence: MetricEvaluation[]): MetricEvaluation[] {
    return evidence.filter((entry) => entry.impact !== 0);
}

/**
 * The single sentence to lead a candidate's delivery summary with.
 *
 * Names the largest contribution in either direction, because that is the one
 * thing worth changing, and returns a neutral sentence when nothing moved.
 */
export function headlineFor(result: FusionResult): string {
    const impacts = impactMetrics(result.evidence);
    if (impacts.length === 0) {
        return result.applied
            ? 'Delivery was measured and did not change your score.'
            : result.reason ?? 'Delivery was not measured for this answer.';
    }

    const largest = impacts.reduce((worst, entry) =>
        Math.abs(entry.impact) > Math.abs(worst.impact) ? entry : worst
    );
    const definition = metricDefinition(largest.key);
    if (!definition) return 'Delivery was measured.';
    return definition.advice || `${definition.label} was the largest contributor.`;
}

export { scoringMetrics };
