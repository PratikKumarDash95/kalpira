// ============================================
// adaptiveBridge.ts — Competency Measurement Engine ↔ Adaptive Flow
// Feature 1 — the seam between measurement and the interview
// ============================================
//
// WHY THIS FILE EXISTS
//
// The measurement engine (lib/measurement/*) knows *how hard* the next question
// should be. The adaptive flow (lib/adaptive/*) is what actually moves the
// interview. Neither should import the other's internals, and the adaptive flow
// must keep working exactly as before when there is nothing measured yet — so
// this module is the only place the two meet.
//
// WHAT IT REPLACES
//
// Before this, the next difficulty came from the LLM's self-reported
// increase/decrease/maintain, walked one notch along easy → medium → hard. That
// is a three-valued guess with no candidate-specific evidence behind it. Now,
// when the candidate has measured history for the competency being tested, the
// difficulty comes from their estimated ability instead, and the LLM is left to
// decide *what* to ask while the engine decides *how hard*.
//
// The LLM's recommendation is still used when there is no measurement, which is
// every candidate's first sessions — the engine has to earn its authority with
// data rather than assume it.
//
// Failure is never fatal here: any error returns null and the caller keeps its
// own heuristic. Measurement is an improvement to the interview, not a
// dependency of it.
//
// The translation itself — target in, difficulty decision out — is pure and lives
// in ./measuredDifficulty so it can be tested without a database. This file is
// only the part that has to touch one.

import { getAdaptiveTarget } from './abilityService';
import { measuredFromTarget, type MeasuredDifficulty } from './measuredDifficulty';

export { measuredFromTarget };
export type { MeasuredDifficulty };

/**
 * Asks the measurement engine what to aim at next, for a candidate.
 *
 * @returns The measured difficulty, or `null` when the candidate has no measured
 *          ability for the competency — in which case the caller must fall back
 *          to its own rule rather than treating θ = 0 as an estimate. Never
 *          throws: a measurement outage degrades the interview, it does not break it.
 */
export async function resolveMeasuredDifficulty(params: {
    userId: string;
    competencyId?: string | null;
    itemsAnswered?: number;
    itemsAvailable?: number;
}): Promise<MeasuredDifficulty | null> {
    try {
        const target = await getAdaptiveTarget({
            userId: params.userId,
            competencyId: params.competencyId,
            itemsAnswered: params.itemsAnswered,
            itemsAvailable: params.itemsAvailable,
        });

        return measuredFromTarget(target);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[MeasurementBridge] Target lookup failed:', message);
        return null;
    }
}
