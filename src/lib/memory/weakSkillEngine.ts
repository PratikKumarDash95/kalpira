// ============================================
// weakSkillEngine.ts — Weak Skill Query Engine
// Part of the Weak Skill Memory Engine
// Read-only — fetches top weak skills by frequency
// ============================================

import prisma from '@/lib/prisma';

/**
 * Retrieves the top N weakest skills for a user, ordered by weakness frequency.
 *
 * Guarantees:
 * - Read-only operation — no DB writes
 * - Never throws to caller — returns empty array on DB failure
 * - Returns topic names only (not full records)
 * - Results are ordered by weaknessCount DESC
 *
 * @param userId - The user whose weak skills to retrieve
 * @param limit - Maximum number of skills to return (default: 5)
 * @returns Array of topic name strings, ordered by descending weakness count
 */
export async function getTopWeakSkills(
    userId: string,
    limit: number = 5
): Promise<string[]> {
    try {
        const records = await prisma.weakSkillMemory.findMany({
            where: { userId },
            orderBy: { weaknessCount: 'desc' },
            take: Math.max(1, Math.floor(limit)),
            select: { skillName: true },
        });

        return records.map((r) => r.skillName);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[WeakSkillEngine] Failed to fetch top weak skills:', message);
        return [];
    }
}
