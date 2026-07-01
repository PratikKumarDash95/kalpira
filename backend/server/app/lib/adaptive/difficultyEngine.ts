// ============================================
// difficultyEngine.ts — Deterministic Difficulty State Machine
// Part of the Adaptive Difficulty Engine
// Pure function — no DB, no side effects, no throws
// ============================================

/** Valid difficulty levels for interview sessions */
export type DifficultyLevel = 'easy' | 'medium' | 'hard';

/** LLM-generated recommendation for next difficulty */
export type DifficultyRecommendation = 'increase' | 'decrease' | 'maintain';

/**
 * Transition table for deterministic difficulty progression.
 * Row = current difficulty, column = recommendation.
 * Guarantees: no level skipping, no invalid states.
 */
const TRANSITION_TABLE: Record<DifficultyLevel, Record<DifficultyRecommendation, DifficultyLevel>> = {
    easy: {
        increase: 'medium',
        decrease: 'easy',
        maintain: 'easy',
    },
    medium: {
        increase: 'hard',
        decrease: 'easy',
        maintain: 'medium',
    },
    hard: {
        increase: 'hard',
        decrease: 'medium',
        maintain: 'hard',
    },
} as const;

/** Valid difficulty values for runtime guard */
const VALID_DIFFICULTIES: ReadonlySet<string> = new Set(['easy', 'medium', 'hard']);

/** Valid recommendations for runtime guard */
const VALID_RECOMMENDATIONS: ReadonlySet<string> = new Set(['increase', 'decrease', 'maintain']);

/**
 * Computes the next difficulty level based on current state and LLM recommendation.
 *
 * Guarantees:
 * - Never skips levels (easy → hard impossible)
 * - Never returns invalid state
 * - Never throws — returns current difficulty on invalid input
 * - Pure function, deterministic
 *
 * @param currentDifficulty - The current session difficulty
 * @param recommendation - The LLM's difficulty recommendation
 * @returns The next difficulty level
 */
export function getNextDifficulty(
    currentDifficulty: DifficultyLevel,
    recommendation: DifficultyRecommendation
): DifficultyLevel {
    // Runtime guard: validate inputs even though TypeScript enforces at compile time
    if (!VALID_DIFFICULTIES.has(currentDifficulty)) {
        console.warn(
            `[DifficultyEngine] Invalid currentDifficulty: "${currentDifficulty}", defaulting to "medium"`
        );
        return 'medium';
    }

    if (!VALID_RECOMMENDATIONS.has(recommendation)) {
        console.warn(
            `[DifficultyEngine] Invalid recommendation: "${recommendation}", maintaining current: "${currentDifficulty}"`
        );
        return currentDifficulty;
    }

    return TRANSITION_TABLE[currentDifficulty][recommendation];
}
