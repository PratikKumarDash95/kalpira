// GET /api/interviews/export - Export all interviews as CSV
// Protected: Requires authenticated session

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getRequestContext } from '@/lib/researcherContext';
import { StoredInterview, InterviewMessage, SynthesisResult } from '@/types';

// Helper to sanitize text for CSV
const escapeCsv = (text: any) => {
  if (text === null || text === undefined) return '';
  const stringValue = String(text);
  // Replace quotes with double quotes and wrap in quotes if necessary
  const result = stringValue.replace(/"/g, '""');
  if (result.includes(',') || result.includes('\n') || result.includes('"')) {
    return `"${result}"`;
  }
  return result;
};

// Simplified domain conversion for export
function mapSessionToExportData(session: any): StoredInterview {
  const transcript: InterviewMessage[] = [];
  session.questions?.forEach((q: any) => {
    transcript.push({
      id: `q-${q.id}`,
      role: 'ai',
      content: q.text,
      timestamp: new Date(q.createdAt).getTime()
    });
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

  let synthesis: SynthesisResult | null = null;
  if (session.scoreBreakdown) {
    synthesis = {
      statedPreferences: [],
      revealedPreferences: [],
      themes: [],
      contradictions: [],
      keyInsights: [`Overall Score: ${session.scoreBreakdown.overallScore.toFixed(1)}`],
      bottomLine: `Score: ${session.scoreBreakdown.overallScore.toFixed(1)}`
    };
  }

  return {
    id: session.id,
    studyId: session.studyId || '',
    studyName: session.study?.configJSON ? JSON.parse(session.study.configJSON).name : (session.role || 'Practice Interview'),
    transcript,
    participantProfile: {} as any,
    synthesis,
    behaviorData: { timePerTopic: {}, messagesPerTopic: {}, topicsExplored: [], contradictions: [] }, // Default behavior data
    status: session.status as 'in_progress' | 'completed',
    createdAt: new Date(session.startedAt).getTime(),
    completedAt: session.completedAt ? new Date(session.completedAt).getTime() : Date.now(),
  };
}

export async function GET() {
  try {
    const { authorized, context, error } = await getRequestContext();
    if (!authorized || !context) {
      return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 });
    }

    // Build query based on role (mirroring /api/interviews list logic effectively)
    const where: any = {};
    if (context.researcherId) {
      where.study = { userId: context.researcherId };
    } else if (context.userId) {
      where.userId = context.userId;
    }

    // Fetch from InterviewSession (SQL)
    const sessions = await prisma.interviewSession.findMany({
      where,
      include: {
        questions: {
          orderBy: { createdAt: 'asc' },
          include: { responses: true }
        },
        scoreBreakdown: true,
        study: true
      },
      orderBy: { startedAt: 'desc' }
    });

    const interviews: StoredInterview[] = sessions.map(mapSessionToExportData);

    if (interviews.length === 0) {
      return NextResponse.json(
        { error: 'No interviews to export' },
        { status: 404 }
      );
    }

    // Define CSV Headers
    const headers = [
      'ID',
      'Study Name',
      'Date',
      'Duration (min)',
      'Status',
      'Participant Info',
      'Key Insight',
      'Themes',
      'Transcript'
    ];

    const csvRows = [headers.join(',')];

    interviews.forEach(interview => {
      // 1. Basic Metadata
      const id = interview.id;
      const studyName = interview.studyName;
      const date = new Date(interview.createdAt).toISOString();
      const duration = Math.round((interview.completedAt - interview.createdAt) / 1000 / 60);
      const status = interview.status;

      // 2. Participant Info
      // Flatten all extracted fields into a single string "Field: Value; Field2: Value2"
      let participantInfo = '';
      if (interview.participantProfile?.fields) {
        participantInfo = interview.participantProfile.fields
          .filter(f => f.status === 'extracted' && f.value)
          .map(f => `${f.fieldId}: ${f.value}`)
          .join('; ');
      }

      // 3. Synthesis Data
      const keyInsight = interview.synthesis?.bottomLine || '';
      let themes = '';
      if (interview.synthesis?.themes) {
        themes = interview.synthesis.themes
          .map(t => `${t.theme} (${t.evidence})`)
          .join(' | ');
      }

      // 4. Transcript
      // Format: "[Time] Role: Content"
      const transcript = interview.transcript
        .map(msg => {
          const time = new Date(msg.timestamp).toLocaleTimeString();
          const role = msg.role === 'user' ? 'Participant' : 'Interviewer';
          return `[${time}] ${role}: ${msg.content}`;
        })
        .join('\n');

      // Construct Row
      const row = [
        escapeCsv(id),
        escapeCsv(studyName),
        escapeCsv(date),
        escapeCsv(duration),
        escapeCsv(status),
        escapeCsv(participantInfo),
        escapeCsv(keyInsight),
        escapeCsv(themes),
        escapeCsv(transcript)
      ];

      csvRows.push(row.join(','));
    });

    const csvString = csvRows.join('\n');

    // Return as CSV download
    return new Response(csvString, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="interviews-export-${Date.now()}.csv"`
      }
    });

  } catch (error) {
    console.error('Export API error:', error);
    return NextResponse.json(
      { error: 'Failed to export interviews' },
      { status: 500 }
    );
  }
}
