// ============================================
// adaptiveOrchestrator.ts — Adaptive Flow Coordinator
// Part of the Adaptive Difficulty Engine
// Orchestrates difficulty transition + question selection
// All DB writes are transactional
// ============================================

import supabaseDb from '@/lib/supabaseDb';
import { getNextDifficulty, type DifficultyLevel, type DifficultyRecommendation } from './difficultyEngine';
import { selectNextQuestion, type SelectedQuestion } from './questionSelector';
import { resolveMeasuredDifficulty, type MeasuredDifficulty } from '@/lib/measurement/adaptiveBridge';

/** Parameters for the adaptive step */
export interface AdaptiveStepParams {
    /** The current interview session ID */
    sessionId: string;
    /** The user who owns the session */
    userId: string;
    /** The current difficulty level of the session */
    currentDifficulty: DifficultyLevel;
    /** The LLM's difficulty recommendation from the evaluation */
    evaluationRecommendation: DifficultyRecommendation;
    /** Weak topics identified by the evaluation */
    weakTopics: string[];
    /** Restrict the measured target to one competency (optional). */
    competencyId?: string | null;
    /** Items asked so far in this session, for the measurement stop rule. */
    itemsAnswered?: number;
}

/** Result of the adaptive step */
export interface AdaptiveStepResult {
    /** The new difficulty level for the session */
    nextDifficulty: DifficultyLevel;
    /** The next question to present, or null if none available */
    nextQuestion: SelectedQuestion | null;
    /**
     * The measured decision behind `nextDifficulty`, when the candidate has
     * enough history to measure. Null means the difficulty came from the
     * evaluation's recommendation instead — the pre-measurement behaviour, kept
     * for candidates the engine has no data on yet.
     */
    measured: MeasuredDifficulty | null;
}

/**
 * Processes a single adaptive difficulty step:
 *
 * 1. Determine next difficulty — from measurement when the candidate has been
 *    measured on this competency, otherwise from the evaluation's recommendation
 * 2. Update InterviewSession.difficulty in DB (transactional)
 * 3. Select the next question from the question bank
 *
 * Guarantees:
 * - DB writes are wrapped in supabaseDb.$transaction
 * - Never partially updates session
 * - Returns safe fallback on DB error (same difficulty, null question)
 * - Never calls LLM
 * - Never mutates input
 * - A measurement failure degrades to the recommendation path, never to an error
 *
 * @param params - Adaptive step parameters
 * @returns The next difficulty, the measured decision behind it, and the selected question
 */
export async function processAdaptiveStep(
    params: AdaptiveStepParams
): Promise<AdaptiveStepResult> {
    const {
        sessionId,
        userId,
        currentDifficulty,
        evaluationRecommendation,
        weakTopics,
    } = params;

    // Step 1: Resolve next difficulty.
    //
    // Measurement takes precedence when it has evidence: it is derived from how
    // this candidate actually answered, where the recommendation is the scoring
    // model's self-report. `resolveMeasuredDifficulty` returns null (rather than
    // throwing) when there is nothing measured, so the fallback below is the
    // normal path for a new candidate and the exceptional path otherwise.
    const measured = await resolveMeasuredDifficulty({
        userId,
        competencyId: params.competencyId ?? null,
        itemsAnswered: params.itemsAnswered,
    });

    const nextDifficulty = measured
        ? measured.difficulty
        : getNextDifficulty(currentDifficulty, evaluationRecommendation);

    // Step 2: Update session difficulty in a transaction
    try {
        await supabaseDb.$transaction(async (tx) => {
            await tx.interviewSession.update({
                where: { id: sessionId },
                data: { difficulty: nextDifficulty },
            });
        });
    } catch (dbError) {
        const message = dbError instanceof Error ? dbError.message : 'Unknown DB error';
        console.error(
            '[AdaptiveOrchestrator] Failed to update session difficulty (rolled back):',
            message
        );
        // Return safe fallback: maintain current difficulty, no question. The
        // measured decision is dropped with it — reporting a measured difficulty
        // that was never persisted would disagree with the value returned.
        return {
            nextDifficulty: currentDifficulty,
            nextQuestion: null,
            measured: null,
        };
    }

    // Step 3: Select next question
    let nextQuestion: SelectedQuestion | null = null;
    try {
        nextQuestion = await selectNextQuestion({
            sessionId,
            difficulty: nextDifficulty,
            weakTopics,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[AdaptiveOrchestrator] Question selection failed:', message);
        // Question selection failure is non-fatal; return null question
    }

    return {
        nextDifficulty,
        nextQuestion,
        measured,
    };
}
