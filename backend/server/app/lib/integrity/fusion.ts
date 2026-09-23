// ============================================
// fusion.ts — three layers into one report, or an honest refusal
// Feature 3 — Integrity & Authenticity Suite
// ============================================
//
// This is arithmetic. There is no model, no sampling, no temperature, and no
// judgement call below that a person could not redo by hand from the flags. That is
// the same commitment `lib/delivery/fusion.ts` makes, for a stronger reason: an
// integrity score can cost someone a job, and a figure that cannot be reproduced
// exactly is not one anybody should be dismissed over.
//
// THE SHAPE OF THE RESULT IS THE SAFETY MECHANISM
//
// `IntegrityResult` has no `verdict`, no `recommendation`, no `shouldReject`, no
// `action`, and no `risk`. That is not an oversight and it is not enforced by
// convention — there is structurally nowhere in this type to put a decision. The
// feature's hardest rule is that nothing here may auto-reject a candidate, and the
// way to guarantee that is to make the type incapable of expressing a rejection.
// `verify-integrity.ts` pins the field list so a later change cannot quietly add one.
//
// THE THREE REFUSALS
//
//   1. THIN EVIDENCE IS NOT A CLEAN SESSION.
//      A session the platform could not look at reports `assessed: false` and a null
//      score. Never 100, never 0. Reporting 100 asserts "this person is clean" from
//      no observations, which is a claim the platform cannot defend to the person it
//      is about; reporting 0 asserts the opposite and is worse. A number nobody can
//      justify is not better than no number.
//
//   2. A SILENT BROWSER IS NOT A MEASUREMENT.
//      Proctoring values arrive as counts, and a count of zero is normally a real
//      observation. But when the client sent no events at all, every one of those
//      zeros is an absence of data wearing a measurement's clothes — and treating it
//      as evidence would hand every clean score to whoever suppresses reporting.
//      A proctoring layer with no events contributes nothing to the assessment gate.
//
//   3. NO LAYER CONDEMNS ALONE.
//      Each layer is capped, and the caps are set so one saturated layer leaves a
//      score of 80 or better. A candidate can only reach the floor if two independent
//      layers agree, which is the whole design: proctoring is client-reported and
//      weak, stylometry is circumstantial, and similarity is about a group rather
//      than a person. Requiring corroboration is the only defensible way to combine
//      three signals of that quality.

import {
    INTEGRITY_SIGNALS,
    REGISTRY_VERSION,
    formatSignalValue,
    signalDefinition,
    type IntegrityLayer,
    type IntegritySeverity,
    type SignalEvaluation,
} from './contract';

/**
 * Most a session can lose to automated evidence, in points on the 0–100 scale.
 *
 * 45 leaves a hard floor of 55. The floor exists because the alternative — a score
 * that can reach zero on browser events and text statistics alone — would be a
 * number an automated system could use to end someone's candidacy without a person
 * ever reading the flags. Nothing in this feature removes a human from that decision,
 * and the cap is what makes the claim structural rather than aspirational.
 */
export const MAX_DEDUCTION = 45;

/**
 * Most any single layer may deduct.
 *
 * Each is below `MAX_DEDUCTION`, which is what enforces refusal 3: a layer saturated
 * to its limit still leaves a score of 80 or better on its own. The registry's raw
 * per-signal weights sum to more than these caps — deliberately, so the caps are the
 * real constraint and adding a signal to the registry cannot silently widen how much
 * a layer can take.
 *
 * Similarity is capped alongside the others despite carrying the highest-severity
 * signals, because a cluster is the finding least attributable to an individual: it
 * establishes that answers travelled, never which candidate did anything.
 */
export const LAYER_CAPS: Record<IntegrityLayer, number> = {
    proctoring: 18,
    authenticity: 20,
    similarity: 20,
};

