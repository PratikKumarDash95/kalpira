// ============================================
// memoryOrchestrator.ts — Memory Layer Coordinator
// Part of the Weak Skill Memory Engine
// Orchestrates weak skill updates and retrieval
// Independent from adaptive layer — no scoring, no difficulty logic
// ============================================

import { updateWeakSkills, type WeakSkillRecord } from './memoryUpdater';
import { getTopWeakSkills } from './weakSkillEngine';

/** Parameters for memory update */
export interface MemoryUpdateParams {
    /** The user whose weak skills are being tracked */
    userId: string;
    /** Weak topics identified by the latest evaluation */
    weakTopics: string[];
}

/** Result of the memory update */
export interface MemoryUpdateResult {
    /** All updated weak skill records (sorted by weaknessCount DESC) */
    updatedWeakSkills: WeakSkillRecord[];
    /** Top weak skill names for quick access */
    topWeakSkills: string[];
}

/** Default number of top weak skills to return */
const DEFAULT_TOP_SKILLS_LIMIT = 5;

/**
 * Processes a memory update step after evaluation:
 *
 * 1. If weak topics are present: update/create WeakSkillMemory records
 * 2. Return updated records + top N weak skill names
 *
 * If weakTopics is empty:
 * - No DB writes occur
 * - Returns current weakness state as-is
 *
 * Guarantees:
 * - No scoring recalculation
 * - No adaptive difficulty logic
 * - Memory layer is fully independent
 * - Never throws — returns safe fallback on error
 *
 * @param params - Memory update parameters
 * @returns Updated weak skills and top weak skill names
 */
export async function processMemoryUpdate(
    params: MemoryUpdateParams
): Promise<MemoryUpdateResult> {
    const { userId, weakTopics } = params;

    try {
        let updatedWeakSkills: WeakSkillRecord[];

        if (weakTopics.length === 0) {
            // No new weak topics — just fetch current state
            updatedWeakSkills = [];
        } else {
            // Update weak skills and get sorted results
            updatedWeakSkills = await updateWeakSkills(userId, weakTopics);
        }

        // Always fetch top skills (reflects latest state)
        const topWeakSkills = await getTopWeakSkills(userId, DEFAULT_TOP_SKILLS_LIMIT);

        return {
            updatedWeakSkills,
            topWeakSkills,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[MemoryOrchestrator] processMemoryUpdate failed:', message);

        // Safe fallback: return empty state
        return {
            updatedWeakSkills: [],
            topWeakSkills: [],
        };
    }
}
