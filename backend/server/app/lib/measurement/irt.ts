// ============================================
// irt.ts — Item Response Theory primitives
// Part of the Competency Measurement Engine (Feature 1)
//
// PURE MODULE. No DB, no network, no imports from the application. Everything
// here is a deterministic function of its arguments so the measurement core can
// be reasoned about and tested in isolation.
//
// Model: 3-parameter logistic (3PL). Each item i is described by
//   a  discrimination — how sharply the item separates ability levels
//   b  difficulty     — the ability level where the item is "half solved"
//   c  guessing       — the lower asymptote (chance floor)
//
//   P_i(θ) = c_i + (1 - c_i) / (1 + exp(-a_i (θ - b_i)))
//
// Ability θ is on the logit scale: 0 is the population mean, and roughly
// [-3, 3] covers almost everyone. Setting a=1, c=0 degenerates to the Rasch
// model; c=0 with free a is 2PL. Those cases are supported and tested.
// ============================================

// --------------------------------------------
// Bounds and defaults
// --------------------------------------------

/** Ability is never estimated outside this range. Keeps Newton steps honest. */
export const ABILITY_MIN = -4;
export const ABILITY_MAX = 4;

/** Standard deviation of the N(0, σ²) prior used for MAP estimation. */
export const PRIOR_SD = 1;

/** Reported standard error is clamped to this range. */
export const MIN_STANDARD_ERROR = 0.05;
export const MAX_STANDARD_ERROR = 4;

/** Default target SE for the adaptive stop rule (~0.35 ⇒ reliability ≈ 0.88). */
export const DEFAULT_TARGET_SE = 0.35;

/** Numerical guards. */
const PROB_EPSILON = 1e-9;
const MAX_ITERATIONS = 100;
const CONVERGENCE_TOLERANCE = 1e-6;

// --------------------------------------------
// Types
// --------------------------------------------

/** Parameters of a single item under the 3PL model. */
export interface ItemParams {
    a: number;
    b: number;
    c: number;
}

/** One scored response: which item was answered, and whether it was correct. */
export interface ScoredResponse {
    item: ItemParams;
    correct: boolean;
}

export interface AbilityEstimateResult {
    /** Estimated ability on the logit scale. */
    theta: number;
    /** Standard error of theta. Large ⇒ the estimate is not yet a claim. */
    standardError: number;
    /** Fisher information of the response pattern at theta. */
    information: number;
    /** 1 - SE² — proportion of variance in the estimate that is signal. */
    reliability: number;
    iterations: number;
    converged: boolean;
    /** 'prior' when no responses were supplied, else 'map'. */
    method: 'map' | 'prior';
}

export interface EstimateOptions {
    /** Prior standard deviation. Larger ⇒ weaker prior, closer to raw MLE. */
    priorSd?: number;
    /** Starting value for the iteration. Defaults to 0 with an adaptive pull. */
    initialTheta?: number;
    maxIterations?: number;
    tolerance?: number;
}

// --------------------------------------------
// Item response function and information
// --------------------------------------------

/** Clamps a probability away from exactly 0 or 1 so logs stay finite. */
function clampProbability(p: number): number {
    return Math.min(1 - PROB_EPSILON, Math.max(PROB_EPSILON, p));
}

/** Theoretical guessing floor is never 1 (that would make the item unanswerable). */
function safeGuessing(c: number): number {
    if (!Number.isFinite(c)) return 0;
    return Math.min(0.99, Math.max(0, c));
}

/**
 * Probability of a correct response at ability `theta` under the 3PL model.
 *
 *   P(θ) = c + (1 - c) / (1 + exp(-a(θ - b)))
 */
export function probabilityCorrect(theta: number, item: ItemParams): number {
    const c = safeGuessing(item.c);
    const a = Number.isFinite(item.a) ? item.a : 1;
    const b = Number.isFinite(item.b) ? item.b : 0;
    const exponent = -a * (theta - b);

    // Guard the exponential against overflow for extreme a*(θ-b).
    if (exponent > 700) return c;                 // logistic term → 0
    if (exponent < -700) return 1 - PROB_EPSILON; // logistic term → 1

    const logistic = 1 / (1 + Math.exp(exponent));
    return c + (1 - c) * logistic;
}

/**
 * Fisher information an item provides about ability at `theta` (3PL):
 *
 *   I(θ) = a² · (P(θ) - c)² · (1 - P(θ)) / ( P(θ) · (1 - c)² )
 *
 * This is the quantity adaptive testing maximises: the item chosen next is the
 * one with the highest information at the candidate's current estimate, because
 * that is the item whose answer will move the estimate (or shrink its error) most.
 *
 * With c = 0 it reduces to the familiar 2PL form a² P (1 - P), and it is always
 * zero at θ → ±∞: an item tells you nothing about someone far outside its range.
 */
