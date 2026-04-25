// ============================================
// badgeEngine.ts — Badge / Gamification Engine
// Part of the Gamification System (Step 9)
// Evaluates eligibility and awards badges transactionally
// ============================================

import prisma from '@/lib/prisma';

// ============================================
// Badge Definitions
// ============================================

/** Shape of a badge definition (eligibility criteria) */
interface BadgeDefinition {
    /** Unique badge name (matches Badge.badgeName in schema) */
    badgeName: string;
    /** Human-readable description */
    description: string;
    /** Predicate that determines eligibility */
    isEligible: (ctx: BadgeContext) => boolean;
}

/** Context data used to evaluate badge eligibility */
interface BadgeContext {
    /** Overall readiness score from ReadinessIndex */
    readinessScore: number;
    /** Technical average from latest ScoreBreakdown */
    technicalAverage: number;
    /** Communication average from latest ScoreBreakdown */
    communicationAverage: number;
    /** Confidence average from latest ScoreBreakdown */
    confidenceAverage: number;
    /** Logic average from latest ScoreBreakdown */
    logicAverage: number;
    /** Depth average from latest ScoreBreakdown */
    depthAverage: number;
    /** Total interview sessions completed by this user */
    totalSessions: number;
}

/**
 * Registry of all available badges and their eligibility criteria.
 * To add a new badge, simply add an entry here — no other code changes needed.
 */
const BADGE_DEFINITIONS: ReadonlyArray<BadgeDefinition> = [
    {
        badgeName: 'DSA Master',
        description: 'Achieved a technical average of 85 or above',
        isEligible: (ctx) => ctx.technicalAverage >= 85,
    },
    {
        badgeName: 'Communication Pro',
        description: 'Achieved a communication average of 80 or above',
        isEligible: (ctx) => ctx.communicationAverage >= 80,
    },
    {
        badgeName: 'Interview Ready',
        description: 'Achieved a readiness score of 85 or above',
        isEligible: (ctx) => ctx.readinessScore >= 85,
    },
    {
        badgeName: 'Consistent Performer',
        description: 'Completed 10 or more interview sessions',
        isEligible: (ctx) => ctx.totalSessions >= 10,
    },
] as const;

/** Shape of a newly awarded badge returned to callers */
export interface AwardedBadge {
    badgeName: string;
    description: string;
    awardedAt: Date;
    isNew: boolean;
}

/**
 * Evaluates badge eligibility and awards new badges.
 *
 * Flow:
 * 1. Fetch ReadinessIndex, latest ScoreBreakdown, and total session count
 * 2. Build badge context
 * 3. Evaluate each badge definition against context
 * 4. For eligible badges not yet awarded, create new Badge records
 * 5. Return all badges (with isNew flag for newly awarded ones)
 *
 * Guarantees:
 * - No duplicate badge inserts (uses @@unique([userId, badgeName]) + findUnique guard)
 * - All writes in prisma.$transaction
 * - Never throws to caller — returns empty array on failure
 * - No LLM calls
 * - Never modifies scoring or adaptive logic
 *
 * @param userId - The user to evaluate badges for
 * @returns Array of all user badges with new/existing flag
 */
export async function evaluateAndAwardBadges(userId: string): Promise<AwardedBadge[]> {
    try {
        const result = await prisma.$transaction(async (tx) => {
            // 1. Fetch readiness score
            const readiness = await tx.readinessIndex.findUnique({
                where: { userId },
                select: { readinessScore: true },
            });

            // 2. Fetch latest session + score breakdown
            const latestSession = await tx.interviewSession.findFirst({
                where: { userId },
                orderBy: { startedAt: 'desc' },
                select: { id: true },
            });

            let breakdown: {
                technicalAverage: number;
                communicationAverage: number;
                confidenceAverage: number;
                logicAverage: number;
                depthAverage: number;
            } | null = null;

            if (latestSession) {
                breakdown = await tx.scoreBreakdown.findUnique({
                    where: { sessionId: latestSession.id },
                    select: {
                        technicalAverage: true,
                        communicationAverage: true,
                        confidenceAverage: true,
                        logicAverage: true,
                        depthAverage: true,
                    },
                });
            }

            // 3. Count total sessions
            const totalSessions = await tx.interviewSession.count({
                where: { userId },
            });

            // 4. Build context
            const ctx: BadgeContext = {
                readinessScore: readiness?.readinessScore ?? 0,
                technicalAverage: breakdown?.technicalAverage ?? 0,
                communicationAverage: breakdown?.communicationAverage ?? 0,
                confidenceAverage: breakdown?.confidenceAverage ?? 0,
                logicAverage: breakdown?.logicAverage ?? 0,
                depthAverage: breakdown?.depthAverage ?? 0,
                totalSessions,
            };

            // 5. Fetch existing badges for this user
            const existingBadges = await tx.badge.findMany({
                where: { userId },
                select: { badgeName: true, awardedAt: true },
            });
            const existingBadgeNames = new Set(existingBadges.map((b) => b.badgeName));

            // 6. Evaluate eligibility and award new badges
            const allBadges: AwardedBadge[] = [];
            const newlyAwarded: string[] = [];

            for (const def of BADGE_DEFINITIONS) {
                const alreadyHas = existingBadgeNames.has(def.badgeName);

                if (alreadyHas) {
                    // Already awarded — include in results as existing
                    const existing = existingBadges.find((b) => b.badgeName === def.badgeName);
                    allBadges.push({
                        badgeName: def.badgeName,
                        description: def.description,
                        awardedAt: existing?.awardedAt ?? new Date(),
                        isNew: false,
                    });
                } else if (def.isEligible(ctx)) {
                    // Eligible and not yet awarded — create
                    newlyAwarded.push(def.badgeName);
                    allBadges.push({
                        badgeName: def.badgeName,
                        description: def.description,
                        awardedAt: new Date(),
                        isNew: true,
                    });
                }
                // Not eligible and not awarded — skip
            }

            // 7. Batch-create new badges
            if (newlyAwarded.length > 0) {
                for (const badgeName of newlyAwarded) {
                    await tx.badge.create({
                        data: {
                            userId,
                            badgeName,
                            awardedAt: new Date(),
                        },
                    });
                }
            }

            return allBadges;
        });

        return result;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[BadgeEngine] evaluateAndAwardBadges failed:', message);
        return [];
    }
}

/**
 * Fetches all badges for a user (read-only, no evaluation).
 *
 * @param userId - The user whose badges to fetch
 * @returns Array of badge records
 */
export async function getUserBadges(userId: string): Promise<AwardedBadge[]> {
    try {
        const badges = await prisma.badge.findMany({
            where: { userId },
            orderBy: { awardedAt: 'desc' },
            select: { badgeName: true, awardedAt: true },
        });

        return badges.map((b) => {
            const def = BADGE_DEFINITIONS.find((d) => d.badgeName === b.badgeName);
            return {
                badgeName: b.badgeName,
                description: def?.description ?? '',
                awardedAt: b.awardedAt,
                isNew: false,
            };
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[BadgeEngine] getUserBadges failed:', message);
        return [];
    }
}
