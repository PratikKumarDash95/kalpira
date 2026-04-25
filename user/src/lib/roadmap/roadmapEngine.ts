// ============================================
// roadmapEngine.ts — Roadmap Persistence Engine
// Part of the Roadmap Engine (Step 8)
// Fetches data, generates roadmap, stores atomically
// ============================================

import prisma from '@/lib/prisma';
import { generateRoadmap, type Roadmap, type DifficultyLevel } from './roadmapGenerator';

/** Valid difficulty values for runtime guard */
const VALID_DIFFICULTIES: ReadonlySet<string> = new Set(['easy', 'medium', 'hard']);

/** Default number of weak skills to fetch for roadmap generation */
const WEAK_SKILLS_LIMIT = 10;

/**
 * Generates a 30-day improvement roadmap and persists it to the ImprovementPlan table.
 *
 * Flow:
 * 1. Fetch user's weak skills (sorted by weaknessCount DESC)
 * 2. Fetch latest ScoreBreakdown
 * 3. Fetch current difficulty from latest session
 * 4. Generate roadmap via pure logic
 * 5. Store in ImprovementPlan (transactional)
 *
 * Guarantees:
 * - All DB writes in prisma.$transaction
 * - Returns a valid Roadmap even if user has no data (default plan)
 * - Never throws to caller — returns safe fallback on error
 * - No LLM calls
 *
 * @param userId - The user to generate a roadmap for
 * @returns The generated Roadmap
 */
export async function generateAndStoreRoadmap(userId: string): Promise<Roadmap> {
    try {
        const roadmap = await prisma.$transaction(async (tx) => {
            // 1. Fetch weak skills
            const weakSkillRecords = await tx.weakSkillMemory.findMany({
                where: { userId },
                orderBy: { weaknessCount: 'desc' },
                take: WEAK_SKILLS_LIMIT,
                select: { skillName: true },
            });
            const weakSkills = weakSkillRecords.map((r) => r.skillName);

            // 2. Fetch latest session for difficulty context
            const latestSession = await tx.interviewSession.findFirst({
                where: { userId },
                orderBy: { startedAt: 'desc' },
                select: {
                    id: true,
                    difficulty: true,
                },
            });

            // 3. Fetch ScoreBreakdown for the latest session
            let technicalAverage = 0;
            let communicationAverage = 0;
            let logicAverage = 0;

            if (latestSession) {
                const breakdown = await tx.scoreBreakdown.findUnique({
                    where: { sessionId: latestSession.id },
                    select: {
                        technicalAverage: true,
                        communicationAverage: true,
                        logicAverage: true,
                    },
                });

                if (breakdown) {
                    technicalAverage = breakdown.technicalAverage;
                    communicationAverage = breakdown.communicationAverage;
                    logicAverage = breakdown.logicAverage;
                }
            }

            // 4. Determine difficulty
            const difficulty: DifficultyLevel = latestSession && VALID_DIFFICULTIES.has(latestSession.difficulty)
                ? (latestSession.difficulty as DifficultyLevel)
                : 'easy';

            // 5. Generate roadmap (pure logic)
            const generatedRoadmap = generateRoadmap({
                weakSkills,
                technicalAverage,
                communicationAverage,
                logicAverage,
                difficulty,
            });

            // 6. Store as ImprovementPlan
            await tx.improvementPlan.create({
                data: {
                    userId,
                    planJSON: JSON.stringify(generatedRoadmap),
                    generatedAt: new Date(),
                },
            });

            return generatedRoadmap;
        });

        return roadmap;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[RoadmapEngine] generateAndStoreRoadmap failed:', message);

        // Return a minimal default roadmap as fallback
        return generateRoadmap({
            weakSkills: [],
            technicalAverage: 50,
            communicationAverage: 50,
            logicAverage: 50,
            difficulty: 'easy',
        });
    }
}

/**
 * Fetches the most recently generated roadmap for a user.
 * Returns null if no roadmap exists.
 *
 * @param userId - The user whose roadmap to fetch
 * @returns The parsed Roadmap or null
 */
export async function getLatestRoadmap(userId: string): Promise<Roadmap | null> {
    try {
        const plan = await prisma.improvementPlan.findFirst({
            where: { userId },
            orderBy: { generatedAt: 'desc' },
            select: { planJSON: true },
        });

        if (!plan) return null;

        return JSON.parse(plan.planJSON) as Roadmap;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[RoadmapEngine] getLatestRoadmap failed:', message);
        return null;
    }
}
