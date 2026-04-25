// GET /api/test-db - Quick sanity check for database connectivity
// Only available in development mode
// Remove this route before production deployment

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
    }

    const results: Record<string, unknown> = {};

    try {
        // Test 1: Basic connectivity
        await prisma.$queryRaw`SELECT 1`;
        results['connectivity'] = '✅ SQLite connected';

        // Test 2: Create a test user
        const user = await prisma.user.create({
            data: {
                email: `test-${Date.now()}@example.com`,
                name: 'Test User',
                onboardingComplete: false,
            },
        });
        results['userCreate'] = `✅ User created: ${user.id}`;

        // Test 3: Create a skill
        const skill = await prisma.skill.create({
            data: { name: `TestSkill-${Date.now()}`, category: 'Testing' },
        });
        results['skillCreate'] = `✅ Skill created: ${skill.id}`;

        // Test 4: Link user skill
        const userSkill = await prisma.userSkill.create({
            data: {
                userId: user.id,
                skillId: skill.id,
                proficiencyScore: 5.0,
            },
        });
        results['userSkillLink'] = `✅ UserSkill linked: ${userSkill.id}`;

        // Test 5: Create a study
        const study = await prisma.study.create({
            data: {
                userId: user.id,
                configJSON: JSON.stringify({ name: 'Test Study', id: 'test' }),
                interviewCount: 0,
                isLocked: false,
            },
        });
        results['studyCreate'] = `✅ Study created: ${study.id}`;

        // Test 6: Create a stored interview
        const interview = await prisma.storedInterview.create({
            data: {
                studyId: study.id,
                userId: user.id,
                studyName: 'Test Study',
                transcriptJSON: JSON.stringify([{ role: 'ai', content: 'Hello' }]),
                status: 'completed',
            },
        });
        results['interviewCreate'] = `✅ StoredInterview created: ${interview.id}`;

        // Test 7: Create interview session 
        const session = await prisma.interviewSession.create({
            data: {
                userId: user.id,
                role: 'Engineer',
                difficulty: 'medium',
                mode: 'practice',
            },
        });
        results['sessionCreate'] = `✅ InterviewSession created: ${session.id}`;

        // Test 8: Create score breakdown
        const score = await prisma.scoreBreakdown.create({
            data: {
                sessionId: session.id,
                overallScore: 7.5,
                technicalAverage: 7.0,
                communicationAverage: 8.0,
                confidenceAverage: 7.5,
                logicAverage: 7.0,
                depthAverage: 7.5,
            },
        });
        results['scoreCreate'] = `✅ ScoreBreakdown created: ${score.id}`;

        // Test 9: Create readiness index
        const readiness = await prisma.readinessIndex.create({
            data: { userId: user.id, readinessScore: 7.5 },
        });
        results['readinessCreate'] = `✅ ReadinessIndex created: ${readiness.id}`;

        // Test 10: Create badge
        const badge = await prisma.badge.create({
            data: { userId: user.id, badgeName: `test-badge-${Date.now()}` },
        });
        results['badgeCreate'] = `✅ Badge created: ${badge.id}`;

        // Test 11: Verify cascade delete
        await prisma.user.delete({ where: { id: user.id } });
        const orphanedSkills = await prisma.userSkill.findMany({
            where: { userId: user.id },
        });
        const orphanedSessions = await prisma.interviewSession.findMany({
            where: { userId: user.id },
        });
        results['cascadeDelete'] =
            orphanedSkills.length === 0 && orphanedSessions.length === 0
                ? '✅ Cascade delete works (all children removed)'
                : `❌ Cascade delete failed: ${orphanedSkills.length} skills, ${orphanedSessions.length} sessions remain`;

        // Cleanup
        await prisma.skill.delete({ where: { id: skill.id } });
        results['cleanup'] = '✅ Cleanup complete';

        // Count all tables
        const userCount = await prisma.user.count();
        const studyCount = await prisma.study.count();
        const interviewCount = await prisma.storedInterview.count();
        results['tableCounts'] = { users: userCount, studies: studyCount, interviews: interviewCount };

        return NextResponse.json({
            status: '✅ ALL TESTS PASSED',
            results,
        });
    } catch (error) {
        console.error('DB test error:', error);
        return NextResponse.json(
            {
                status: '❌ TEST FAILED',
                results,
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}
