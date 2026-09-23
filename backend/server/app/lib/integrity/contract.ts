// ============================================
// contract.ts — the integrity signal registry
// Feature 3 — Integrity & Authenticity Suite
// ============================================
//
// One source of truth for every integrity signal: what it is called, which
// detection layer it belongs to, how far it is allowed to move a score, and —
// the field this feature exists to get right — what it CANNOT tell you.
//
// TWO DECISIONS THAT SHAPE EVERYTHING BELOW
//
// 1. INTEGRITY ONLY EVER SUBTRACTS.
//    Delivery could move a score either way; a candidate could earn a little for
//    speaking clearly. Integrity cannot. There is no signal that *adds* points,
//    because a platform must never reward someone for appearing honest — that is
//    a quality no camera can observe, and a score that goes up for "looking
//    clean" is measuring the wrong thing entirely. An assessed session starts at
//    100 and evidence moves it down. Nothing moves it up.
//
// 2. EVERY SIGNAL MUST NAME ITS OWN INNOCENT EXPLANATION.
//    `whatItCannotSay` is not documentation. It is shown to the reviewer beside
//    every flag that fires, because a signal presented without its innocent
//    reading is an accusation, and several of the signals below have obvious
//    innocent readings. A tab that loses visibility is also what a delivery at
//    the door looks like. A burst of pasting is also what a candidate with a
//    disability accommodation, or one pasting their own prepared notes, looks
//    like. The registry refuses to let that context be lost between the browser
//    and the person judging the result, and a verify check asserts the field is
//    never empty — for every signal, without exception.

/** The three independent detection domains. Each is computed and bounded separately. */
export type IntegrityLayer = 'proctoring' | 'authenticity' | 'similarity';

/**
 * How alarming a signal is when it fires.
 *
 * This is a property of the SIGNAL, assigned here, and never of the observation —
 * the browser reports what happened and does not get to grade it.
 */
export type IntegritySeverity = 'info' | 'low' | 'medium' | 'high';

/**
 * How to read a value.
 *
 *  · `higher-worse`  — past a threshold, more of it is more concerning
 *  · `band`          — there is a normal range; both extremes are off
 *  · `informational` — recorded and displayed, never scored
 *
 * There is no `lower-worse` or `higher-better`. Nothing in this feature is
 * improved by having more or less of it in the direction of *earning* points;
 * see decision 1 above.
 */
export type SignalShape = 'higher-worse' | 'band' | 'informational';

export interface SignalDefinition {
    key: string;
    label: string;
    layer: IntegrityLayer;
    /** Severity attached to this signal when it fires. */
    severity: IntegritySeverity;
    shape: SignalShape;
    /**
     * For `higher-worse`: [threshold, threshold] — where the deduction starts.
     * For `band`: the normal interval [low, high].
     * For `informational`: unused, and the registry sets it to [0, 0].
     */
    band: [number, number];
    /**
     * How far past the threshold before the full deduction is realised, in the
     * signal's own unit. A count needs a wider margin than a ratio.
     */
    tolerance: number;
    /** Largest deduction this signal may make, in points on the 0–100 scale. */
    maxPoints: number;
    /**
     * One sentence stating what this signal CANNOT distinguish. Shown beside every
     * flag, to the reviewer and to the candidate. Never empty — enforced by
     * `verify-integrity.ts`.
     */
    whatItCannotSay: string;
    /** Plain description of what was measured. Shown in the evidence trail. */
    description: string;
}

/**
 * The registry.
 *
 * Weights are deliberately small. The whole feature is capped (see `fusion.ts`),
 * and no single signal may come close to condemning a session on its own — the
 * largest here is 18 of a possible 100, and the per-layer cap means even a
 * saturated layer cannot carry a session to zero by itself.
 */
