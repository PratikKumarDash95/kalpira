// ============================================
// proctoringMath.ts — browser signals, folded into layer-1 evidence
// Feature 3 — Integrity & Authenticity Suite
// ============================================
//
// The pure half of proctoring: raw event rows in, per-signal values out. No
// database, no browser, no network.
//
// READ THIS BEFORE TRUSTING ANYTHING HERE
//
// Every signal in this file is CLIENT-REPORTED. It comes from JavaScript running in
// the candidate's own browser, which means a candidate who wants to defeat it can
// simply not send the events — or edit the client, or run the interview in a
// browser they control. Nothing here is tamper-proof, and no design in this file
// can make it tamper-proof, because the code that reports the observation and the
// code that could suppress it run in the same place.
//
// That is a real limitation and it is stated in the report's caveats rather than
// left for a reviewer to assume otherwise. What this layer is actually good for is
// the honest majority: it catches the casual case, it gives a reviewer something
// concrete to raise with a candidate, and it is *evidence*, which is all this
// feature claims to produce. A platform that let a hiring manager read an
// integrity score as proof of misconduct would be misusing it, and the caveats
// exist to make that harder.
//
// WHAT IS DELIBERATELY NOT COLLECTED
//
// The minimizer below is the only path a client payload takes into storage, and it
// drops any key it does not recognise rather than passing it through. That means a
// future client cannot widen what is stored by sending a new field. Concretely, no
// clipboard content, no typed text, and no per-key identity is ever stored: a paste
// is recorded as having happened and nothing about what was pasted.

import type { SignalEvaluation } from './contract';

/** Event types the browser may report. Unknown types are counted and ignored. */
export type IntegrityEventType =
    | 'visibility-hidden'
    | 'window-blur'
    | 'paste'
    | 'copy'
    | 'fullscreen-exit'
    | 'resolution-change'
    | 'keystroke-cadence'
    | 'devtools-suspected';

export interface RawIntegrityEvent {
    type: string;
    occurredAt?: string | Date | null;
    payload?: Record<string, unknown> | null;
}

/**
 * Which registry signal each event type feeds.
 *
 * Lives here, beside the event types themselves, because the two are the same fact
 * stated twice and separating them is how they drift. Every event type must appear —
 * an event that maps to no signal cannot be stored, because nothing would then be
 * able to say what it does and does not prove. `verify-integrity.ts` asserts the map
 * covers the union exactly.
 */
export const SIGNAL_FOR_EVENT_TYPE: Record<IntegrityEventType, string> = {
    paste: 'pasteDuringAnswer',
    copy: 'copyFromInterview',
    'visibility-hidden': 'tabHiddenDuration',
    'window-blur': 'windowBlurCount',
    'fullscreen-exit': 'fullscreenExitCount',
    'resolution-change': 'resolutionChangeCount',
    'keystroke-cadence': 'uniformKeystrokeCadence',
    'devtools-suspected': 'devtoolsSuspected',
};

/** Every event type this build accepts. Anything else is rejected and counted. */
export const INTEGRITY_EVENT_TYPES = Object.keys(SIGNAL_FOR_EVENT_TYPE) as IntegrityEventType[];

export function isKnownEventType(type: string): type is IntegrityEventType {
    return Object.prototype.hasOwnProperty.call(SIGNAL_FOR_EVENT_TYPE, type);
}

/**
 * Which payload keys each event type is allowed to carry.
 *
 * An allow-list, not a deny-list. A deny-list would mean every future field is
 * stored by default until somebody remembers to exclude it, and the failure mode of
 * that mistake is retaining something about a candidate that should never have been
 * retained.
 *
 * Note how short these lists are. `paste` and `copy` carry nothing at all: the
 * observation is that it happened, and the content is the candidate's answer, which
 * is already stored where it belongs.
 */
const ALLOWED_PAYLOAD_KEYS: Record<string, readonly string[]> = {
    'visibility-hidden': ['durationMs'],
    'window-blur': ['durationMs'],
    paste: [],
    copy: [],
    'fullscreen-exit': [],
    // Only the resolution the viewport moved TO. The previous value is derivable
    // from the previous event and storing both would double the surface for no
    // extra meaning.
    'resolution-change': ['width', 'height'],
    'keystroke-cadence': ['intervalsMs'],
    'devtools-suspected': [],
};

