// POST /api/studies/[id]/generate-followup - Generate follow-up study from synthesis
// Server-side only - requires authenticated session
// Uses AI to suggest new research questions based on findings

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getInterviewProvider } from '@/lib/providers';
import { getRequestContext } from '@/lib/researcherContext';
import { getStudy, isKVAvailable } from '@/lib/kv';
import { AggregateSynthesisResult, StudyConfig } from '@/types';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { authorized, context, error } = await getRequestContext();
    if (!authorized || !context) {
      return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 });
    }

    const { id: studyId } = await params;

    const kvAvailable = await isKVAvailable();
    if (!kvAvailable) {
      return NextResponse.json(
        { error: 'Storage not configured' },
        { status: 503 }
      );
    }

    // Fetch parent study
    const parentStudy = await getStudy(studyId);
    if (!parentStudy) {
      return NextResponse.json(
        { error: 'Study not found' },
        { status: 404 }
      );
    }

    // Parse request body - expects synthesis data
    const body = await request.json();
    const { synthesis } = body as { synthesis: AggregateSynthesisResult };

    if (!synthesis || !synthesis.keyFindings?.length) {
      return NextResponse.json(
        { error: 'Missing or invalid synthesis data' },
        { status: 400 }
      );
    }

    // Get the configured AI provider with researcher's API keys
    const provider = getInterviewProvider(parentStudy.config, {
      geminiApiKey: context.geminiApiKey,
      anthropicApiKey: context.anthropicApiKey,
      ollamaBaseUrl: process.env.OLLAMA_BASE_URL || null,
    });

    // Generate follow-up study suggestions
    const suggestions = await provider.generateFollowupStudy(
      parentStudy.config,
      synthesis
    );

    // Build pre-filled config for follow-up study
    const followUpConfig: Partial<StudyConfig> = {
      name: suggestions.name,
      description: `Follow-up study based on "${parentStudy.config.name}"`,
      researchQuestion: suggestions.researchQuestion,
      coreQuestions: suggestions.coreQuestions,
      topicAreas: synthesis.commonThemes?.length > 0
        ? synthesis.commonThemes.slice(0, 5).map(t => t.theme)
        : parentStudy.config.topicAreas,
      profileSchema: parentStudy.config.profileSchema,
      aiBehavior: parentStudy.config.aiBehavior,
      consentText: parentStudy.config.consentText,
      aiProvider: parentStudy.config.aiProvider,
      aiModel: parentStudy.config.aiModel,
      enableReasoning: parentStudy.config.enableReasoning,
      parentStudyId: parentStudy.id,
      parentStudyName: parentStudy.config.name,
      generatedFrom: 'synthesis'
    };

    return NextResponse.json({
      followUpConfig,
      parentStudy: {
        id: parentStudy.id,
        name: parentStudy.config.name
      }
    });
  } catch (error) {
    console.error('Generate follow-up API error:', error);
    return NextResponse.json(
      { error: 'Failed to generate follow-up study' },
      { status: 500 }
    );
  }
}
