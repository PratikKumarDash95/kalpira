// POST /api/sessions/[id]/save-response — Save a Q&A pair with scores to DB
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: sessionId } = await params;

        // Skip DB save for guest/fallback sessions
        if (sessionId.startsWith('guest-') || sessionId.startsWith('fallback-')) {
            return NextResponse.json({ success: true, skipped: true });
        }

        const body = await request.json();
        const {
            questionText,
            category = 'general',
            difficulty = 'medium',
            answerText,
            technicalScore = 0,
            communicationScore = 0,
            confidenceScore = 0,
            logicScore = 0,
            depthScore = 0,
            feedback = '',
            idealAnswer = '',
            improvementTip = '',
        } = body as {
            questionText: string;
            category?: string;
            difficulty?: string;
            answerText: string;
            technicalScore?: number;
            communicationScore?: number;
            confidenceScore?: number;
            logicScore?: number;
            depthScore?: number;
            feedback?: string;
            idealAnswer?: string;
            improvementTip?: string;
        };

        if (!questionText || !answerText) {
            return NextResponse.json({ error: 'questionText and answerText required' }, { status: 400 });
        }

        // Verify session exists
        const session = await prisma.interviewSession.findUnique({ where: { id: sessionId } });
        if (!session) {
            return NextResponse.json({ success: true, skipped: true }); // Graceful skip
        }

        // Create question record
        const question = await prisma.question.create({
            data: {
                sessionId,
                text: questionText,
                difficulty,
                category,
            },
        });

        // Create response record with scores
        const response = await prisma.response.create({
            data: {
                sessionId,
                questionId: question.id,
                answerText,
                technicalScore,
                communicationScore,
                confidenceScore,
                logicScore,
                depthScore,
                feedback,
                idealAnswer,
                improvementTip,
            },
        });

        return NextResponse.json({ success: true, questionId: question.id, responseId: response.id });
    } catch (error) {
        console.error('Save response error:', error);
        return NextResponse.json({ success: true, skipped: true }); // Never break the interview
    }
}
