// ============================================
// contract.ts — the delivery metric registry
// Feature 2 — Multimodal Delivery Analysis
// ============================================
//
// One source of truth for every delivery signal: what it is called, what unit it
// is in, which scoring dimension it is evidence about, and — critically — what a
// good value looks like.
//
// WHY A REGISTRY AND NOT JUST CONSTANTS IN THE EXTRACTORS
//
// Three different consumers need to agree on "what is a good speaking rate":
//
//   1. the fusion layer, which turns a value into a bounded score adjustment
//   2. the candidate's timeline UI, which has to show a bar and say whether the
//      value sits inside the healthy band
//   3. the interviewer's evidence view, which says which metrics moved the score
//
// If those three drifted apart, the platform would tell a candidate their pace
// was fine while quietly penalising it. So the band lives here, once, and
// `evaluateMetric()` below is the only function that interprets it.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO
//
// It does not judge the person. Every band is a *communication* norm, not a
// competence norm, and the fusion layer caps how much any of it can move a score.
// A speaking rate is evidence about how something was said, and the platform
// must never fail someone on the way they talk.

/** Scoring dimensions delivery evidence can inform. Content dimensions are absent on purpose. */
export type DeliveryDimension = 'communication' | 'confidence';

export type MetricUnit =
    | 'wpm'
    | 'ratio'
    | 'count'
    | 'per100words'
    | 'ms'
    | 'index'
    | 'score';

/**
 * How to read a value.
 *
 *  · `band`          — there is a healthy range; too low and too high are both off
 *  · `lower-better`  — less of it is better past a threshold
 *  · `higher-better` — more of it is better past a threshold
 *  · `informational` — recorded and displayed, never scored
 */
export type MetricShape = 'band' | 'lower-better' | 'higher-better' | 'informational';

export interface MetricDefinition {
    key: string;
    label: string;
    unit: MetricUnit;
    /** The dimension this metric is evidence about, or null when it informs none. */
    feeds: DeliveryDimension | null;
    shape: MetricShape;
    /**
     * For `band`: the healthy interval [low, high].
     * For `lower-better` / `higher-better`: [threshold, threshold] where the
     * threshold is where the penalty starts.
     */
    band: [number, number];
    /**
     * How far outside the band before the contribution is fully realised.
     * Expressed in the metric's own unit, so a rate gets a wide margin and a
     * ratio a narrow one.
     */
    tolerance: number;
    /** Largest score adjustment this metric may contribute, in points (0-100 scale). */
    maxImpact: number;
    /** One sentence a candidate can act on. Shown in the UI, so it must be plain. */
    advice: string;
    description: string;
}

/**
 * The registry.
 *
 * Filler and hedge lists are defined in `lexicalMath.ts`; the ambiguity decisions
 * for those words are documented there, because they are linguistic judgements
 * rather than measurement ones.
 */