/**
 * Signals that must be genuinely measured before a session can be assessed at all.
 *
 * Three, from at least two layers — see `assessability` below. The number is low
 * because a real answer-worth of text produces four authenticity signals on its own
 * and a real interview produces eight proctoring ones, so any session with genuine
 * activity clears it comfortably. A session that does not clear it is one the
 * platform has essentially no information about, and those are exactly the sessions
 * that must not be given a number.
 */
export const MIN_SIGNALS_FOR_ASSESSMENT = 3;

/** Layers that must each contribute a measured signal. See `MIN_SIGNALS_FOR_ASSESSMENT`. */
export const MIN_LAYERS_FOR_ASSESSMENT = 2;

// --------------------------------------------
// Inputs
// --------------------------------------------

/**
 * One detection layer's contribution.
 *
 * `hasEvidence` is the field that carries refusal 2. It says "this layer actually
 * observed something", as distinct from "this layer produced numbers", and the two
 * come apart precisely where it matters: a browser that sent nothing produces eight
 * zero-valued proctoring signals and no evidence whatsoever.
 */
export interface LayerInput {
    layer: IntegrityLayer;
    evaluations: readonly SignalEvaluation[];
    /** True when this layer observed anything at all. Gates the assessment, not the score. */
    hasEvidence: boolean;
    /** Statements about this layer's coverage, returned verbatim in the report. */
    caveats?: readonly string[];
}

// --------------------------------------------
// Outputs
// --------------------------------------------

/**
 * One deduction, with everything a person needs to judge it.
 *
 * `whatItCannotSay` and `severity` travel WITH the flag rather than being looked up
 * beside it, so a flag cannot be displayed, exported or forwarded without its
 * innocent explanation attached. A finding shown without the thing it cannot rule out
 * is an accusation, and that is the failure this field exists to prevent.
 */
export interface IntegrityFlag {
    key: string;
    label: string;
    layer: IntegrityLayer;
    severity: IntegritySeverity;
    value: number;
    /** The value in its own unit, already formatted for a person. */
    formattedValue: string;
    /** Points this flag removed from the session score. Always positive. */
    deduction: number;
    explanation: string;
    whatItCannotSay: string;
}

export interface LayerSummary {
    layer: IntegrityLayer;
    /** Whether this layer observed anything. False means its zeros are absences. */
    hasEvidence: boolean;
    /** How many signals this layer measured. */
    measured: number;
    /** How many of them fired. */
    fired: number;
    /** Points this layer removed, after its cap. */
    deduction: number;
    /** The cap that was applied. */
    cap: number;
    caveats: string[];
}

/**
 * The fused result.
 *
 * READ THE FIELD LIST. There is no verdict here, no recommendation, no action, no
 * risk level, and no rejection flag. A score is evidence; a person decides.
 */
export interface IntegrityResult {
    /** False when the session could not be judged. Then `score` is null. */
    assessed: boolean;
    /** Null whenever `assessed` is false. Never defaulted to 100 or 0. */
    score: number | null;
    status: 'assessed' | 'not_assessed';
    /** Every deduction, largest first. Empty when nothing fired — which is not the same as clean. */
    flags: IntegrityFlag[];
    /** Registry keys that were measured but stayed in range, so a reader sees what was checked. */
    checked: string[];
    layers: LayerSummary[];
    /** Statements about how much of this to trust, shown verbatim to whoever reads the report. */
    caveats: string[];
    /** Total points removed, after every cap. Zero when nothing fired. */
    totalDeduction: number;
    /** The registry version these thresholds belong to. */
    registryVersion: number;
    /** One paragraph a person can read instead of the numbers. */
    explanation: string;
}

// --------------------------------------------
// Fusion
// --------------------------------------------

/**
 * Fuses the layers into a report.
 *
 * Pure and total: nonsense in, a well-formed result out. Non-finite values are
 * dropped rather than propagated, because a broken measurement must not move a score
 * — and NaNs drift downward, which is the direction that harms the candidate.
 */