export const INTEGRITY_SIGNALS: readonly SignalDefinition[] = [
    // ── Layer 1: proctoring ──────────────────────────────────────────────────
    {
        key: 'pasteDuringAnswer',
        label: 'Content pasted',
        layer: 'proctoring',
        severity: 'high',
        shape: 'higher-worse',
        band: [0, 0],
        tolerance: 2,
        maxPoints: 18,
        whatItCannotSay:
            'It cannot tell an answer copied from somewhere else from a candidate pasting their own prepared notes, a phone number, or text they typed elsewhere because of a motor impairment. The pasted content is deliberately not stored, so this can be raised with the candidate but never settled by the platform.',
        description: 'Paste events recorded while an answer was being given.',
    },
    {
        key: 'tabHiddenDuration',
        label: 'Time with the tab hidden',
        layer: 'proctoring',
        severity: 'medium',
        shape: 'higher-worse',
        band: [0, 0],
        tolerance: 20000,
        maxPoints: 12,
        whatItCannotSay:
            'A hidden tab is also what a delivery at the door, a phone call, a child, or a shared household looks like. It records that the interview was not on screen, not what the candidate was doing instead.',
        description: 'Total milliseconds during which the interview tab was not visible.',
    },
    {
        key: 'windowBlurCount',
        label: 'Times the window lost focus',
        layer: 'proctoring',
        severity: 'low',
        shape: 'higher-worse',
        band: [2, 2],
        tolerance: 8,
        maxPoints: 6,
        whatItCannotSay:
            'Switching windows is also what reading the question in a second window, checking notes you were told you could use, or dismissing a notification looks like. Focus loss alone distinguishes nothing.',
        description: 'Times the interview window lost focus during the session.',
    },
    {
        key: 'copyFromInterview',
        label: 'Content copied out',
        layer: 'proctoring',
        severity: 'medium',
        shape: 'higher-worse',
        band: [0, 0],
        tolerance: 3,
        maxPoints: 7,
        whatItCannotSay:
            'Copying a question is also what a candidate does to save it for later reflection, to paste into a translation tool, or to keep a record of what they were asked. It does not establish that the question was passed to anyone.',
        description: 'Copy events recorded during the session.',
    },
    {
        key: 'fullscreenExitCount',
        label: 'Fullscreen exits',
        layer: 'proctoring',
        severity: 'low',
        shape: 'higher-worse',
        band: [1, 1],
        tolerance: 4,
        maxPoints: 5,
        whatItCannotSay:
            'Leaving fullscreen is also what a notification, an accidental keypress, or a screen reader being turned on looks like. Fullscreen is a presentation choice, not a lock.',
        description: 'Times the session left fullscreen after entering it.',
    },
    {
        key: 'uniformKeystrokeCadence',
        label: 'Mechanical typing rhythm',
        layer: 'proctoring',
        severity: 'medium',
        // FIRES WHEN THE VALUE IS LOW, not high. Uniform timing means low variance,
        // so the normal band starts at the threshold and runs upward; a coefficient
        // of variation below it is the concerning case. Getting this backwards would
        // flag fluent human typists and clear a script.
        shape: 'band',
        // 0.25, not 0.35. Real human inter-key intervals are heavily right-skewed and
        // their coefficient of variation sits around 0.5–0.8; evenly jittered timing
        // lands near 0.37. A threshold at 0.35 therefore sits inside the range ordinary
        // people actually produce, and would flag them. The gap to a fixed-interval
        // script — which is exactly 0 — is wide enough to place the line where no
        // plausible human reaches it.
        band: [0.25, 10],
        // Equal to the low bound so a perfectly uniform cadence reaches the full
        // deduction. A larger tolerance would put the maximum out of reach, and a
        // signal that can never fully fire is one the registry is lying about.
        tolerance: 0.25,
        maxPoints: 10,
        whatItCannotSay:
            'Uniform timing is also what typing a memorised answer, using a switch or adaptive keyboard, or pasting-then-correcting produces. It measures the rhythm of the keys, never which keys were pressed — the typed text is not part of this signal and is not stored by it.',
        description:
            'How mechanically even the inter-key intervals were. Expressed as a coefficient of variation: low means every keystroke landed at the same interval, which is what a script produces and what human typing does not.',
    },
    {
        key: 'resolutionChangeCount',
        label: 'Display changes',
        layer: 'proctoring',
        severity: 'info',
        shape: 'higher-worse',
        band: [0, 0],
        tolerance: 3,
        maxPoints: 4,
        whatItCannotSay:
            'A resolution change is also what plugging in a monitor, resizing a window, or a laptop waking from sleep looks like. It is weak evidence of a second display and no evidence of what was on it.',
        description: 'Times the viewport resolution changed during the session.',
    },
    {
        key: 'devtoolsSuspected',
        label: 'Developer tools suspected',
        layer: 'proctoring',
        severity: 'low',
        // Recorded and shown, but it never moves the score. Browser devtools
        // heuristics are trivially wrong — they misfire on extensions, on unusual
        // window sizes, on zoom, and on some accessibility tools — and a signal
        // that is wrong this often has no business removing points from anyone.
        // It stays in the registry so a reviewer can see it was observed.
        shape: 'informational',
        band: [0, 0],
        tolerance: 0,
        maxPoints: 0,
        whatItCannotSay:
            'This heuristic is wrong often enough that it is never scored: it misfires on browser extensions, unusual window sizes, zoom levels and some accessibility tools. It is shown for completeness and should not be relied on at all.',
        description: 'Heuristic guesses about an open devtools panel. Recorded, never scored.',
    },

    // ── Layer 2: authenticity ────────────────────────────────────────────────
    {
        key: 'stylometricDrift',
        label: 'Sudden change in writing style',
        layer: 'authenticity',
        severity: 'high',
        shape: 'higher-worse',
        band: [0.45, 0.45],
        tolerance: 0.4,
        maxPoints: 16,
        whatItCannotSay:
            'A register shift is also what switching from a rehearsed opening to an unrehearsed follow-up, answering a technical question after a personal one, or simply warming up over an interview looks like. It is computed against the same candidate’s OWN earlier answers, so it cannot compare people to each other — but it also cannot tell a change of subject from a change of author.',
        description:
            'How far this answer’s function-word profile sits from the same candidate’s own earlier answers. Needs both a baseline and enough text to estimate a distribution, and is reported as not measured without either.',
    },
    {
        key: 'lowBurstiness',
        label: 'Unusually even sentence rhythm',
        layer: 'authenticity',
        severity: 'medium',
        shape: 'band',
        // Human prose varies its sentence length a lot; generated prose tends to be
        // uniform. The band is wide because plenty of real people write evenly, and
        // only unusual uniformity is worth a reviewer's time.
        band: [0.28, 10],
        tolerance: 0.25,
        maxPoints: 11,
        whatItCannotSay:
            'Even sentence lengths are also what a short answer, a prepared answer, a list-shaped answer, or the writing of someone who plans before they type looks like. Many people write this way all the time.',
        description:
            'Coefficient of variation of sentence length. Low values mean every sentence was about the same length.',
    },
    {
        key: 'lowLexicalDiversity',
        label: 'Repetitive vocabulary',
        layer: 'authenticity',
        severity: 'low',
        shape: 'band',
        band: [0.45, 1],
        tolerance: 0.3,
        maxPoints: 7,
        whatItCannotSay:
            'Repeating vocabulary is also what a technical answer full of necessary jargon, a non-native speaker, or a short answer looks like. Vocabulary range tracks the question and the person’s background, not their honesty.',
        description:
            'Length-normalised lexical diversity. Unlike a raw type-token ratio this does not fall merely because an answer is long.',
    },
    {
        key: 'highRepetition',
        label: 'Repeated phrasing',
        layer: 'authenticity',
        severity: 'medium',
        // higher-worse, not a band: repetition has no harmful low end, and expressing
        // it as a band whose lower edge sits at zero would leave an unreachable branch
        // in the evaluator that a later reader would have to reason about for nothing.
        shape: 'higher-worse',
        band: [0.16, 0.16],
        tolerance: 0.22,
        maxPoints: 9,
        whatItCannotSay:
            'Repeated phrasing is also what a memorised answer, a rehearsed story the candidate has told in ten interviews, or plain nervousness produces. Rehearsal is not misconduct.',
        description: 'Share of repeated word sequences within the answer.',
    },
    {
        key: 'templateLikeStructure',
        label: 'Formulaic structure',
        layer: 'authenticity',
        severity: 'medium',
        shape: 'higher-worse',
        band: [0.5, 0.5],
        tolerance: 0.5,
        maxPoints: 8,
        whatItCannotSay:
            'Formulaic structure is also what good interview coaching produces, and what many people are explicitly taught to do. Being well prepared for an interview is the expected behaviour, not evidence of anything.',
        description:
            'How closely the answer follows a rigid connectives-and-transitions template. High values mean the shape of the prose, not its content, looks generated.',
    },

    // ── Layer 3: cross-candidate similarity ──────────────────────────────────
    {
        key: 'nearDuplicateAnswer',
        label: 'Near-duplicate answer',
        layer: 'similarity',
        severity: 'high',
        shape: 'higher-worse',
        band: [0.75, 0.75],
        tolerance: 0.25,
        maxPoints: 18,
        whatItCannotSay:
            'Two similar answers are also what a leaked question bank, a shared preparation course, a widely circulated model answer, or two people who both watched the same tutorial looks like. It establishes that the answers resemble each other, and nothing about who wrote which.',
        description:
            'Estimated similarity to another answer in the same study, above threshold. Compared within a study only, because candidates in different studies answer different questions.',
    },
    {
        key: 'similarityClusterMember',
        label: 'Part of a similar group',
        layer: 'similarity',
        severity: 'high',
        shape: 'higher-worse',
        band: [2, 2],
        tolerance: 4,
        maxPoints: 14,
        whatItCannotSay:
            'Being in a group is also what a shared study group, a common prep course, or one well-known model answer produces. The group shows the answers travelled together; it cannot show in which direction, or whether the candidate knew.',
        description:
            'How many other answers in the study this one is transitively similar to. A leaked answer circulated to five people is one finding, not ten.',
    },
] as const;

