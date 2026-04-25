// POST /api/sessions/[id]/complete — Mark session complete and compute ScoreBreakdown
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: sessionId } = await params;

        if (sessionId.startsWith('guest-') || sessionId.startsWith('fallback-')) {
            return NextResponse.json({ success: true, skipped: true });
        }

        const session = await prisma.interviewSession.findUnique({
            where: { id: sessionId },
            include: { responses: true },
        });

        if (!session) {
            return NextResponse.json({ success: true, skipped: true });
        }

        const responses = session.responses;
        const count = responses.length || 1;

        // Compute averages
        const avg = (field: keyof typeof responses[0]) =>
            responses.reduce((sum, r) => sum + (r[field] as number), 0) / count;

        const technicalAverage = avg('technicalScore');
        const communicationAverage = avg('communicationScore');
        const confidenceAverage = avg('confidenceScore');
        const logicAverage = avg('logicScore');
        const depthAverage = avg('depthScore');
        const overallScore = (technicalAverage + communicationAverage + confidenceAverage + logicAverage + depthAverage) / 5;

        // Upsert ScoreBreakdown
        await prisma.scoreBreakdown.upsert({
            where: { sessionId },
            create: {
                sessionId,
                overallScore,
                technicalAverage,
                communicationAverage,
                confidenceAverage,
                logicAverage,
                depthAverage,
            },
            update: {
                overallScore,
                technicalAverage,
                communicationAverage,
                confidenceAverage,
                logicAverage,
                depthAverage,
            },
        });

        // Update session with completedAt and averageScore
        await prisma.interviewSession.update({
            where: { id: sessionId },
            data: {
                completedAt: new Date(),
                averageScore: overallScore,
            },
        });

        return NextResponse.json({ success: true, overallScore });
    } catch (error) {
        console.error('Session complete error:', error);
        return NextResponse.json({ success: true, skipped: true });
    }
}
