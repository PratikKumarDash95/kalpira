// GET /api/interviews - List all interviews (fetched from Supabase SQL)
// Protected: Requires authenticated session

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { getRequestContext } from '@/lib/researcherContext';
import { getAuthUser } from '@/lib/accessControl';
import { StoredInterview, InterviewMessage, SynthesisResult } from '@/types';

const MAX_INTERVIEW_DURATION_MS = 60 * 60 * 1000;

async function autoCompleteExpiredSessions(where: any) {
  const now = Date.now();
  const sessions = await supabaseDb.interviewSession.findMany({
    where: {
      ...where,
      completedAt: null,
    },
    select: {
      id: true,
      startedAt: true,
      averageScore: true,
      mode: true,
    },
  });

  await Promise.all(
    sessions
      .filter((session: any) => {
        if (session.mode === 'terminated') return false;
        const startedAt = new Date(session.startedAt).getTime();
        return Number.isFinite(startedAt) && now - startedAt >= MAX_INTERVIEW_DURATION_MS;
      })
      .map((session: any) => {
        const startedAt = new Date(session.startedAt).getTime();
        return supabaseDb.interviewSession.update({
          where: { id: session.id },
          data: {
            completedAt: new Date(startedAt + MAX_INTERVIEW_DURATION_MS),
            averageScore: session.averageScore || 0,
          },
        });
      })
  );
}

export async function GET(request: Request) {
  try {
    const { authorized, context, researcherId, error } = await getRequestContext();
    const authUser = await getAuthUser();

    // Strict Auth Check - Must be authenticated
    if (!authorized || !context) {
      return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 });
    }

    if (authUser?.role === 'admin') {
      return NextResponse.json({ error: 'Admins cannot access private interview reports' }, { status: 403 });
    }

    // Check for studyId filter
    const { searchParams } = new URL(request.url);
    const studyId = searchParams.get('studyId');
    const summaryOnly = searchParams.get('summary') === '1';
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 50), 1), 100);
    const offset = Math.max(Number(searchParams.get('offset') || 0), 0);

    // Build strict query based on role
    const where: any = {};

    if (studyId) {
      where.studyId = studyId;
    }

    const ownerId = researcherId || context.userId;
    if (ownerId) {
      // The Supabase shim cannot evaluate nested relation filters before includes load.
      // Resolve owned study IDs first, then constrain sessions by studyId.
      const ownedStudies = await supabaseDb.study.findMany({
        where: { userId: ownerId },
        select: { id: true },
      });

      const ownedStudyIds = ownedStudies.map((study: { id: string }) => study.id);

      if (ownedStudyIds.length === 0) {
        return NextResponse.json({ interviews: [] });
      }

      where.studyId = studyId ? studyId : { in: ownedStudyIds };
    }

    await autoCompleteExpiredSessions(where);

    const sessions = await supabaseDb.interviewSession.findMany({
      where,
      include: {
        questions: summaryOnly
          ? {
            select: { id: true },
          }
          : {
            orderBy: { createdAt: 'asc' },
            include: { responses: true }
          },
        scoreBreakdown: true,
        study: true,
      },
      orderBy: { startedAt: 'desc' },
      skip: offset,
      take: limit + 1,
    });

    const hasMore = sessions.length > limit;
    const visibleSessions = hasMore ? sessions.slice(0, limit) : sessions;

    // Map Supabase sessions to StoredInterview format
    const interviews: StoredInterview[] = visibleSessions.map(session => {
      // Reconstruct transcript
      const transcript: InterviewMessage[] = [];
      if (!summaryOnly) session.questions.forEach((q: any) => {
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
        messageCount: summaryOnly
          ? session.questions.length * 2
          : transcript.length,
        synthesis,
        behaviorData: {
          timePerTopic: {},
          messagesPerTopic: {},
          topicsExplored: [],
          contradictions: []
        },
        createdAt: session.startedAt.getTime(),
        completedAt: session.completedAt
          ? session.completedAt.getTime()
          : Math.min(Date.now(), session.startedAt.getTime() + MAX_INTERVIEW_DURATION_MS),
        status: session.completedAt ? 'completed' : 'in_progress'
      };
    });

    return NextResponse.json({
      interviews,
      pagination: {
        limit,
        offset,
        count: interviews.length,
        hasMore,
        nextOffset: offset + interviews.length,
      },
    });
  } catch (error) {
    console.error('Interviews API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch interviews' },
      { status: 500 }
    );
  }
}
