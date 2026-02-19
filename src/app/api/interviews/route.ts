// GET /api/interviews - List all interviews (fetched from Prisma SQL)
// Protected: Requires authenticated session

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getRequestContext } from '@/lib/researcherContext';
import { StoredInterview, InterviewMessage, SynthesisResult } from '@/types';

export async function GET(request: Request) {
  try {
    const { authorized, context, error } = await getRequestContext();

    // Strict Auth Check - Must be authenticated
    if (!authorized || !context) {
      return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 });
    }

    // Check for studyId filter
    const { searchParams } = new URL(request.url);
    const studyId = searchParams.get('studyId');

    // Build strict query based on role
    const where: any = {};

    if (studyId) {
      where.studyId = studyId;
    }

    if (context.researcherId) {
      // 1. INTERVIEWER VIEW: Only show sessions from studies OWNED by this researcher
      // This strictly hides "practice" sessions or other users' private data
      where.study = {
        userId: context.researcherId
      };
    } else if (context.userId) {
      // 2. CANDIDATE VIEW: Only show sessions belonging to this user
      where.userId = context.userId;
    } else {
      // Should not happen if authorized is true, but safe fallback
      return NextResponse.json({ interviews: [] });
    }

    const sessions = await prisma.interviewSession.findMany({
      where,
      include: {
        questions: {
          orderBy: { createdAt: 'asc' },
          include: { responses: true }
        },
        scoreBreakdown: true,
        study: true,
      },
      orderBy: { startedAt: 'desc' }
    });

    // Map Prisma sessions to StoredInterview format
    const interviews: StoredInterview[] = sessions.map(session => {
      // Reconstruct transcript
      const transcript: InterviewMessage[] = [];
      session.questions.forEach((q, idx) => {
        // AI Question
        transcript.push({
          id: `q-${q.id}`,
          role: 'ai',
          content: q.text,
          timestamp: q.createdAt.getTime()
        });

        // User Response
        if (q.responses && q.responses.length > 0) {
          const r = q.responses[0];
          transcript.push({
            id: `r-${r.id}`,
            role: 'user',
            content: r.answerText,
            timestamp: r.createdAt.getTime()
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

      return {
        id: session.id,
        studyId: session.studyId || 'practice',
        studyName: session.study?.configJSON ? JSON.parse(session.study.configJSON).name : (session.role || 'Practice Interview'),
        userId: session.userId,
        participantProfile: {
          id: 'p-1',
          timestamp: Date.now(),
          rawContext: '',
          fields: [
            { fieldId: 'name', value: session.candidateName || 'Candidate', status: 'extracted' },
            { fieldId: 'email', value: session.candidateEmail || 'N/A', status: 'extracted' }
          ]
        },
        transcript,
        synthesis,
        behaviorData: {
          timePerTopic: {},
          messagesPerTopic: {},
          topicsExplored: [],
          contradictions: []
        },
        createdAt: session.startedAt.getTime(),
        completedAt: session.completedAt ? session.completedAt.getTime() : Date.now(),
        status: session.completedAt ? 'completed' : 'in_progress'
      };
    });

    return NextResponse.json({ interviews });
  } catch (error) {
    console.error('Interviews API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch interviews' },
      { status: 500 }
    );
  }
}
