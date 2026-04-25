// Test Script: Validates the full Prisma schema and relational integrity
// Run with: npx tsx scripts/test-db.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['warn', 'error'] });

async function main() {
    console.log('🔧 Starting database integration test...\n');

    // 1. Create a User
    const user = await prisma.user.create({
        data: {
            email: 'test@example.com',
            name: 'Test Researcher',
            onboardingComplete: true,
        },
    });
    console.log('✅ User created:', user.id);

    // 2. Create Resume for the user
    const resume = await prisma.resume.create({
        data: {
            userId: user.id,
            fileName: 'test-resume.pdf',
            rawText: 'Experienced software engineer with 5 years in Node.js...',
            parsedSkills: JSON.stringify(['Node.js', 'TypeScript', 'React', 'PostgreSQL']),
        },
    });
    console.log('✅ Resume created:', resume.id);

    // 3. Create Skills
    const skill1 = await prisma.skill.create({
        data: { name: 'TypeScript', category: 'Programming Languages' },
    });
    const skill2 = await prisma.skill.create({
        data: { name: 'System Design', category: 'Architecture' },
    });
    console.log('✅ Skills created:', skill1.name, ',', skill2.name);

    // 4. Create UserSkills
    const userSkill1 = await prisma.userSkill.create({
        data: {
            userId: user.id,
            skillId: skill1.id,
            proficiencyScore: 7.5,
            weaknessCount: 1,
        },
    });
    const userSkill2 = await prisma.userSkill.create({
        data: {
            userId: user.id,
            skillId: skill2.id,
            proficiencyScore: 4.2,
            weaknessCount: 3,
        },
    });
    console.log('✅ UserSkills linked:', userSkill1.id, ',', userSkill2.id);

    // 5. Create InterviewSession
    const session = await prisma.interviewSession.create({
        data: {
            userId: user.id,
            role: 'Senior Backend Engineer',
            difficulty: 'medium',
            mode: 'mock',
            averageScore: 0,
        },
    });
    console.log('✅ InterviewSession created:', session.id);

    // 6. Create Questions
    const question1 = await prisma.question.create({
        data: {
            sessionId: session.id,
            text: 'Explain the differences between SQL and NoSQL databases.',
            difficulty: 'medium',
            category: 'technical',
        },
    });
    const question2 = await prisma.question.create({
        data: {
            sessionId: session.id,
            text: 'Design a URL shortener service.',
            difficulty: 'hard',
            category: 'system-design',
        },
    });
    console.log('✅ Questions created:', question1.id, ',', question2.id);

    // 7. Create Responses
    const response1 = await prisma.response.create({
        data: {
            sessionId: session.id,
            questionId: question1.id,
            answerText: 'SQL databases are relational and use structured query language...',
            technicalScore: 8.0,
            communicationScore: 7.5,
            confidenceScore: 8.5,
            logicScore: 7.0,
            depthScore: 6.5,
            feedback: 'Good explanation of core differences.',
            idealAnswer: 'A comprehensive answer would also include CAP theorem...',
            improvementTip: 'Add more examples of real-world use cases for each type.',
        },
    });
    const response2 = await prisma.response.create({
        data: {
            sessionId: session.id,
            questionId: question2.id,
            answerText: 'I would use a hash function to generate short codes...',
            technicalScore: 6.0,
            communicationScore: 7.0,
            confidenceScore: 5.5,
            logicScore: 7.5,
            depthScore: 5.0,
            feedback: 'Needs more depth on scalability considerations.',
            idealAnswer: 'Should discuss load balancing, caching, and database sharding...',
            improvementTip: 'Practice discussing trade-offs in system design.',
        },
    });
    console.log('✅ Responses created:', response1.id, ',', response2.id);

    // 8. Create ScoreBreakdown
    const scoreBreakdown = await prisma.scoreBreakdown.create({
        data: {
            sessionId: session.id,
            overallScore: 6.95,
            technicalAverage: 7.0,
            communicationAverage: 7.25,
            confidenceAverage: 7.0,
            logicAverage: 7.25,
            depthAverage: 5.75,
        },
    });
    console.log('✅ ScoreBreakdown created:', scoreBreakdown.id);

    // 9. Create WeakSkillMemory
    const weakSkill = await prisma.weakSkillMemory.create({
        data: {
            userId: user.id,
            skillName: 'System Design',
            weaknessCount: 3,
        },
    });
    console.log('✅ WeakSkillMemory created:', weakSkill.id);

    // 10. Create ImprovementPlan
    const plan = await prisma.improvementPlan.create({
        data: {
            userId: user.id,
            planJSON: JSON.stringify({
                focus: ['System Design', 'Depth of Answers'],
                weeklyGoals: [
                    'Practice 2 system design problems',
                    'Study distributed systems fundamentals',
                ],
                estimatedTimeWeeks: 4,
            }),
        },
    });
    console.log('✅ ImprovementPlan created:', plan.id);

    // 11. Create Badge
    const badge = await prisma.badge.create({
        data: {
            userId: user.id,
            badgeName: 'First Interview Complete',
        },
    });
    console.log('✅ Badge created:', badge.id);

    // 12. Create ReadinessIndex
    const readiness = await prisma.readinessIndex.create({
        data: {
            userId: user.id,
            readinessScore: 6.95,
        },
    });
    console.log('✅ ReadinessIndex created:', readiness.id);

    // 13. Create Study (domain migration test)
    const study = await prisma.study.create({
        data: {
            userId: user.id,
            configJSON: JSON.stringify({
                id: 'test-study-1',
                name: 'Test Study',
                description: 'A test study',
                researchQuestion: 'What is the meaning of test?',
                coreQuestions: ['Question 1'],
                topicAreas: ['Testing'],
                profileSchema: [],
                aiBehavior: 'standard',
                consentText: 'I agree',
                createdAt: Date.now(),
            }),
            interviewCount: 0,
            isLocked: false,
        },
    });
    console.log('✅ Study created:', study.id);

    // 14. Create StoredInterview (domain migration test)
    const storedInterview = await prisma.storedInterview.create({
        data: {
            studyId: study.id,
            userId: user.id,
            studyName: 'Test Study',
            transcriptJSON: JSON.stringify([
                { id: '1', role: 'ai', content: 'Hello, tell me about yourself.', timestamp: Date.now() },
                { id: '2', role: 'user', content: 'I am a software engineer.', timestamp: Date.now() },
            ]),
            participantProfileJSON: JSON.stringify({
                id: 'p1',
                fields: [],
                rawContext: 'Software engineer',
                timestamp: Date.now(),
            }),
            status: 'completed',
        },
    });
    console.log('✅ StoredInterview created:', storedInterview.id);

    // ============================================
    // Verify relations with eager loading
    // ============================================
    console.log('\n📊 Verifying relations...\n');

    const fullUser = await prisma.user.findUnique({
        where: { id: user.id },
        include: {
            resume: true,
            userSkills: { include: { skill: true } },
            interviewSessions: {
                include: {
                    questions: true,
                    responses: true,
                    scoreBreakdown: true,
                },
            },
            readinessIndex: true,
            badges: true,
            improvementPlans: true,
            weakSkillMemories: true,
            studies: true,
            storedInterviews: true,
        },
    });

    if (!fullUser) {
        throw new Error('User not found after creation');
    }

    console.log('User:', fullUser.name);
    console.log('Resume:', fullUser.resume?.fileName);
    console.log('Skills:', fullUser.userSkills.map(us => `${us.skill.name} (${us.proficiencyScore})`).join(', '));
    console.log('Sessions:', fullUser.interviewSessions.length);
    console.log('Questions:', fullUser.interviewSessions[0]?.questions.length);
    console.log('Responses:', fullUser.interviewSessions[0]?.responses.length);
    console.log('Score:', fullUser.interviewSessions[0]?.scoreBreakdown?.overallScore);
    console.log('Readiness:', fullUser.readinessIndex?.readinessScore);
    console.log('Badges:', fullUser.badges.map(b => b.badgeName).join(', '));
    console.log('Plans:', fullUser.improvementPlans.length);
    console.log('Weak Skills:', fullUser.weakSkillMemories.map(w => w.skillName).join(', '));
    console.log('Studies:', fullUser.studies.length);
    console.log('StoredInterviews:', fullUser.storedInterviews.length);

    // ============================================
    // Cleanup
    // ============================================
    console.log('\n🧹 Cleaning up test data...');
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.skill.deleteMany({ where: { id: { in: [skill1.id, skill2.id] } } });
    console.log('✅ Cleanup complete.');

    console.log('\n✅✅✅ ALL TESTS PASSED ✅✅✅');
}

main()
    .catch((e) => {
        console.error('❌ Test failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
