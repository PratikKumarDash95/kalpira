// GET /api/interviews/[id] - Get single interview
// Protected: Requires authenticated session

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getRequestContext } from '@/lib/researcherContext';
import { StoredInterview, InterviewMessage, SynthesisResult } from '@/types';

// Helper to Map InterviewSession to StoredInterview
// (This should ideally be shared code, but inlining for route handler simplicity)
function mapSessionToStoredInterview(session: any): StoredInterview {
  // Reconstruct transcript
  const transcript: InterviewMessage[] = [];
  session.questions?.forEach((q: any) => {
    // AI Question
    transcript.push({
      id: `q-${q.id}`,
      role: 'ai',
      content: q.text,
      timestamp: new Date(q.createdAt).getTime()
    });

    // User Response
    if (q.responses && q.responses.length > 0) {
      const r = q.responses[0];
      transcript.push({
        id: `r-${r.id}`,
        role: 'user',
        content: r.answerText,
        timestamp: new Date(r.createdAt).getTime()
      });
    }
  });

  // Construct synthesis/score summary
  let synthesis: SynthesisResult | null = null;
  if (session.scoreBreakdown) {
    synthesis = {
      statedPreferences: [],
      revealedPreferences: [],
      themes: [],
      contradictions: [],
      keyInsights: [`Overall Score: ${session.scoreBreakdown.overallScore.toFixed(1)}/100`],
      bottomLine: `Completed with score: ${session.scoreBreakdown.overallScore.toFixed(1)}`
    };
  }

  // Parse behavior data if stored as JSON string (not common in SQL schema but possible fallback)
  // For SQL schema, we might not have 'behaviorData' column populated directly.
  // Using default fallback.
  const behaviorData = {
    timePerTopic: {},
    messagesPerTopic: {},
    topicsExplored: [],
    contradictions: []
  };

  return {
    id: session.id,
    studyId: session.studyId || 'practice',
    studyName: session.study?.configJSON ? JSON.parse(session.study.configJSON).name : (session.role || 'Practice Interview'),
    transcript,
    participantProfile: {} as any, // Placeholder for strict type
    synthesis,
    behaviorData,
    status: session.status as 'in_progress' | 'completed',
    createdAt: new Date(session.startedAt).getTime(),
    completedAt: session.completedAt ? new Date(session.completedAt).getTime() : Date.now(),
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { authorized, context, error } = await getRequestContext();
    if (!authorized || !context) {
      return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: 'Missing interview ID' },
        { status: 400 }
      );
    }

    // Fetch from InterviewSession (SQL)
    const session = await prisma.interviewSession.findUnique({
      where: { id },
      include: {
        questions: {
          orderBy: { createdAt: 'asc' },
          include: { responses: true }
        },
        scoreBreakdown: true,
        study: true,
      }
    });

    if (!session) {
      return NextResponse.json(
        { error: 'Interview not found' },
        { status: 404 }
      );
    }

    const interview = mapSessionToStoredInterview(session);

    return NextResponse.json({ interview });
  } catch (error) {
    console.error('Get interview API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch interview' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { authorized, context, error } = await getRequestContext();
    if (!authorized || !context) {
      return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: 'Missing interview ID' },
        { status: 400 }
      );
    }

    // Delete from InterviewSession (SQL)
    // Using deleteMany for safety against non-existent ID throwing error in some Prisma versions/configs?
    // findUnique -> delete is standard.
    // If not found, delete throws "Record to delete does not exist."

    try {
      await prisma.interviewSession.delete({
        where: { id }
      });
    } catch (e: any) {
      if (e.code === 'P2025') {
        return NextResponse.json(
          { error: 'Interview not found' },
          { status: 404 }
        );
      }
      throw e;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete interview API error:', error);
    return NextResponse.json(
      { error: 'Failed to delete interview' },
      { status: 500 }
    );
  }
}
