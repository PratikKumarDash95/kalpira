// ============================================
// readinessCalculator.ts — Pure Readiness Score Computation
// Part of the Readiness Index Engine (Step 7)
// Purely functional — no DB, no side effects, no throws
// ============================================

/** Valid difficulty levels */
export type DifficultyLevel = 'easy' | 'medium' | 'hard';

/** Input parameters for readiness calculation */
export interface ReadinessParams {
    /** Weighted overall score from ScoreBreakdown (0–100) */
    overallScore: number;
    /** Average technical score across session responses */
    technicalAverage: number;
    /** Average communication score across session responses */
    communicationAverage: number;
    /** Average confidence score across session responses */
    confidenceAverage: number;
    /** Average logic score across session responses */
    logicAverage: number;
    /** Average depth score across session responses */
    depthAverage: number;
    /** Number of distinct weak skills in WeakSkillMemory */
    weakSkillCount: number;
    /** Current interview session difficulty */
    currentDifficulty: DifficultyLevel;
    /** Total completed interview sessions for this user */
    totalSessions: number;
}

// ============================================
// Configuration constants
// ============================================

/** Weight applied to overallScore in base calculation */
const BASE_SCORE_WEIGHT = 0.6;

/** Points subtracted per weak skill */
const WEAK_SKILL_PENALTY_PER = 1.5;

/** Maximum total penalty from weak skills */
const MAX_WEAK_SKILL_PENALTY = 20;

/** Bonus points by difficulty level */
const DIFFICULTY_BONUS: Record<DifficultyLevel, number> = {
    easy: 0,
    medium: 5,
    hard: 10,
} as const;

/** Session consistency thresholds and bonuses */
const CONSISTENCY_TIERS: ReadonlyArray<{ minSessions: number; bonus: number }> = [
    { minSessions: 10, bonus: 8 },
    { minSessions: 5, bonus: 5 },
] as const;

/** Valid difficulty values for runtime guard */
const VALID_DIFFICULTIES: ReadonlySet<string> = new Set(['easy', 'medium', 'hard']);

/**
 * Rounds a number to 2 decimal places.
 */
function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * Clamps a value to the [0, 100] range.
 */
function clamp0to100(value: number): number {
    return Math.min(100, Math.max(0, value));
}

/**
 * Computes the Interview Readiness percentage.
 *
 * Formula:
 *   readiness = baseScore + difficultyBonus + consistencyBonus - weakSkillPenalty
 *
 * Where:
 *   baseScore         = overallScore * 0.6
 *   weakSkillPenalty   = min(weakSkillCount * 1.5, 20)
 *   difficultyBonus    = { easy: 0, medium: 5, hard: 10 }
 *   consistencyBonus   = { ≥10 sessions: 8, ≥5 sessions: 5, else: 0 }
 *
 * Guarantees:
 * - Result is always [0, 100]
 * - Rounded to 2 decimal places
 * - Never negative
 * - Never throws
 * - Pure function, deterministic
 *
 * @param params - Readiness calculation inputs
 * @returns Readiness score between 0 and 100
 */
export function calculateReadiness(params: ReadinessParams): number {
    const {
        overallScore,
        weakSkillCount,
        currentDifficulty,
        totalSessions,
    } = params;

    // Step 1: Base score
    const safeOverall = clamp0to100(typeof overallScore === 'number' ? overallScore : 0);
    const baseScore = safeOverall * BASE_SCORE_WEIGHT;

    // Step 2: Weak skill penalty
    const safeWeakCount = Math.max(0, Math.floor(weakSkillCount || 0));
    const weakPenalty = Math.min(safeWeakCount * WEAK_SKILL_PENALTY_PER, MAX_WEAK_SKILL_PENALTY);

    // Step 3: Difficulty bonus
    const safeDifficulty = VALID_DIFFICULTIES.has(currentDifficulty)
        ? currentDifficulty
        : 'easy';
    const difficultyBonus = DIFFICULTY_BONUS[safeDifficulty];

    // Step 4: Consistency bonus
    const safeSessions = Math.max(0, Math.floor(totalSessions || 0));
    let consistencyBonus = 0;
    for (const tier of CONSISTENCY_TIERS) {
        if (safeSessions >= tier.minSessions) {
            consistencyBonus = tier.bonus;
            break; // Tiers are sorted DESC by minSessions — first match wins
        }
    }

    // Step 5: Final calculation
    const rawReadiness = baseScore - weakPenalty + difficultyBonus + consistencyBonus;

    return round2(clamp0to100(rawReadiness));
}
