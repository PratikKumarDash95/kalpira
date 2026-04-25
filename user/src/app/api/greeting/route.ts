// POST /api/greeting - Get interview greeting
// Server-side only - API keys never sent to client
// Requires valid participant token to prevent quota abuse

import { NextResponse } from 'next/server';
import { getInterviewProvider } from '@/lib/providers';
import { getParticipantRequestContext } from '@/lib/researcherContext';
import { StudyConfig } from '@/types';

export async function POST(request: Request) {
  try {
    // Verify participant token and resolve researcher context
    const { valid, context, studyId, isAdmin, error } = await getParticipantRequestContext(request);
    if (!valid || !context) {
      return NextResponse.json(
        { error: error || 'Valid participant token required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { studyConfig } = body as { studyConfig: StudyConfig };

    // Validate required fields
    if (!studyConfig) {
      return NextResponse.json(
        { error: 'Missing required field: studyConfig' },
        { status: 400 }
      );
    }

    // Verify token's studyId matches the requested study (prevents token reuse across studies)
    // Skip for admin users (researchers previewing their studies)
    if (!isAdmin && studyId && studyConfig.id && studyId !== studyConfig.id) {
      return NextResponse.json(
        { error: 'Token not valid for this study' },
        { status: 403 }
      );
    }

    // Get the configured AI provider with researcher's API keys
    const provider = getInterviewProvider(studyConfig, {
      geminiApiKey: context.geminiApiKey,
      anthropicApiKey: context.anthropicApiKey,
      ollamaBaseUrl: process.env.OLLAMA_BASE_URL || null,
    });

    // Generate greeting using the provider
    const greeting = await provider.getInterviewGreeting(studyConfig);

    return NextResponse.json({ greeting });
  } catch (error) {
    console.error('Greeting API error:', error);
    return NextResponse.json(
      { error: 'Failed to generate greeting' },
      { status: 500 }
    );
  }
}
