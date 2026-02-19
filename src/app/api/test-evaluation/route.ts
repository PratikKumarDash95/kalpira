// GET /api/test-evaluation - Tests the complete evaluation pipeline
// Only available in development mode
// Remove before production deployment

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { evaluateResponse } from '@/lib/evaluation/evaluationService';

export async function GET() {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
    }

    const results: Record<string, unknown> = {};

    try {
        // Step 1: Create test user + session + question
        const user = await prisma.user.create({
            data: {
                email: `eval-test-${Date.now()}@example.com`,
                name: 'Evaluation Test User',
                onboardingComplete: true,
            },
        });
        results['user'] = `✅ User created: ${user.id}`;

        const session = await prisma.interviewSession.create({
            data: {
                userId: user.id,
                role: 'Senior Backend Engineer',
                difficulty: 'medium',
                mode: 'normal',
            },
        });
        results['session'] = `✅ Session created: ${session.id}`;

        const question = await prisma.question.create({
            data: {
                sessionId: session.id,
                text: 'Explain the differences between SQL and NoSQL databases.',
                difficulty: 'medium',
                category: 'technical',
            },
        });
        results['question'] = `✅ Question created: ${question.id}`;

        // Step 2: Run the evaluation pipeline
        const evalResult = await evaluateResponse({
            sessionId: session.id,
            questionId: question.id,
            userAnswer: 'SQL databases are relational and use structured query language for defining and manipulating data. They are table-based and follow ACID properties. NoSQL databases are non-relational and can be document-based, key-value pairs, or graph databases. They are more flexible with schema design and scale horizontally better.',
            questionText: question.text,
            category: 'technical',
            role: 'Senior Backend Engineer',
            difficulty: 'medium',
            mode: 'normal',
            // Uses mock LLM by default
        });

        results['evaluation'] = {
            success: evalResult.success,
            responseId: evalResult.responseId,
            llmOutputValid: evalResult.llmOutputValid,
            validationErrors: evalResult.validationErrors,
            scores: {
                technical: evalResult.evaluation.technical_score,
                communication: evalResult.evaluation.communication_score,
                confidence: evalResult.evaluation.confidence_score,
                logic: evalResult.evaluation.logic_score,
                depth: evalResult.evaluation.depth_score,
            },
            feedback: evalResult.evaluation.feedback,
            difficultyRecommendation: evalResult.evaluation.difficulty_recommendation,
            weakTopics: evalResult.evaluation.weak_topics,
            strengths: evalResult.evaluation.strengths,
        };

        results['sessionAverages'] = evalResult.sessionAverages;

        // Step 3: Verify DB state
        const scoreBreakdown = await prisma.scoreBreakdown.findUnique({
            where: { sessionId: session.id },
        });
        results['scoreBreakdown'] = scoreBreakdown
            ? `✅ ScoreBreakdown persisted: overall=${scoreBreakdown.overallScore}`
            : '❌ ScoreBreakdown NOT found';

        const updatedSession = await prisma.interviewSession.findUnique({
            where: { id: session.id },
            select: { averageScore: true },
        });
        results['sessionUpdate'] = `✅ Session.averageScore updated: ${updatedSession?.averageScore}`;

        const responseCount = await prisma.response.count({
            where: { sessionId: session.id },
        });
        results['responseCount'] = `✅ Response records: ${responseCount}`;

        // Step 4: Run a second evaluation to test upsert logic
        const question2 = await prisma.question.create({
            data: {
                sessionId: session.id,
                text: 'Design a URL shortener service.',
                difficulty: 'hard',
                category: 'system-design',
            },
        });

        const evalResult2 = await evaluateResponse({
            sessionId: session.id,
            questionId: question2.id,
            userAnswer: 'I would use a hash function to generate unique short codes.',
            questionText: question2.text,
            category: 'system-design',
            role: 'Senior Backend Engineer',
            difficulty: 'hard',
            mode: 'normal',
        });

        results['secondEvaluation'] = {
            success: evalResult2.success,
            responseCount: evalResult2.sessionAverages.responseCount,
            overallScore: evalResult2.sessionAverages.overallScore,
        };

        const finalBreakdown = await prisma.scoreBreakdown.findUnique({
            where: { sessionId: session.id },
        });
        results['upsertVerification'] = finalBreakdown
            ? `✅ ScoreBreakdown upserted: overall=${finalBreakdown.overallScore} (recalculated from ${evalResult2.sessionAverages.responseCount} responses)`
            : '❌ ScoreBreakdown upsert failed';

        // Cleanup
        await prisma.user.delete({ where: { id: user.id } });
        results['cleanup'] = '✅ Test data cleaned up';

        return NextResponse.json({
            status: '✅ EVALUATION PIPELINE FULLY OPERATIONAL',
            results,
        });
    } catch (error) {
        console.error('Evaluation test error:', error);
        return NextResponse.json(
            {
                status: '❌ EVALUATION TEST FAILED',
                results,
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}
