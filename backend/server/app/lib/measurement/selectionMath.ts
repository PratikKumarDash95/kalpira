// ============================================
// selectionMath.ts — Adaptive item selection logic
// Part of the Competency Measurement Engine (Feature 1)
//
// PURE MODULE. No DB, no network.
//
// Two jobs:
//   1. Rank candidate items by how much they would tell us about this candidate
//      (Fisher information at the current ability estimate).
//   2. Decide when to stop — by measurement precision, not by a question count.
//
// Together these are what make a test *adaptive* rather than merely tiered. The
// old engine picked a random question inside an easy/medium/hard bucket; this one
// picks the single item whose answer will move the estimate the most.
// ============================================

import {
    DEFAULT_TARGET_SE,
    MAX_STANDARD_ERROR,
    itemInformation,
    type ItemParams,
} from './irt';

/** How many top-ranked items to sample from when picking. */
export const DEFAULT_RANDOMESQUE_DEPTH = 5;

/** Never ask fewer than this many items, whatever the precision says. */
export const MIN_ITEMS_BEFORE_STOP = 8;

/** Hard ceiling so a pathological session cannot run forever. */
export const MAX_ITEMS_PER_COMPETENCY = 25;

export interface RankedItem {
    itemKey: string;
    params: ItemParams;
    /** Fisher information at the current ability estimate. */
    information: number;
    /** |b - θ| — how far the item sits from the candidate's current level. */
    distance: number;
}

/**
 * Ranks items by the information they would provide at `theta`, best first.
 *
 * Ties are broken by distance from the estimate, then by key, so the ordering is
 * fully deterministic for a given input — which matters for testing and for
 * explaining to an interviewer why a particular item was chosen.
 *
 * Retired items are excluded by the caller (they are a policy concern, not a
 * mathematical one), as are items already answered in this session.
 */
export function rankItemsByInformation(
    theta: number,
    items: Array<{ itemKey: string; params: ItemParams }>
): RankedItem[] {
    return items
        .map((item) => ({
            itemKey: item.itemKey,
            params: item.params,
            information: itemInformation(theta, item.params),
            distance: Math.abs(item.params.b - theta),
        }))
        .sort((x, y) => {
            if (y.information !== x.information) return y.information - x.information;
            if (x.distance !== y.distance) return x.distance - y.distance;
            return x.itemKey < y.itemKey ? -1 : x.itemKey > y.itemKey ? 1 : 0;
        });
}

/**
 * Picks from the top `depth` ranked items at random.
 *
 * This is "randomesque" selection (Kingsbury & Zara), a standard CAT practice.
 * Always taking the single best item maximises short-term precision but
 * systematically over-exposes a handful of items — they get answered by everyone,
 * become guessable, and their parameters drift. Sampling among the near-best
 * costs almost nothing statistically and keeps the bank healthy.
 *
 * `random` is injected so callers and tests control the source of randomness.
 */
export function randomesquePick(
    ranked: RankedItem[],
    depth: number = DEFAULT_RANDOMESQUE_DEPTH,
    random: () => number = Math.random
): RankedItem | null {
    if (ranked.length === 0) return null;

    const poolSize = Math.max(1, Math.min(depth, ranked.length));
    const index = Math.floor(random() * poolSize);
    return ranked[Math.min(index, poolSize - 1)];
}

/**
 * The difficulty an item should target to be maximally informative at `theta`.
 *
 * For the 2PL and 3PL models, information is maximised when the item's difficulty
 * sits at the candidate's ability (b ≈ θ) — an item you will almost certainly get
 * right, or almost certainly get wrong, teaches us nothing either way.
 *
 * This is the number handed to question generation. When there is no item bank to
 * select from — which is the normal case here, since questions are AI-generated —
 * this is how the measurement engine steers the interview: "ask something at
 * difficulty +0.8 on competency X" instead of trusting an LLM's self-reported
 * increase/decrease/maintain.
 */
export function targetDifficultyFor(theta: number): number {
    // ⚠️ Callers should not clamp this to the legacy ±1 easy/hard band. The whole
    // point is that difficulty becomes continuous and measured rather than three
    // labels; a candidate at θ = 2.4 needs items near 2.4, not "hard".
    return theta;
}

export interface StopDecision {
    shouldStop: boolean;
    reason:
        | 'target-precision-reached'
        | 'minimum-items-not-met'
        | 'maximum-items-reached'
        | 'no-items-available'
        | 'ability-at-bound';
    /** Human-readable justification, suitable for an admin or a candidate. */
    explanation: string;
}

/**
 * Decides whether the measurement is finished.
 *
 * The primary rule is precision: stop when SE(θ) is at or below the target, which
 * is what "we know enough about this person" actually means. Two guards bound it:
 * a minimum item count, so a lucky early pattern cannot end a session after three
 * questions; and a maximum, so a candidate sitting exactly at a difficulty where
 * no item is informative cannot be asked questions forever.
 *
 * `abilityAtBound` is reported when θ has hit ±ABILITY_MAX: no further item at
 * this difficulty range can improve the estimate, so continuing is wasted effort.
 */
export function stopDecision(input: {
    standardError: number;
    itemsAnswered: number;
    itemsAvailable: number;
    theta?: number;
    targetSe?: number;
    minItems?: number;
    maxItems?: number;
}): StopDecision {
    const targetSe = input.targetSe ?? DEFAULT_TARGET_SE;
    const minItems = input.minItems ?? MIN_ITEMS_BEFORE_STOP;
    const maxItems = input.maxItems ?? MAX_ITEMS_PER_COMPETENCY;

    if (input.itemsAvailable <= 0) {
        return {
            shouldStop: true,
            reason: 'no-items-available',
            explanation: 'No further items are available to ask.',
        };
    }

    if (input.itemsAnswered >= maxItems) {
        return {
            shouldStop: true,
            reason: 'maximum-items-reached',
            explanation: `Reached the maximum of ${maxItems} items for this competency.`,
        };
    }

    if (input.itemsAnswered < minItems) {
        return {
            shouldStop: false,
            reason: 'minimum-items-not-met',
            explanation: `${minItems - input.itemsAnswered} more item(s) needed before the estimate is allowed to conclude.`,
        };
    }

    if (input.standardError <= targetSe) {
        return {
            shouldStop: true,
            reason: 'target-precision-reached',
            explanation: `Measurement precision reached: SE ${input.standardError.toFixed(2)} ≤ target ${targetSe}.`,
        };
    }

    // A very large SE means the pattern was uninformative rather than unfinished
    // — an ability pinned at a bound with no discriminating items left.
    if (input.standardError >= MAX_STANDARD_ERROR) {
        return {
            shouldStop: true,
            reason: 'ability-at-bound',
            explanation: 'Ability could not be pinned down with the available items; stopping rather than asking uninformative questions.',
        };
    }

    return {
        shouldStop: false,
        reason: 'minimum-items-not-met',
        explanation: `Precision SE ${input.standardError.toFixed(2)} is above target ${targetSe}; more items would help.`,
    };
}

/**
 * A thin backward-compatible mapping from a measured target difficulty back onto
 * the legacy easy/medium/hard labels.
 *
 * Kept because parts of the UI and the older prompt builders still speak in
 * labels. New code should use the continuous target difficulty directly; this
 * exists so nothing has to be migrated in the same change.
 */
export function difficultyLabelFor(targetDifficulty: number): 'easy' | 'medium' | 'hard' {
    if (targetDifficulty <= -0.5) return 'easy';
    if (targetDifficulty >= 0.5) return 'hard';
    return 'medium';
}