export const METRIC_REGISTRY: readonly MetricDefinition[] = [
    // ── Audio: pacing and fluency → communication ────────────────────────────
    {
        key: 'speakingRateWpm',
        label: 'Speaking rate',
        unit: 'wpm',
        feeds: 'communication',
        shape: 'band',
        // 110–160 WPM is the range interviewers rate most favourably. Wide
        // tolerance because a considered answer is legitimately slower and
        // technical vocabulary legitimately faster.
        band: [110, 160],
        tolerance: 60,
        maxImpact: 4,
        advice: 'Aim for roughly 110–160 words a minute. Beyond that, listeners lose the thread.',
        description: 'Words per minute, measured over speech time only — pauses are excluded.',
    },
    {
        key: 'fillerRate',
        label: 'Filler words',
        unit: 'per100words',
        feeds: 'communication',
        shape: 'lower-better',
        band: [3, 3],
        tolerance: 7,
        maxImpact: 5,
        advice: 'Replace "um" and "you know" with a short silence. A pause reads as thinking; a filler reads as uncertainty.',
        description: 'Unambiguous filler words per 100 words. "Like" and "actually" are excluded — see lexicalMath.',
    },
    {
        key: 'pauseCount',
        label: 'Long pauses',
        unit: 'count',
        feeds: 'confidence',
        shape: 'lower-better',
        band: [2, 2],
        tolerance: 6,
        maxImpact: 3,
        advice: 'A few deliberate pauses are good; many long ones suggest you were searching for the answer.',
        description: 'Silences of 700ms or more inside an answer.',
    },
    {
        key: 'longestPauseMs',
        label: 'Longest pause',
        unit: 'ms',
        feeds: 'confidence',
        shape: 'lower-better',
        band: [2500, 2500],
        tolerance: 6000,
        maxImpact: 3,
        advice: 'When you need time, say so — "let me think about that for a second" is stronger than silence.',
        description: 'The longest single silence inside an answer.',
    },
    {
        key: 'answerLatencyMs',
        label: 'Time to start',
        unit: 'ms',
        feeds: 'confidence',
        shape: 'lower-better',
        band: [3000, 3000],
        tolerance: 6000,
        maxImpact: 3,
        advice: 'Answering immediately is not always better — but a very long silence before starting reads as hesitation.',
        description: 'From the question ending to your first word.',
    },

    // ── Audio: vocal character → confidence ──────────────────────────────────
    {
        key: 'energyVariation',
        label: 'Vocal variation',
        unit: 'index',
        feeds: 'confidence',
        shape: 'band',
        // Too flat is monotone; too wild is uncontrolled. The healthy middle is
        // wide, because normal emphatic speech spans a lot of dynamic range.
        band: [0.12, 0.65],
        tolerance: 0.3,
        maxImpact: 3,
        advice: 'Vary your emphasis. A completely even delivery is harder to follow than one with some rise and fall.',
        description: 'Coefficient of variation of vocal energy across the answer. Low means flat, high means erratic.',
    },
    {
        key: 'silentRatio',
        label: 'Silence share',
        unit: 'ratio',
        feeds: 'communication',
        shape: 'lower-better',
        band: [0.25, 0.25],
        tolerance: 0.4,
        maxImpact: 3,
        advice: 'Most of your answer time should be speech. If it is not, the answer may be shorter than it sounds.',
        description: 'Share of the answer that was silence rather than speech.',
    },
    {
        key: 'hedgeRate',
        label: 'Hedging',
        unit: 'per100words',
        feeds: 'confidence',
        shape: 'lower-better',
        band: [2, 2],
        tolerance: 6,
        maxImpact: 4,
        advice: 'Hedges like "kind of" and "I guess" weaken an answer you actually know. State it, then note the caveat.',
        description: 'Hedging phrases per 100 words. "I think" is excluded — it is too common to be diagnostic.',
    },

    // ── Video: conditions and motion ─────────────────────────────────────────
    {
        key: 'frameBlurScore',
        label: 'Image sharpness',
        unit: 'score',
        feeds: null,
        shape: 'informational',
        band: [0, 0],
        tolerance: 0,
        maxImpact: 0,
        advice: 'A sharper picture lets the delivery analysis see more. Check lighting and focus.',
        description: 'Sharpness of sampled frames. Recorded for data validity — a blurry video produces delivery metrics you should trust less.',
    },
    {
        key: 'exposureScore',
        label: 'Lighting',
        unit: 'score',
        feeds: null,
        shape: 'informational',
        band: [0, 0],
        tolerance: 0,
        maxImpact: 0,
        advice: 'Face a light source rather than sitting with a window behind you.',
        description: 'How well exposed sampled frames are. Recorded for data validity.',
    },
    {
        key: 'cameraCoveredRatio',
        label: 'Camera obscured',
        unit: 'ratio',
        feeds: null,
        shape: 'informational',
        band: [0, 0],
        tolerance: 0,
        maxImpact: 0,
        advice: 'Keep the camera uncovered so the session records normally.',
        description: 'Share of sampled frames with no usable image — a covered lens, or a camera that is off.',
    },
    {
        key: 'sceneMotionIndex',
        label: 'On-screen movement',
        unit: 'index',
        feeds: null,
        shape: 'informational',
        band: [0, 0],
        tolerance: 0,
        maxImpact: 0,
        advice: '',
        description: 'How much the image changed between samples. This is image-space motion, not head pose — it cannot tell a nod from a hand moving, so it informs nothing and moves no score.',
    },
    {
        key: 'analyzableFrameRatio',
        label: 'Frames analysed',
        unit: 'ratio',
        feeds: null,
        shape: 'informational',
        band: [0, 0],
        tolerance: 0,
        maxImpact: 0,
        advice: '',
        description: 'Share of the session for which usable frames were captured. Low values make every video-derived number less trustworthy.',
    },
] as const;

const BY_KEY = new Map(METRIC_REGISTRY.map((definition) => [definition.key, definition]));

export function metricDefinition(key: string): MetricDefinition | undefined {
    return BY_KEY.get(key);
}