export function itemInformation(theta: number, item: ItemParams): number {
    const c = safeGuessing(item.c);
    const a = Number.isFinite(item.a) ? item.a : 1;
    const p = probabilityCorrect(theta, item);
    const oneMinusC = 1 - c;

    if (oneMinusC <= 0) return 0;

    const numerator = a * a * (p - c) * (p - c) * (1 - p);
    const denominator = p * oneMinusC * oneMinusC;
    const info = numerator / denominator;

    return Number.isFinite(info) && info > 0 ? info : 0;
}

/** Total information a set of items provides at `theta` — the test information function. */
export function testInformation(theta: number, items: ItemParams[]): number {
    let total = 0;
    for (const item of items) total += itemInformation(theta, item);
    return total;
}

// --------------------------------------------
// Likelihood and its derivative
// --------------------------------------------

/**
 * Log-likelihood of a response pattern at `theta`, plus the log-prior.
 * Returns -Infinity for an impossible pattern (guards against NaN propagation).
 */
export function logLikelihood(theta: number, responses: ScoredResponse[]): number {
    let total = 0;
    for (const { item, correct } of responses) {
        const p = clampProbability(probabilityCorrect(theta, item));
        total += correct ? Math.log(p) : Math.log(1 - p);
        if (!Number.isFinite(total)) return -Infinity;
    }
    return total;
}

/**
 * Score function (first derivative of the log-likelihood):
 *
 *   L'(θ) = Σ a_i · (P_i - c_i) / (1 - c_i) · [ u_i/P_i - (1 - u_i)/(1 - P_i) ]
 *
 * where u_i is 1 for a correct response and 0 otherwise.
 */
export function scoreFunction(theta: number, responses: ScoredResponse[]): number {
    let total = 0;
    for (const { item, correct } of responses) {
        const c = safeGuessing(item.c);
        const a = Number.isFinite(item.a) ? item.a : 1;
        const oneMinusC = 1 - c;
        if (oneMinusC <= 0) continue;

        const p = clampProbability(probabilityCorrect(theta, item));
        const u = correct ? 1 : 0;
        const bracket = u / p - (1 - u) / (1 - p);
        total += (a * (p - c) * bracket) / oneMinusC;
    }
    return total;
}

// --------------------------------------------
// Ability estimation
// --------------------------------------------

/**
 * Estimates ability θ and its standard error from a response pattern.
 *
 * Method: maximum a posteriori (MAP) with an N(0, priorSd²) prior, solved by
 * Fisher scoring — Newton-Raphson on the expected information:
 *
 *   θ_{k+1} = θ_k + ( L'(θ_k) - θ_k/σ² ) / ( I(θ_k) + 1/σ² )
 *
 * **Why a prior instead of plain maximum likelihood?** A perfect or all-wrong
 * pattern has no finite MLE — the likelihood increases forever as θ → ±∞, so
 * the iteration would run away. The prior pulls those cases back to a finite,
 * defensible estimate. This is the same reason real adaptive tests report a
 * bounded score for a candidate who aces every item, rather than "infinity".
 *
 * A step-halving line search keeps the iteration from overshooting.
 *
 * With no responses, returns the prior: θ = 0, SE = priorSd.
 *
 * @returns theta, its standard error, the information, and convergence metadata.
 */
