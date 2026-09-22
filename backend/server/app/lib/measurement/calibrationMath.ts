// ============================================
// calibrationMath.ts — Item calibration estimators
// Part of the Competency Measurement Engine (Feature 1)
//
// PURE MODULE. No DB, no network, no imports from the application.
//
// METHOD — moment estimates, not full MML/EM.
// The estimators below are closed-form approximations from classical test
// theory, chosen deliberately:
//   · no iterative optimiser and no new dependency
//   · they behave sensibly at the sample sizes this platform actually has
//     (tens to low hundreds of responses per item)
//   · full marginal-maximum-likelihood calibration only starts to outperform
//     them somewhere around a few hundred responses per item
// When the bank reaches that, replace `estimateItemParametersFromSamples` with an
// EM fit. The signature stays the same, so nothing else has to change. Until
// then, an honest approximation beats an unstable exact fit.
//
// CALIBRATION IS ADVISORY. Nothing here changes a candidate's stored scores; it
// only shapes which items get asked next.
// ============================================

import { inverseNormalCdf, normalPdf, type ItemParams } from './irt';

// --------------------------------------------
// Configuration
// --------------------------------------------

/**
 * The dimension a response must clear to count as "correct".
 *
 * The schema has no boolean correctness column — Response stores five 0-100
 * dimension scores and nothing else. So correctness is *operationalised* as
 * "scored at or above this threshold on the item's target dimension". 60 is a
 * pass mark, not a truth; it is exported and configurable so an operator can
 * move it and recalibrate, rather than having it buried in a comparison.
 */
export const CORRECTNESS_THRESHOLD = 60;

export interface DimensionScores {
    technicalScore: number;
    communicationScore: number;
    confidenceScore: number;
    logicScore: number;
    depthScore: number;
}

/** Dimension used to judge correctness, by question category (lowercased). */
const DIMENSION_BY_CATEGORY: Record<string, keyof DimensionScores> = {
    technical: 'technicalScore',
    coding: 'technicalScore',
    'system-design': 'technicalScore',
    behavioral: 'communicationScore',
    behavioural: 'communicationScore',
    communication: 'communicationScore',
    'problem-solving': 'logicScore',
    logic: 'logicScore',
    design: 'logicScore',
    depth: 'depthScore',
};

export const DEFAULT_DIMENSION: keyof DimensionScores = 'technicalScore';

/** Minimum responses before an item may be calibrated at all. */
export const MIN_SAMPLE_SIZE = 20;

/** Minimum responses before an item may be *retired* — a deliberately higher bar. */
export const MIN_SAMPLE_SIZE_FOR_RETIREMENT = 40;

/** Discrimination bounds. Below the floor an item cannot separate anyone. */
export const MIN_DISCRIMINATION = 0.3;
export const MAX_DISCRIMINATION = 2.5;
export const RETIREMENT_DISCRIMINATION = 0.15;

/** An item everyone passes (or everyone fails) measures nothing. */
export const CEILING_PROPORTION = 0.95;
export const FLOOR_PROPORTION = 0.05;

/** Guessing bounds — a 3PL lower asymptote outside this range is not credible. */
export const MIN_GUESSING = 0;
export const MAX_GUESSING = 0.35;
export const DEFAULT_GUESSING = 0.2;

/** Difficulty bounds, matching the ability scale the engine estimates on. */
export const MIN_DIFFICULTY = -3;
export const MAX_DIFFICULTY = 3;

/** Default discrimination for an item with no calibration data yet. */
export const DEFAULT_DISCRIMINATION = 1;

/**
 * Starting parameters for an uncalibrated item, derived from the legacy
 * `difficulty` label the platform already stores on every Question.
 *
 * This is the bridge between the old rule ladder and the measurement model: the
 * hand-assigned easy/medium/hard label becomes the *prior* for the item, and the
 * first real calibration replaces it with a measured value. Nothing is lost, and
 * the engine works on existing data from day one.
 */
export function itemParamsForDifficulty(difficulty: string | null | undefined): ItemParams {
    switch ((difficulty || '').toLowerCase()) {
        case 'easy':
            return { a: DEFAULT_DISCRIMINATION, b: -1, c: DEFAULT_GUESSING };
        case 'hard':
            return { a: DEFAULT_DISCRIMINATION, b: 1, c: DEFAULT_GUESSING };
        case 'medium':
        default:
            return { a: DEFAULT_DISCRIMINATION, b: 0, c: DEFAULT_GUESSING };
    }
}

