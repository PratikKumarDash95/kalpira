// ============================================
// memoryUpdater.ts — Weak Skill Memory Persistence
// Part of the Weak Skill Memory Engine
// Transactional upsert of weak skill records
// ============================================

import prisma from '@/lib/prisma';

/** Shape of a weak skill memory record returned to callers */
export interface WeakSkillRecord {
    id: string;
    userId: string;
    skillName: string;
    weaknessCount: number;
    lastOccurredAt: Date;
}

/**
 * Normalizes a topic string for consistent storage and lookup.
 * - Trims whitespace
 * - Converts to lowercase
 * - Collapses multiple spaces
 */
function normalizeTopic(topic: string): string {
    return topic.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Updates the WeakSkillMemory table for a user based on newly identified weak topics.
 *
 * For each topic:
 * - If a record exists for (userId, skillName): increment weaknessCount, update lastOccurredAt
 * - If no record exists: create with weaknessCount = 1, lastOccurredAt = now
 *
 * Guarantees:
 * - All writes in a single prisma.$transaction (atomic)
 * - Topics are normalized (trimmed, lowercased) before storage
 * - Duplicate entries are impossible due to @@unique([userId, skillName])
 * - Empty or whitespace-only topics are silently skipped
 * - Never overwrites incorrectly
 * - Never throws to caller (returns empty array on DB failure)
 *
 * @param userId - The user whose weak skills are being updated
 * @param weakTopics - Array of weak topic strings from the evaluation
 * @returns Updated WeakSkillMemory records sorted DESC by weaknessCount
 */
export async function updateWeakSkills(
    userId: string,
    weakTopics: string[]
): Promise<WeakSkillRecord[]> {
    // Filter and normalize topics
    const normalizedTopics = weakTopics
        .map(normalizeTopic)
        .filter((topic) => topic.length > 0);

    // Deduplicate within the batch to avoid race conditions
    const uniqueTopics = Array.from(new Set(normalizedTopics));

    if (uniqueTopics.length === 0) {
        // No valid topics — return current records without modification
        return fetchSortedWeakSkills(userId);
    }

    try {
        await prisma.$transaction(async (tx) => {
            for (const skillName of uniqueTopics) {
                // Check if record exists
                const existing = await tx.weakSkillMemory.findUnique({
                    where: {
                        userId_skillName: {
                            userId,
                            skillName,
                        },
                    },
                });

                if (existing) {
                    // Increment count and update timestamp
                    await tx.weakSkillMemory.update({
                        where: { id: existing.id },
                        data: {
                            weaknessCount: existing.weaknessCount + 1,
                            lastOccurredAt: new Date(),
                        },
                    });
                } else {
                    // Create new record
                    await tx.weakSkillMemory.create({
                        data: {
                            userId,
                            skillName,
                            weaknessCount: 1,
                            lastOccurredAt: new Date(),
                        },
                    });
                }
            }
        });
    } catch (dbError) {
        const message = dbError instanceof Error ? dbError.message : 'Unknown DB error';
        console.error('[MemoryUpdater] Transaction failed (rolled back):', message);
        // Return current state on failure — no partial writes
        return fetchSortedWeakSkills(userId);
    }

    // Return all weak skills sorted by weakness count
    return fetchSortedWeakSkills(userId);
}

/**
 * Fetches all WeakSkillMemory records for a user, sorted by weaknessCount DESC.
 */
async function fetchSortedWeakSkills(userId: string): Promise<WeakSkillRecord[]> {
    try {
        const records = await prisma.weakSkillMemory.findMany({
            where: { userId },
            orderBy: { weaknessCount: 'desc' },
            select: {
                id: true,
                userId: true,
                skillName: true,
                weaknessCount: true,
                lastOccurredAt: true,
            },
        });
        return records;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[MemoryUpdater] Failed to fetch weak skills:', message);
        return [];
    }
}
