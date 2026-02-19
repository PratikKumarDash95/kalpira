// ============================================
// adaptiveOrchestrator.ts — Adaptive Flow Coordinator
// Part of the Adaptive Difficulty Engine
// Orchestrates difficulty transition + question selection
// All DB writes are transactional
// ============================================

import prisma from '@/lib/prisma';
import { getNextDifficulty, type DifficultyLevel, type DifficultyRecommendation } from './difficultyEngine';
import { selectNextQuestion, type SelectedQuestion } from './questionSelector';

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
}

/** Result of the adaptive step */
export interface AdaptiveStepResult {
    /** The new difficulty level for the session */
    nextDifficulty: DifficultyLevel;
    /** The next question to present, or null if none available */
    nextQuestion: SelectedQuestion | null;
}

/**
 * Processes a single adaptive difficulty step:
 *
 * 1. Determine next difficulty using the state machine
 * 2. Update InterviewSession.difficulty in DB (transactional)
 * 3. Select the next question from the question bank
 *
 * Guarantees:
 * - DB writes are wrapped in prisma.$transaction
 * - Never partially updates session
 * - Returns safe fallback on DB error (same difficulty, null question)
 * - Never calls LLM
 * - Never mutates input
 *
 * @param params - Adaptive step parameters
 * @returns The next difficulty and selected question
 */
export async function processAdaptiveStep(
    params: AdaptiveStepParams
): Promise<AdaptiveStepResult> {
    const {
        sessionId,
        currentDifficulty,
        evaluationRecommendation,
        weakTopics,
    } = params;

    // Step 1: Compute next difficulty (pure, never throws)
    const nextDifficulty = getNextDifficulty(currentDifficulty, evaluationRecommendation);

    // Step 2: Update session difficulty in a transaction
    try {
        await prisma.$transaction(async (tx) => {
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
        // Return safe fallback: maintain current difficulty, no question
        return {
            nextDifficulty: currentDifficulty,
            nextQuestion: null,
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
    };
}