/**
 * Longest keystroke-interval series retained.
 *
 * Bounded because this is the one array a client can make arbitrarily large: a
 * malicious or just broken client could post a million intervals and turn a
 * proctoring record into a denial-of-service vector. The cadence statistic
 * converges long before this cap, so truncating costs nothing real.
 */
export const MAX_KEYSTROKE_INTERVALS = 2000;

/**
 * Below this many intervals a cadence figure is not computed.
 *
 * Typing four characters tells you nothing about rhythm, and a coefficient of
 * variation over a handful of samples is noise wearing a number's clothing.
 */
export const MIN_KEYSTROKE_INTERVALS = 24;

/**
 * Largest plausible gap between keystrokes, in ms.
 *
 * Intervals longer than this are someone thinking, or answering the phone, or
 * making a cup of tea — they are not typing rhythm. Including them would inflate
 * the variance of every real typist and make the signal useless.
 */
export const MAX_KEYSTROKE_INTERVAL_MS = 3000;

/** The single line every report carries about this layer's trustworthiness. */
export const CLIENT_REPORTED_CAVEAT =
    'Proctoring signals are reported by the browser and cannot be independently verified. A candidate who suppresses them produces a session that looks clean. Treat these as evidence to raise with a candidate, not as proof.';

/**
 * Narrows a client payload to the keys its event type is allowed to carry.
 *
 * Unknown keys are dropped, not passed through; non-finite numbers are dropped;
 * arrays are truncated to their documented cap. Exported because the storage path
 * and the verify script both need to be able to prove what it does.
 */
export function minimizePayload(
    type: string,
    payload: Record<string, unknown> | null | undefined
): Record<string, unknown> {
    const allowed = ALLOWED_PAYLOAD_KEYS[type];
    if (!allowed || !payload || typeof payload !== 'object') return {};

    const minimized: Record<string, unknown> = {};

    for (const key of allowed) {
        if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
        const value = payload[key];

        if (key === 'intervalsMs') {
            if (!Array.isArray(value)) continue;
            const intervals = value
                .filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry))
                .slice(0, MAX_KEYSTROKE_INTERVALS);
            if (intervals.length > 0) minimized[key] = intervals;
            continue;
        }

        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        minimized[key] = value;
    }

    return minimized;
}

// --------------------------------------------
// Statistics
// --------------------------------------------

/**
 * Coefficient of variation — the standard deviation as a share of the mean.
 *
 * Chosen over a raw standard deviation because it is scale-free: a fast typist and
 * a slow one who are equally mechanical produce the same figure, where raw spread
 * would make the slow one look erratic for no reason but their speed.
 *
 * Returns null when it cannot be computed rather than a stand-in value, because a
 * cadence of 0 would read as "perfectly mechanical" and flag the wrong person.
 */
export function coefficientOfVariation(values: readonly number[]): number | null {
    const usable = values.filter((value) => Number.isFinite(value));
    if (usable.length < 2) return null;

    const mean = usable.reduce((sum, value) => sum + value, 0) / usable.length;
    if (mean <= 0) return null;

    const variance =
        usable.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (usable.length - 1);
    return Math.sqrt(variance) / mean;
}

// --------------------------------------------
// Folding events into evidence
// --------------------------------------------

export interface ProctoringEvidence {
    /** One value per signal this layer can measure. A key absent is not measured. */
    values: Record<string, number | null>;
    /** How many events of each type arrived, for the caveats and the reviewer view. */
    eventCounts: Record<string, number>;
    totalEvents: number;
    /** Events whose type this build does not recognise. Reported, never guessed at. */
    unrecognisedEvents: number;
    caveats: string[];
}

/**
 * Folds raw events into the values the registry expects.
 *
 * Pure and total: nonsense in, a well-formed evidence object out. An unknown event
 * type is counted rather than dropped silently, because a client sending a type
 * this build does not know about is worth seeing in the record.
 */
