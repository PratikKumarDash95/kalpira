// ============================================
// measuredDifficulty.ts — the measured decision, as data
// Feature 1 — Competency Measurement Engine
// ============================================
//
// The pure half of the measurement↔adaptive seam. Kept out of adaptiveBridge.ts
// so it can be tested and reasoned about without a database: the only judgement
// this integration makes — whether a target rests on evidence about the person or
// is merely the starting prior — lives here, and a decision that important should
// not require a Supabase connection to verify.

import type { AdaptiveTarget } from './abilityService';
import { difficultyLabelFor } from './selectionMath';

/** A measured difficulty decision, with the evidence it rests on. */
export interface MeasuredDifficulty {
    /** The tier to record on the session, derived from the continuous target. */
    difficulty: 'easy' | 'medium' | 'hard';
    /** Continuous difficulty in logits. This is what generation should aim at. */
    targetDifficulty: number;
    /** Where the target sits relative to the middle of the scale. */
    intensity: AdaptiveTarget['intensity'];
    competencyId: string | null;
    competencyName: string | null;
    theta: number;
    standardError: number;
    responsesUsed: number;
    /** True once the estimate is precise enough that asking more will not help. */
    shouldStop: boolean;
}

/**
 * Translates a measurement target into a difficulty decision.
 *
 * Pure — no DB, no clock. Returns null when the target is only the prior, because
 * θ = 0 with SE = 1 is "we know nothing yet", not a measurement: handing it to
 * generation would look like adaptivity while actually being a constant, and a
 * caller that already has a difficulty rule must keep using it.
 */
export function measuredFromTarget(target: AdaptiveTarget): MeasuredDifficulty | null {
    if (target.source !== 'measured') return null;

    return {
        difficulty: difficultyLabelFor(target.targetDifficulty),
        targetDifficulty: target.targetDifficulty,
        intensity: target.intensity,
        competencyId: target.competencyId,
        competencyName: target.competencyName,
        theta: target.theta,
        standardError: target.standardError,
        responsesUsed: target.responsesUsed,
        shouldStop: target.stop.shouldStop,
    };
}