/** Which dimension a category's correctness is judged on. */
export function dimensionForCategory(category: string | null | undefined): keyof DimensionScores {
    if (!category) return DEFAULT_DIMENSION;
    return DIMENSION_BY_CATEGORY[category.trim().toLowerCase()] ?? DEFAULT_DIMENSION;
}

/** Whether a response counts as correct for calibration purposes. */
export function deriveCorrectness(
    scores: DimensionScores,
    category: string | null | undefined,
    threshold: number = CORRECTNESS_THRESHOLD
): boolean {
    const value = scores[dimensionForCategory(category)];
    return typeof value === 'number' && value >= threshold;
}

// --------------------------------------------
// Pure estimation
// --------------------------------------------

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/** One response reduced to what calibration needs. */
export interface CalibrationSample {
    /** Whether the response cleared the correctness threshold. */
    correct: boolean;
    /** Sum of the same dimension over the *other* responses in the session. */
    restScore: number;
}

export interface ItemCalibrationResult {
    a: number;
    b: number;
    c: number;
    sampleSize: number;
    proportionCorrect: number;
    /** Point-biserial correlation with the rest score, kept for reporting. */
    discrimination: number;
    isRetired: boolean;
    retiredReason: string | null;
}

/**
 * Point-biserial correlation between item correctness and rest score:
 *
 *   r_pb = (M₁ - M₀) / s · √( p(1-p) )
 *
 * where M₁/M₀ are the mean rest scores of those who passed and failed, s is the
 * population SD of the rest score, and p is the proportion correct.
 *
 * Returns 0 when there is no variance to correlate against — an item answered by
 * a group that all scored identically tells us nothing about discrimination, and
 * returning 0 (rather than NaN) lets the caller's clamping path handle it.
 */
export function pointBiserial(samples: CalibrationSample[]): number {
    const n = samples.length;
    if (n < 2) return 0;

    const correct = samples.filter((s) => s.correct);
    const incorrect = samples.filter((s) => !s.correct);
    if (correct.length === 0 || incorrect.length === 0) return 0;

    const p = correct.length / n;
    const meanAll = samples.reduce((sum, row) => sum + row.restScore, 0) / n;
    const variance = samples.reduce((sum, row) => sum + (row.restScore - meanAll) ** 2, 0) / n;
    const sd = Math.sqrt(variance);

    if (sd <= 0) return 0;

    const meanCorrect = correct.reduce((sum, row) => sum + row.restScore, 0) / correct.length;
    const meanIncorrect = incorrect.reduce((sum, row) => sum + row.restScore, 0) / incorrect.length;

    return ((meanCorrect - meanIncorrect) / sd) * Math.sqrt(p * (1 - p));
}

/**
 * Converts a point-biserial correlation into a discrimination parameter.
 *
 * Two standard steps:
 *  1. Point-biserial → biserial, correcting for the artificial dichotomisation
 *     of correctness:  r_bis = r_pb · √(p(1-p)) / φ(z),  z = Φ⁻¹(p).
 *  2. Biserial → 2PL discrimination. Under a normal ability distribution
 *     r_bis = a/√(1+a²), so a = r_bis/√(1-r_bis²).
 *
 * Degenerate inputs (p at 0 or 1, or |r| at 1) return the default discrimination
 * rather than an infinity; the caller clamps the result into range.
 */
export function biserialToDiscrimination(
    pointBiserialValue: number,
    proportionCorrect: number
): number {
    const p = clamp(proportionCorrect, 0.001, 0.999);
    const z = inverseNormalCdf(p);
    const ordinate = normalPdf(z);

    if (!Number.isFinite(ordinate) || ordinate <= 1e-12) return DEFAULT_DISCRIMINATION;

    const biserial = (pointBiserialValue * Math.sqrt(p * (1 - p))) / ordinate;
    const bounded = clamp(biserial, -0.999, 0.999);
    const discrimination = bounded / Math.sqrt(1 - bounded * bounded);

    if (!Number.isFinite(discrimination)) return DEFAULT_DISCRIMINATION;
    return clamp(discrimination, MIN_DISCRIMINATION, MAX_DISCRIMINATION);
}

/**
 * Converts a proportion-correct into an item difficulty.
 *
 * Under a standard-normal ability distribution the marginal probability of a
 * correct response to a 2PL item is
 *
 *   p ≈ Φ( -a·b / √(1 + a²) )     ⇒     b = -Φ⁻¹(p) · √(1 + a²) / a
 *
 * The √(1+a²) term corrects for ability varying across the population. Dropping
 * it (the common shortcut b = -Φ⁻¹(p)/a) systematically overstates difficulty for
 * high-discrimination items, so it is kept.
 */