export function estimateAbility(
    responses: ScoredResponse[],
    options: EstimateOptions = {}
): AbilityEstimateResult {
    const priorSd = options.priorSd && options.priorSd > 0 ? options.priorSd : PRIOR_SD;
    const priorPrecision = 1 / (priorSd * priorSd);
    const maxIterations = options.maxIterations ?? MAX_ITERATIONS;
    const tolerance = options.tolerance ?? CONVERGENCE_TOLERANCE;

    // No evidence ⇒ report the prior rather than a fabricated number.
    if (responses.length === 0) {
        return {
            theta: 0,
            standardError: priorSd,
            information: 0,
            reliability: 0,
            iterations: 0,
            converged: true,
            method: 'prior',
        };
    }

    const items = responses.map((r) => r.item);

    // Start at the prior mean, or at a coarse moment estimate that speeds
    // convergence for lopsided patterns.
    let theta = options.initialTheta ?? startingTheta(responses);
    let iterations = 0;
    let converged = false;

    for (let i = 0; i < maxIterations; i += 1) {
        iterations = i + 1;

        const gradient = scoreFunction(theta, responses) - theta * priorPrecision;
        const information = testInformation(theta, items) + priorPrecision;

        if (!Number.isFinite(gradient) || !Number.isFinite(information) || information <= 0) {
            break;
        }

        const step = gradient / information;
        let candidate = theta + step;

        // Line search: halve the step until the log-posterior does not decrease
        // and we stay inside the ability bounds.
        let halvings = 0;
        while (
            halvings < 20 &&
            (candidate < ABILITY_MIN ||
                candidate > ABILITY_MAX ||
                logPosterior(candidate, responses, priorSd) < logPosterior(theta, responses, priorSd))
        ) {
            candidate = theta + step / Math.pow(2, halvings + 1);
            halvings += 1;
        }

        candidate = Math.min(ABILITY_MAX, Math.max(ABILITY_MIN, candidate));

        const delta = Math.abs(candidate - theta);
        theta = candidate;

        if (delta < tolerance) {
            converged = true;
            break;
        }
    }

    // Report SE from the likelihood alone (the standard convention): the prior
    // bounds the estimate, but it should not be allowed to shrink reported error.
    const information = testInformation(theta, items);
    const rawSe = information > 0 ? 1 / Math.sqrt(information) : MAX_STANDARD_ERROR;
    const standardError = Math.min(MAX_STANDARD_ERROR, Math.max(MIN_STANDARD_ERROR, rawSe));

    return {
        theta,
        standardError,
        information,
        reliability: reliabilityFromSE(standardError),
        iterations,
        converged,
        method: 'map',
    };
}

/** Log-posterior, used as the objective for the step-halving line search. */
function logPosterior(theta: number, responses: ScoredResponse[], priorSd: number): number {
    const ll = logLikelihood(theta, responses);
    if (!Number.isFinite(ll)) return -Infinity;
    return ll - (theta * theta) / (2 * priorSd * priorSd);
}

/**
 * A cheap starting point: the ability that best matches the raw proportion
 * correct, translated through the average item difficulty. Converges faster
 * than starting every pattern at 0 and costs nothing.
 */
function startingTheta(responses: ScoredResponse[]): number {
    let correct = 0;
    let difficultySum = 0;

    for (const { item, correct: isCorrect } of responses) {
        if (isCorrect) correct += 1;
        difficultySum += Number.isFinite(item.b) ? item.b : 0;
    }

    const proportion = correct / responses.length;
    const meanDifficulty = difficultySum / responses.length;

    // Nudge away from 0/1 where the inverse-normal blows up.
    const p = Math.min(0.95, Math.max(0.05, proportion));
    const shift = p - 0.5;
    const approx = meanDifficulty + shift * 2;

    return Math.min(ABILITY_MAX, Math.max(ABILITY_MIN, approx));
}

// --------------------------------------------
// Derived measures
// --------------------------------------------

/**
 * Marginal reliability of an estimate: ρ = 1 - SE².

 * This is directly interpretable as the proportion of observed variance that is
 * true ability rather than measurement noise — the standard reliability index,
 * and the number to quote if asked "how good is this measurement?".
 */
export function reliabilityFromSE(standardError: number): number {
    const value = 1 - standardError * standardError;
    return Math.min(1, Math.max(0, value));
}

/**
 * Converts θ to a 0–100 scale score (a T-score: mean 50, SD 10).
 *
 * Display-only. Never compute with scale scores — they are a linear
 * transformation of θ and carry exactly the same information, minus the
 * interpretability of "0 = average".
 */
export function thetaToScaleScore(theta: number): number {
    const scaled = 50 + 10 * theta;
    return Math.round(Math.min(100, Math.max(0, scaled)) * 10) / 10;
}

/** Inverse of {@link thetaToScaleScore}. */
export function scaleScoreToTheta(scaleScore: number): number {
    return (scaleScore - 50) / 10;
}

/**
 * Confidence interval for θ at the given confidence level (default 95%).
 * Reported as [low, high] on the logit scale, clamped to the ability bounds.
 */
export function confidenceInterval(
    theta: number,
    standardError: number,
    confidence = 0.95
): { low: number; high: number } {
    const z = inverseNormalCdf(1 - (1 - confidence) / 2);
    const margin = z * standardError;

    return {
        low: Math.max(ABILITY_MIN, theta - margin),
        high: Math.min(ABILITY_MAX, theta + margin),
    };
}

/**
 * True when the estimate is precise enough to act on, by the same target the
 * adaptive stop rule uses. Callers should surface this rather than presenting
 * every estimate with equal authority.
 */