export function fuseIntegrity(layers: readonly LayerInput[]): IntegrityResult {
    const summaries: LayerSummary[] = [];
    const flags: IntegrityFlag[] = [];
    const checked: string[] = [];
    const caveats: string[] = [];

    for (const layer of layers) {
        const definitions = INTEGRITY_SIGNALS.filter((definition) => definition.layer === layer.layer);
        const byKey = new Map(layer.evaluations.map((evaluation) => [evaluation.key, evaluation]));

        let measured = 0;
        let fired = 0;
        let raw = 0;

        for (const definition of definitions) {
            const evaluation = byKey.get(definition.key);
            // A signal absent from the evaluations was not measured. That is not a
            // zero and must never be treated as one.
            if (!evaluation || !Number.isFinite(evaluation.value)) continue;

            measured += 1;

            if (!evaluation.fired || evaluation.deduction <= 0) {
                checked.push(definition.key);
                continue;
            }

            fired += 1;
            raw += evaluation.deduction;
            flags.push({
                key: definition.key,
                label: definition.label,
                layer: definition.layer,
                severity: definition.severity,
                value: evaluation.value,
                formattedValue: formatSignalValue(definition, evaluation.value),
                deduction: evaluation.deduction,
                explanation: evaluation.explanation,
                whatItCannotSay: definition.whatItCannotSay,
            });
        }

        // The cap is where refusal 3 lives.
        const deduction = Math.min(raw, LAYER_CAPS[layer.layer]);
        if (raw > deduction) {
            caveats.push(
                `The ${layer.layer} layer produced ${round1(raw)} points of findings, capped at ${LAYER_CAPS[layer.layer]}. No single layer may take more than that from a session.`
            );
        }

        summaries.push({
            layer: layer.layer,
            hasEvidence: layer.hasEvidence,
            measured,
            fired,
            deduction: round1(deduction),
            cap: LAYER_CAPS[layer.layer],
            caveats: [...(layer.caveats ?? [])],
        });

        for (const note of layer.caveats ?? []) caveats.push(note);
    }

    const assessability = assessable(summaries);
    const totalDeduction = Math.min(
        round1(summaries.reduce((sum, summary) => sum + summary.deduction, 0)),
        MAX_DEDUCTION
    );

    if (totalDeduction >= MAX_DEDUCTION) {
        caveats.push(
            `Combined findings reached the ${MAX_DEDUCTION}-point ceiling. The score shown is the floor this feature can produce from automated evidence; it is not a maximum-severity judgement and does not mean the session is fully explained by the flags above.`
        );
    }

    // Largest first, so the thing that moved the score most is the thing read first.
    flags.sort((a, b) => b.deduction - a.deduction);

    return {
        assessed: assessability.assessed,
        // Refusal 1, in one line: no assessment means no number.
        score: assessability.assessed ? round1(100 - totalDeduction) : null,
        status: assessability.assessed ? 'assessed' : 'not_assessed',
        flags,
        checked: checked.sort(),
        layers: summaries,
        caveats: dedupe(caveats),
        totalDeduction,
        registryVersion: REGISTRY_VERSION,
        explanation: explain(assessability, flags, totalDeduction, summaries),
    };
}

// --------------------------------------------
// The assessment gate
// --------------------------------------------

interface Assessability {
    assessed: boolean;
    reason: string;
}

/**
 * Decides whether this session produced enough evidence to be judged.
 *
 * Both conditions must hold: enough measured signals overall (refusal 1), and
 * measured signals from more than one layer (refusal 3's logic applied one level up).
 *
 * The layer requirement is what stops a single noisy layer from producing a score.
 * Eight proctoring counts from a chatty browser extension, with nothing measured from
 * the text, is one layer's worth of evidence — and one layer is not corroboration.
 *
 * Note that `hasEvidence` gates the count. A layer that reported nothing contributes
 * zero measured signals toward assessment no matter how many zeros it emitted, which
 * is refusal 2: a silent client must not be able to earn a clean score by saying
 * nothing.
 */