const BY_KEY = new Map(INTEGRITY_SIGNALS.map((definition) => [definition.key, definition]));

/**
 * The registry version.
 *
 * Stored on every report. Thresholds are judgements and they will move; without a
 * version, a finding recorded under one set of thresholds would be silently
 * re-read under another, and a candidate could be shown a flag derived from rules
 * that did not exist when their interview happened.
 */
export const REGISTRY_VERSION = 1;

export function signalDefinition(key: string): SignalDefinition | undefined {
    return BY_KEY.get(key);
}

export function signalsForLayer(layer: IntegrityLayer): SignalDefinition[] {
    return INTEGRITY_SIGNALS.filter((definition) => definition.layer === layer);
}

/** Signals that can move a score. Used by fusion and by the reviewer's evidence view. */
export function scoringSignals(): SignalDefinition[] {
    return INTEGRITY_SIGNALS.filter((definition) => definition.shape !== 'informational' && definition.maxPoints > 0);
}

// --------------------------------------------
// Interpreting a value
// --------------------------------------------

export interface SignalEvaluation {
    key: string;
    value: number;
    /** 0 (nothing) … 1 (fully realised). Never negative: integrity does not reward. */
    position: number;
    /** Points removed from the session score. Zero when the signal is informational. */
    deduction: number;
    /** True when the value is in the region that warrants a flag. */
    fired: boolean;
    /** A sentence naming the value and where it sits. Shown to a person. */
    explanation: string;
}