export function isPreciseEnough(
    standardError: number,
    targetSe: number = DEFAULT_TARGET_SE
): boolean {
    return standardError <= targetSe;
}

/**
 * Expected number of additional items needed to reach `targetSe`, given the
 * information already collected and an assumed per-item information. Used to
 * tell a candidate "about 4 more questions for a stable result".
 */
export function estimatedRemainingItems(
    currentStandardError: number,
    averageItemInformation: number,
    targetSe: number = DEFAULT_TARGET_SE
): number {
    if (averageItemInformation <= 0) return Number.POSITIVE_INFINITY;
    if (currentStandardError <= targetSe) return 0;

    const neededInformation = 1 / (targetSe * targetSe);
    const currentInformation = 1 / (currentStandardError * currentStandardError);
    const remaining = (neededInformation - currentInformation) / averageItemInformation;

    return Math.max(0, Math.ceil(remaining));
}

// --------------------------------------------
// Normal distribution helpers
// --------------------------------------------
// Used by calibration (mapping a proportion-correct to a difficulty) and by
// confidence intervals. Kept here because they are pure math with no other home.

/** Standard normal density. */
export function normalPdf(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Chebyshev coefficients for the complementary error function (Numerical
// Recipes, 3rd ed., erfccheb). 28 terms give ~1e-16 relative accuracy in double
// precision — which matters here because inverseNormalCdf's Halley refinement
// can only ever be as accurate as the CDF it refines against.
const ERFC_COEFFICIENTS = [
    -1.3026537197817094, 6.4196979235649026e-1, 1.9476473204185836e-2,
    -9.561514786808631e-3, -9.46595344482036e-4, 3.66839497852761e-4,
    4.2523324806907e-5, -2.0278578112534e-5, -1.624290004647e-6,
    1.30365583558e-6, 1.5626441722e-8, -8.5238095915e-8, 6.529054439e-9,
    5.059343495e-9, -9.91364156e-10, -2.27365122e-10, 9.6467911e-11,
    2.394038e-12, -6.886027e-12, 8.94487e-13, 3.13092e-13, -1.12708e-13,
    3.81e-16, 7.106e-15, -1.523e-15, -9.4e-17, 1.21e-16, -2.8e-17,
];

/** Complementary error function for z ≥ 0, via a Chebyshev expansion. */
function erfcChebyshev(z: number): number {
    const t = 2 / (2 + z);
    const ty = 4 * t - 2;

    let d = 0;
    let dd = 0;
    for (let j = ERFC_COEFFICIENTS.length - 1; j > 0; j -= 1) {
        const tmp = d;
        d = ty * d - dd + ERFC_COEFFICIENTS[j];
        dd = tmp;
    }

    return t * Math.exp(-z * z + 0.5 * (ERFC_COEFFICIENTS[0] + ty * d) - dd);
}

/** Complementary error function, valid across the real line. */
export function erfc(x: number): number {
    return x >= 0 ? erfcChebyshev(x) : 2 - erfcChebyshev(-x);
}

/**
 * Standard normal CDF, Φ(x) = erfc(-x/√2) / 2.
 *
 * Accurate to roughly 1e-15 in double precision. The accuracy is load-bearing:
 * calibration inverts this function to turn a proportion-correct into an item
 * difficulty, so an approximation error here would silently bias every
 * calibrated b parameter.
 */
export function normalCdf(x: number): number {
    if (x === Infinity) return 1;
    if (x === -Infinity) return 0;
    return 0.5 * erfc(-x / Math.SQRT2);
}

/**
 * Inverse standard normal CDF (quantile function), via Acklam's rational
 * approximation refined by one Halley step. Relative error ~1e-15, which is why
 * it is preferred over a lookup table for calibration thresholds.
 *
 * @param p probability in (0, 1)
 */
export function inverseNormalCdf(p: number): number {
    if (!(p > 0 && p < 1)) {
        if (p <= 0) return -Infinity;
        if (p >= 1) return Infinity;
        return NaN;
    }

    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

    const pLow = 0.02425;
    const pHigh = 1 - pLow;

    let x: number;

    if (p < pLow) {
        const q = Math.sqrt(-2 * Math.log(p));
        x =
            (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= pHigh) {
        const q = p - 0.5;
        const r = q * q;
        x =
            ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
            (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
        const q = Math.sqrt(-2 * Math.log(1 - p));
        x =
            -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }

    // One Halley refinement step.
    const e = normalCdf(x) - p;
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
    return x - u / (1 + (x * u) / 2);
}