function assessable(summaries: readonly LayerSummary[]): Assessability {
    const withEvidence = summaries.filter((summary) => summary.hasEvidence && summary.measured > 0);
    const measuredTotal = withEvidence.reduce((sum, summary) => sum + summary.measured, 0);

    if (measuredTotal < MIN_SIGNALS_FOR_ASSESSMENT) {
        return {
            assessed: false,
            reason: `Only ${measuredTotal} signal${measuredTotal === 1 ? '' : 's'} could be measured, below the ${MIN_SIGNALS_FOR_ASSESSMENT} this feature needs before it will report a score. There was not enough evidence to judge this session, which is not the same as judging it clean.`,
        };
    }

    if (withEvidence.length < MIN_LAYERS_FOR_ASSESSMENT) {
        return {
            assessed: false,
            reason: `Evidence came from ${withEvidence.length} of the ${summaries.length} detection layers, and a score needs at least ${MIN_LAYERS_FOR_ASSESSMENT}. A single layer cannot corroborate itself, so no score is reported.`,
        };
    }

    return { assessed: true, reason: '' };
}

// --------------------------------------------
// Explanation
// --------------------------------------------

/**
 * One paragraph, written for the person the report is about.
 *
 * The audience matters. This text may be read by the candidate, so it states what was
 * measured and how much to trust it without editorialising about what it means —
 * because what it means is not this function's call to make.
 */
function explain(
    assessability: Assessability,
    flags: readonly IntegrityFlag[],
    totalDeduction: number,
    summaries: readonly LayerSummary[]
): string {
    if (!assessability.assessed) {
        return `${assessability.reason} Nothing in this report should be read as a finding about the candidate.`;
    }

    const looked = summaries
        .filter((summary) => summary.hasEvidence && summary.measured > 0)
        .map((summary) => `${summary.layer} (${summary.measured} signal${summary.measured === 1 ? '' : 's'})`)
        .join(', ');

    if (flags.length === 0) {
        return `Measured signals from ${looked}. None fell outside its normal range, so the score is 100. This means nothing was observed that warrants a closer look — it is not a statement that the candidate did nothing unusual, only that nothing this platform can measure suggested it.`;
    }

    const summary = flags
        .slice(0, 3)
        .map((flag) => `${flag.label.toLowerCase()} (${flag.formattedValue}, −${flag.deduction})`)
        .join('; ');

    return `Measured signals from ${looked}. ${flags.length} finding${flags.length === 1 ? '' : 's'} removed ${totalDeduction} point${totalDeduction === 1 ? '' : 's'} in total: ${summary}${flags.length > 3 ? `; and ${flags.length - 3} more` : ''}. Each finding above carries the explanation it cannot rule out, and the candidate may contest any of them.`;
}

// --------------------------------------------
// Small helpers
// --------------------------------------------

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

function dedupe(values: readonly string[]): string[] {
    return [...new Set(values)];
}

/**
 * Re-reads a stored flag list into definitions.
 *
 * The service stores `flagsJSON` rather than recomputing it, because the events and
 * text behind it are not retained indefinitely. This is how a stored report is turned
 * back into flags for display, and it tolerates a flag whose registry key no longer
 * exists — a threshold change must not make a past finding unreadable.
 */
export function flagFromStored(raw: unknown): IntegrityFlag | null {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    const key = typeof record.key === 'string' ? record.key : null;
    if (!key) return null;

    const definition = signalDefinition(key);
    return {
        key,
        label: typeof record.label === 'string' ? record.label : definition?.label ?? key,
        layer: (record.layer as IntegrityLayer) ?? definition?.layer ?? 'proctoring',
        severity: (record.severity as IntegritySeverity) ?? definition?.severity ?? 'info',
        value: typeof record.value === 'number' ? record.value : 0,
        formattedValue: typeof record.formattedValue === 'string' ? record.formattedValue : '—',
        deduction: typeof record.deduction === 'number' ? record.deduction : 0,
        explanation: typeof record.explanation === 'string' ? record.explanation : '',
        whatItCannotSay:
            typeof record.whatItCannotSay === 'string'
                ? record.whatItCannotSay
                : definition?.whatItCannotSay ?? '',
    };
}