/**
 * Turns a measured value into a bounded deduction.
 *
 * Pure and total. A non-finite value produces a zero-deduction evaluation, because
 * a broken measurement must never move a score — including downward, which is the
 * direction a naive implementation would drift on NaN.
 */
export function evaluateSignal(definition: SignalDefinition, rawValue: number): SignalEvaluation {
    const informational: SignalEvaluation = {
        key: definition.key,
        value: rawValue,
        position: 0,
        deduction: 0,
        fired: false,
        explanation: definition.description,
    };

    if (definition.shape === 'informational' || definition.maxPoints === 0) {
        return informational;
    }

    if (!Number.isFinite(rawValue)) {
        return {
            ...informational,
            explanation: `${definition.label} was not measured, so it removed nothing.`,
        };
    }

    const [low, high] = definition.band;
    const tolerance = definition.tolerance > 0 ? definition.tolerance : 1;

    let position = 0;

    if (definition.shape === 'higher-worse') {
        // `band` holds [threshold, threshold] for this shape.
        const threshold = low;
        position = rawValue <= threshold ? 0 : Math.min(1, (rawValue - threshold) / tolerance);
    } else {
        // band: outside the normal interval, in either direction.
        if (rawValue < low) {
            position = Math.min(1, (low - rawValue) / tolerance);
        } else if (rawValue > high) {
            position = Math.min(1, (rawValue - high) / tolerance);
        }
    }

    return {
        key: definition.key,
        value: rawValue,
        position,
        deduction: round1(position * definition.maxPoints),
        fired: position > 0,
        explanation: describe(definition, rawValue, position),
    };
}

/** Formats a value in its own unit, so no caller has to remember the scale. */
export function formatSignalValue(definition: SignalDefinition, value: number): string {
    if (!Number.isFinite(value)) return 'not measured';
    switch (definition.key) {
        case 'tabHiddenDuration':
            return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
        case 'pasteDuringAnswer':
        case 'copyFromInterview':
        case 'windowBlurCount':
        case 'fullscreenExitCount':
        case 'resolutionChangeCount':
            return value === 1 ? '1 time' : `${Math.round(value)} times`;
        case 'similarityClusterMember':
            return value === 1 ? '1 other answer' : `${Math.round(value)} other answers`;
        default:
            return value.toFixed(2);
    }
}

function describe(definition: SignalDefinition, value: number, position: number): string {
    const formatted = formatSignalValue(definition, value);
    if (position === 0) {
        return `${definition.label}: ${formatted}, which is within the normal range.`;
    }
    return `${definition.label} was ${formatted}. ${definition.description}`;
}

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}
