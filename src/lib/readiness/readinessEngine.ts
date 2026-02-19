// ============================================
// readinessEngine.ts — Readiness Index Persistence
// Part of the Readiness Index Engine (Step 7)
// Fetches data, computes readiness, upserts atomically
// ============================================

import prisma from '@/lib/prisma';
import { calculateReadiness, type DifficultyLevel } from './readinessCalculator';

/** Valid difficulty values for runtime guard */
const VALID_DIFFICULTIES: ReadonlySet<string> = new Set(['easy', 'medium', 'hard']);

/**
 * Updates (or creates) the ReadinessIndex for a user.
 *
 * Flow:
 * 1. Fetch latest InterviewSession (most recent by startedAt)
 * 2. Fetch corresponding ScoreBreakdown
 * 3. Count distinct WeakSkillMemory records
 * 4. Count total sessions for the user
 * 5. Compute readiness score via calculateReadiness()
 * 6. Upsert ReadinessIndex record (atomic transaction)
 *
 * Guarantees:
 * - All data fetched within a single transaction for consistency
 * - Never partially updates ReadinessIndex
 * - Returns 0 if user has no sessions
 * - Never throws to caller — returns safe fallback on error
 *
 * @param userId - The user whose readiness index to compute
 * @returns The computed readiness score (0–100)
 */
export async function updateReadinessIndex(userId: string): Promise<number> {
    try {
        const readinessScore = await prisma.$transaction(async (tx) => {
            // 1. Fetch the latest session
            const latestSession = await tx.interviewSession.findFirst({
                where: { userId },
                orderBy: { startedAt: 'desc' },
                select: {
                    id: true,
                    difficulty: true,
                },
            });

            // If no sessions exist, readiness is 0
            if (!latestSession) {
                await tx.readinessIndex.upsert({
                    where: { userId },
                    create: {
                        userId,
                        readinessScore: 0,
                        calculatedAt: new Date(),
                    },
                    update: {
                        readinessScore: 0,
                        calculatedAt: new Date(),
                    },
                });
                return 0;
            }

            // 2. Fetch ScoreBreakdown for the latest session
            const breakdown = await tx.scoreBreakdown.findUnique({
                where: { sessionId: latestSession.id },
                select: {
                    overallScore: true,
                    technicalAverage: true,
                    communicationAverage: true,
                    confidenceAverage: true,
                    logicAverage: true,
                    depthAverage: true,
                },
            });

            // 3. Count weak skills
            const weakSkillCount = await tx.weakSkillMemory.count({
                where: { userId },
            });

            // 4. Count total sessions
            const totalSessions = await tx.interviewSession.count({
                where: { userId },
            });

            // 5. Compute readiness
            const currentDifficulty: DifficultyLevel = VALID_DIFFICULTIES.has(latestSession.difficulty)
                ? (latestSession.difficulty as DifficultyLevel)
                : 'easy';

            const score = calculateReadiness({
                overallScore: breakdown?.overallScore ?? 0,
                technicalAverage: breakdown?.technicalAverage ?? 0,
                communicationAverage: breakdown?.communicationAverage ?? 0,
                confidenceAverage: breakdown?.confidenceAverage ?? 0,
                logicAverage: breakdown?.logicAverage ?? 0,
                depthAverage: breakdown?.depthAverage ?? 0,
                weakSkillCount,
                currentDifficulty,
                totalSessions,
            });

            // 6. Upsert ReadinessIndex
            await tx.readinessIndex.upsert({
                where: { userId },
                create: {
                    userId,
                    readinessScore: score,
                    calculatedAt: new Date(),
                },
                update: {
                    readinessScore: score,
                    calculatedAt: new Date(),
                },
            });

            return score;
        });

        return readinessScore;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[ReadinessEngine] updateReadinessIndex failed:', message);
        return 0;
    }
}

/**
 * Fetches the current readiness score for a user without recalculating.
 * Returns 0 if no record exists.
 *
 * @param userId - The user whose readiness to fetch
 * @returns The stored readiness score (0–100)
 */
export async function getReadinessScore(userId: string): Promise<number> {
    try {
        const record = await prisma.readinessIndex.findUnique({
            where: { userId },
            select: { readinessScore: true },
        });
        return record?.readinessScore ?? 0;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[ReadinessEngine] getReadinessScore failed:', message);
        return 0;
    }
}