/** Metrics that can actually move a score. Used by fusion and by the evidence UI. */
export function scoringMetrics(): MetricDefinition[] {
    return METRIC_REGISTRY.filter((definition) => definition.feeds !== null && definition.maxImpact > 0);
}

// --------------------------------------------
// Interpreting a value
// --------------------------------------------

export interface MetricEvaluation {
    key: string;
    value: number;
    /** −1 (fully against) … +1 (fully in favour). 0 when inside the healthy band. */
    position: number;
    /** Points this metric contributes. Zero for informational metrics. */
    impact: number;
    /** True when the value sits inside the healthy band. */
    inBand: boolean;
    /** Which side of the band it fell, when it fell outside. */
    side: 'inside' | 'below' | 'above';
    /** A sentence naming the value and where it sits. Shown to a person. */
    explanation: string;
}

/**
 * Turns a measured value into a bounded contribution.
 *
 * Pure and total: any finite input produces an evaluation, including absurd ones
 * (a 900 WPM rate is fully penalised rather than crashing a `Math.log`). A
 * non-finite value produces a zero-impact evaluation, because a broken
 * measurement must never move a score.
 */
export function evaluateMetric(definition: MetricDefinition, rawValue: number): MetricEvaluation {
    const informational: MetricEvaluation = {
        key: definition.key,
        value: rawValue,
        position: 0,
        impact: 0,
        inBand: true,
        side: 'inside',
        explanation: definition.description,
    };

    if (definition.feeds === null || definition.maxImpact === 0 || definition.shape === 'informational') {
        return informational;
    }

    if (!Number.isFinite(rawValue)) {
        return {
            ...informational,
            inBand: false,
            explanation: `${definition.label} was not measured, so it contributed nothing.`,
        };
    }

    const [low, high] = definition.band;
    const tolerance = definition.tolerance > 0 ? definition.tolerance : 1;

    let position = 0;
    let side: MetricEvaluation['side'] = 'inside';

    if (definition.shape === 'band') {
        if (rawValue < low) {
            side = 'below';
            position = -Math.min(1, (low - rawValue) / tolerance);
        } else if (rawValue > high) {
            side = 'above';
            position = -Math.min(1, (rawValue - high) / tolerance);
        }
        // Inside the band is the only place a band metric earns a positive
        // contribution, and it earns a modest one: being inside a healthy range
        // is the expected case, not an achievement.
        if (side === 'inside') position = 0.25;
    } else if (definition.shape === 'lower-better') {
        if (rawValue > low) {
            side = 'above';
            position = -Math.min(1, (rawValue - low) / tolerance);
        } else {
            position = 0.2;
        }
    } else {
        // higher-better
        if (rawValue < high) {
            side = 'below';
            position = -Math.min(1, (high - rawValue) / tolerance);
        } else {
            position = 0.2;
        }
    }

    return {
        key: definition.key,
        value: rawValue,
        position,
        impact: position * definition.maxImpact,
        inBand: side === 'inside',
        side,
        explanation: describe(definition, rawValue, side),
    };
}

/** Formats a value in its own unit, so no caller has to remember the scale. */
export function formatMetricValue(definition: MetricDefinition, value: number): string {
    if (!Number.isFinite(value)) return 'not measured';
    switch (definition.unit) {
        case 'wpm':
            return `${Math.round(value)} wpm`;
        case 'per100words':
            return `${value.toFixed(1)} per 100 words`;
        case 'ratio':
            return `${Math.round(value * 100)}%`;
        case 'ms':
            return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
        case 'count':
            return value === 1 ? '1' : `${Math.round(value)}`;
        case 'score':
            return `${Math.round(value)}/100`;
        case 'index':
        default:
            return value.toFixed(2);
    }
}

function describe(
    definition: MetricDefinition,
    value: number,
    side: MetricEvaluation['side']
): string {
    const formatted = formatMetricValue(definition, value);
    if (definition.shape === 'band') {
        const [low, high] = definition.band;
        if (side === 'below') return `${definition.label} was ${formatted}, below the ${formatMetricValue(definition, low)}–${formatMetricValue(definition, high)} range.`;
        if (side === 'above') return `${definition.label} was ${formatted}, above the ${formatMetricValue(definition, low)}–${formatMetricValue(definition, high)} range.`;
        return `${definition.label} was ${formatted}, inside the healthy range.`;
    }
    if (side === 'inside') return `${definition.label} was ${formatted}, which is fine.`;
    return `${definition.label} was ${formatted}.`;
}