export function foldProctoringEvents(events: readonly RawIntegrityEvent[]): ProctoringEvidence {
    const eventCounts: Record<string, number> = {};
    let unrecognisedEvents = 0;

    let tabHiddenMs = 0;
    let sawHiddenWithoutDuration = false;
    const allIntervals: number[] = [];

    for (const event of events) {
        const type = String(event.type ?? '');
        if (!ALLOWED_PAYLOAD_KEYS[type]) {
            unrecognisedEvents += 1;
            continue;
        }
        eventCounts[type] = (eventCounts[type] ?? 0) + 1;

        const payload = minimizePayload(type, event.payload);

        if (type === 'visibility-hidden') {
            const duration = payload.durationMs;
            if (typeof duration === 'number' && duration > 0) tabHiddenMs += duration;
            else sawHiddenWithoutDuration = true;
        }

        if (type === 'keystroke-cadence') {
            const intervals = payload.intervalsMs;
            if (Array.isArray(intervals)) {
                for (const interval of intervals) {
                    // Discard the thinking gaps; keep the typing rhythm.
                    if (interval > 0 && interval <= MAX_KEYSTROKE_INTERVAL_MS) allIntervals.push(interval);
                }
            }
        }
    }

    const cadence =
        allIntervals.length >= MIN_KEYSTROKE_INTERVALS ? coefficientOfVariation(allIntervals) : null;

    const values: Record<string, number | null> = {
        pasteDuringAnswer: eventCounts.paste ?? 0,
        tabHiddenDuration: tabHiddenMs,
        windowBlurCount: eventCounts['window-blur'] ?? 0,
        copyFromInterview: eventCounts.copy ?? 0,
        fullscreenExitCount: eventCounts['fullscreen-exit'] ?? 0,
        uniformKeystrokeCadence: cadence,
        resolutionChangeCount: eventCounts['resolution-change'] ?? 0,
        devtoolsSuspected: eventCounts['devtools-suspected'] ?? 0,
    };

    return {
        values,
        eventCounts,
        totalEvents: events.length,
        unrecognisedEvents,
        caveats: proctoringCaveats(events.length, sawHiddenWithoutDuration, allIntervals.length, unrecognisedEvents),
    };
}

/**
 * What a reader needs to know about this layer's coverage.
 *
 * Returned verbatim in the report. The first caveat is present whenever any event
 * arrived at all, because it is the limitation that applies to every one of them.
 */
function proctoringCaveats(
    totalEvents: number,
    hiddenWithoutDuration: boolean,
    intervalCount: number,
    unrecognised: number
): string[] {
    const caveats: string[] = [CLIENT_REPORTED_CAVEAT];

    if (totalEvents === 0) {
        caveats.push(
            'No proctoring events were reported for this session. That is what a clean interview looks like, and also what a client that suppresses reporting looks like — the platform cannot tell these apart.'
        );
    }
    if (hiddenWithoutDuration) {
        caveats.push(
            'Some tab-hidden events arrived without a duration, so the total time off-screen is understated.'
        );
    }
    if (intervalCount > 0 && intervalCount < MIN_KEYSTROKE_INTERVALS) {
        caveats.push(
            `Only ${intervalCount} keystroke intervals were recorded, which is too few to judge typing rhythm. The cadence signal is reported as not measured.`
        );
    }
    if (unrecognised > 0) {
        caveats.push(
            `${unrecognised} event${unrecognised === 1 ? '' : 's'} of a type this build does not recognise were ignored.`
        );
    }

    return caveats;
}

/**
 * Turns this layer's values into registry evaluations.
 *
 * Kept here rather than in fusion so that the proctoring layer owns both halves of
 * its own contract: which values it produces, and what they mean.
 */
export function evaluateProctoring(
    evidence: ProctoringEvidence,
    evaluate: (key: string, value: number) => SignalEvaluation | null
): SignalEvaluation[] {
    const evaluations: SignalEvaluation[] = [];
    for (const [key, value] of Object.entries(evidence.values)) {
        if (value === null) continue;
        const evaluation = evaluate(key, value);
        if (evaluation) evaluations.push(evaluation);
    }
    return evaluations;
}
