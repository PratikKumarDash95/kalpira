// ============================================
// coachEngine.ts — Combined Coach Engine Orchestrator
// Wires Adaptive Difficulty + Weak Skill Memory into a single step
// This is the primary integration point for API routes
// ============================================
//
// ARCHITECTURE:
//   evaluateResponse() → produces EvaluationResult
//   processInterviewStep() → consumes EvaluationResult
//     ├── processMemoryUpdate()   (memory layer, independent)
//     └── processAdaptiveStep()   (adaptive layer, uses weak topics from memory)
//
// No LLM calls. No scoring logic. Behavior layer only.
// ============================================

import { processAdaptiveStep, type AdaptiveStepResult } from './adaptive/adaptiveOrchestrator';
import { processMemoryUpdate, type MemoryUpdateResult } from './memory/memoryOrchestrator';
import type { DifficultyLevel, DifficultyRecommendation } from './adaptive/difficultyEngine';
import type { SelectedQuestion } from './adaptive/questionSelector';
import type { EvaluationResult } from './evaluation/evaluationSchema';

/** Parameters for processing one complete interview step */
export interface InterviewStepParams {
    /** The current interview session ID */
    sessionId: string;
    /** The user who owns the session */
    userId: string;
    /** The current difficulty level of the session */
    currentDifficulty: DifficultyLevel;
    /** The evaluation result from evaluateResponse() */
    evaluationResult: EvaluationResult;
}

/** Complete result from the combined coach engine step */
export interface InterviewStepResult {
    /** The new difficulty level for the session */
    nextDifficulty: DifficultyLevel;
    /** The next question to present, or null if none available */
    nextQuestion: SelectedQuestion | null;
    /** All updated weak skill records */
    updatedWeakSkills: MemoryUpdateResult['updatedWeakSkills'];
    /** Top weak skill names for quick access */
    topWeakSkills: string[];
}

/**
 * Processes a complete interview coaching step after evaluation.
 *
 * Flow:
 * 1. Process memory update (independent — writes weak topics to DB)
 * 2. Process adaptive step (uses weak topics to select next question)
 * 3. Return combined result
 *
 * Guarantees:
 * - No LLM calls
 * - No scoring logic duplication
 * - Memory and adaptive layers are independent modules
 * - Never throws — returns safe fallback on total failure
 * - Never mutates input params
 *
 * Integration point:
 *   Called after evaluateResponse() in the API route.
 *   Consumes evaluationResult.difficulty_recommendation and evaluationResult.weak_topics.
 *
 * @param params - Interview step parameters
 * @returns Combined result with next difficulty, next question, and weak skills
 */
export async function processInterviewStep(
    params: InterviewStepParams
): Promise<InterviewStepResult> {
    const { sessionId, userId, currentDifficulty, evaluationResult } = params;

    // Extract only what we need from the evaluation (no score data used)
    const recommendation: DifficultyRecommendation = evaluationResult.difficulty_recommendation;
    const weakTopics: string[] = evaluationResult.weak_topics;

    // Step 1: Process memory update (independent, non-blocking to adaptive)
    let memoryResult: MemoryUpdateResult;
    try {
        memoryResult = await processMemoryUpdate({
            userId,
            weakTopics,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[CoachEngine] Memory update failed:', message);
        memoryResult = {
            updatedWeakSkills: [],
            topWeakSkills: [],
        };
    }

    // Step 2: Process adaptive step (uses weak topics from evaluation for question selection)
    let adaptiveResult: AdaptiveStepResult;
    try {
        adaptiveResult = await processAdaptiveStep({
            sessionId,
            userId,
            currentDifficulty,
            evaluationRecommendation: recommendation,
            weakTopics,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[CoachEngine] Adaptive step failed:', message);
        adaptiveResult = {
            nextDifficulty: currentDifficulty,
            nextQuestion: null,
        };
    }

    // Step 3: Combine and return
    return {
        nextDifficulty: adaptiveResult.nextDifficulty,
        nextQuestion: adaptiveResult.nextQuestion,
        updatedWeakSkills: memoryResult.updatedWeakSkills,
        topWeakSkills: memoryResult.topWeakSkills,
    };
}
