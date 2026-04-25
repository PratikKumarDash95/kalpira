// ============================================
// /api/coach/dashboard — Coach Dashboard Data Endpoint
// Aggregates readiness, weak skills, roadmap, badges, progress
// Read-only endpoint — no mutations
// ============================================

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// In production, you'd extract userId from the auth session.
// For now, we attempt to get the first user or return demo data.

export async function GET() {
    try {
        // Attempt to get the first user (standalone mode)
        const user = await prisma.user.findFirst({
            select: { id: true },
        });

        if (!user) {
            return NextResponse.json(getDemoData());
        }

        const userId = user.id;

        // Parallel fetch all dashboard data
        const [
            readiness,
            weakSkills,
            latestPlan,
            badges,
            sessions,
        ] = await Promise.all([
            prisma.readinessIndex.findUnique({
                where: { userId },
                select: { readinessScore: true },
            }),
            prisma.weakSkillMemory.findMany({
                where: { userId },
                orderBy: { weaknessCount: 'desc' },
                take: 10,
                select: { skillName: true },
            }),
            prisma.improvementPlan.findFirst({
                where: { userId },
                orderBy: { generatedAt: 'desc' },
                select: { planJSON: true },
            }),
            prisma.badge.findMany({
                where: { userId },
                orderBy: { awardedAt: 'desc' },
                select: { badgeName: true, awardedAt: true },
            }),
            prisma.interviewSession.findMany({
                where: { userId },
                orderBy: { startedAt: 'asc' },
                select: {
                    averageScore: true,
                    difficulty: true,
                },
            }),
        ]);

        // Build progress data from session history
        const progressData = sessions.map((s, index) => ({
            session: index + 1,
            score: Math.round(s.averageScore * 100) / 100,
        }));

        // Parse roadmap JSON
        let roadmap = null;
        if (latestPlan?.planJSON) {
            try {
                roadmap = JSON.parse(latestPlan.planJSON);
            } catch {
                roadmap = null;
            }
        }

        // Current difficulty from latest session
        const currentDifficulty = sessions.length > 0
            ? sessions[sessions.length - 1].difficulty
            : 'easy';

        return NextResponse.json({
            readinessScore: readiness?.readinessScore ?? 0,
            weakSkills: weakSkills.map((w) => w.skillName),
            roadmap,
            badges: badges.map((b) => ({
                badgeName: b.badgeName,
                description: getDefaultBadgeDescription(b.badgeName),
                awardedAt: b.awardedAt,
                isNew: false,
            })),
            progressData,
            difficulty: currentDifficulty,
            totalSessions: sessions.length,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[CoachDashboardAPI] Failed:', message);

        // Return demo data as graceful fallback
        return NextResponse.json(getDemoData());
    }
}

function getDefaultBadgeDescription(name: string): string {
    switch (name) {
        case 'DSA Master': return 'Achieved a technical average of 85 or above';
        case 'Communication Pro': return 'Achieved a communication average of 80 or above';
        case 'Interview Ready': return 'Achieved a readiness score of 85 or above';
        case 'Consistent Performer': return 'Completed 10 or more interview sessions';
        default: return 'Achievement unlocked';
    }
}

function getDemoData() {
    return {
        readinessScore: 0,
        weakSkills: [],
        roadmap: null,
        badges: [],
        progressData: [],
        difficulty: 'easy',
        totalSessions: 0,
    };
}