export function proportionToDifficulty(proportionCorrect: number, discrimination: number): number {
    const p = clamp(proportionCorrect, 0.001, 0.999);
    const a = clamp(discrimination, MIN_DISCRIMINATION, MAX_DISCRIMINATION);

    const z = inverseNormalCdf(p);
    const difficulty = (-z * Math.sqrt(1 + a * a)) / a;

    if (!Number.isFinite(difficulty)) return 0;
    return clamp(difficulty, MIN_DIFFICULTY, MAX_DIFFICULTY);
}

/**
 * Estimates the guessing parameter from the weakest respondents.
 *
 * The lower asymptote is the probability that a candidate with very low ability
 * still answers correctly — in practice, a guess. The cleanest available proxy is
 * the proportion correct among the lowest-scoring quartile: for those candidates
 * the model expects P(θ) ≈ c.
 *
 * Clamped to [0, 0.35]. A four-option multiple choice has c ≈ 0.25, so anything
 * above 0.35 is far more likely to be a bad item than genuine guessing.
 */
export function estimateGuessing(samples: CalibrationSample[]): number {
    if (samples.length < 8) return DEFAULT_GUESSING;

    const sorted = [...samples].sort((x, y) => x.restScore - y.restScore);
    const quartileSize = Math.max(1, Math.floor(sorted.length / 4));
    const lowest = sorted.slice(0, quartileSize);

    const proportion = lowest.filter((s) => s.correct).length / lowest.length;
    return clamp(proportion, MIN_GUESSING, MAX_GUESSING);
}

/**
 * The retirement rule.
 *
 * An item is retired — skipped by selection, but never deleted, so its historical
 * responses stay valid — when there is enough evidence it cannot measure anything:
 *
 *   · discrimination below RETIREMENT_DISCRIMINATION: strong and weak candidates
 *     do equally well on it. Statistically useless.
 *   · everybody passes (p > 0.95) or everybody fails (p < 0.05): no variance, no
 *     information, regardless of what the correlation says.
 *
 * Requires MIN_SAMPLE_SIZE_FOR_RETIREMENT, a deliberately higher bar than plain
 * calibration — retiring on thin evidence would silently shrink the bank.
 */
export function shouldRetire(input: {
    sampleSize: number;
    discrimination: number;
    proportionCorrect: number;
}): { isRetired: boolean; retiredReason: string | null } {
    if (input.sampleSize < MIN_SAMPLE_SIZE_FOR_RETIREMENT) {
        return { isRetired: false, retiredReason: null };
    }

    if (input.discrimination < RETIREMENT_DISCRIMINATION) {
        return {
            isRetired: true,
            retiredReason: `discrimination ${input.discrimination.toFixed(3)} below ${RETIREMENT_DISCRIMINATION}`,
        };
    }

    if (input.proportionCorrect > CEILING_PROPORTION) {
        return {
            isRetired: true,
            retiredReason: `ceiling item: ${(input.proportionCorrect * 100).toFixed(1)}% correct`,
        };
    }

    if (input.proportionCorrect < FLOOR_PROPORTION) {
        return {
            isRetired: true,
            retiredReason: `floor item: ${(input.proportionCorrect * 100).toFixed(1)}% correct`,
        };
    }

    return { isRetired: false, retiredReason: null };
}

/**
 * Estimates all three parameters from a set of samples.
 *
 * Order matters: guessing first (from the low-ability quartile), discrimination
 * second (from the rest-score correlation), difficulty last — its correction term
 * depends on discrimination.
 *
 * Items below MIN_SAMPLE_SIZE are not estimated at all; the caller keeps the
 * item's existing or default parameters. Returns null rather than a fabricated
 * fit.
 */
export function estimateItemParametersFromSamples(
    samples: CalibrationSample[]
): ItemCalibrationResult | null {
    const n = samples.length;
    if (n < MIN_SAMPLE_SIZE) return null;

    const proportionCorrect = samples.filter((s) => s.correct).length / n;
    const guessing = estimateGuessing(samples);
    const discrimination = pointBiserial(samples);
    const a = biserialToDiscrimination(discrimination, proportionCorrect);
    const b = proportionToDifficulty(proportionCorrect, a);

    const { isRetired, retiredReason } = shouldRetire({
        sampleSize: n,
        discrimination,
        proportionCorrect,
    });

    return {
        a,
        b,
        c: guessing,
        sampleSize: n,
        proportionCorrect,
        discrimination,
        isRetired,
        retiredReason,
    };
}
