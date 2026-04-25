// GET /api/config/status - Returns which optional API keys are configured
// Only returns boolean status, never actual key values

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@/lib/researcherContext';

export async function GET() {
  try {
    const { authorized, context, error } = await getRequestContext();
    if (!authorized || !context) {
      return NextResponse.json({ error: error || 'Authentication required' }, { status: 401 });
    }

    // Return researcher-specific key status from context
    // In standalone mode, these come from env vars
    // In hosted mode, these come from the researcher's decrypted credentials
    const status = {
      hasAnthropicKey: !!context.anthropicApiKey,
      hasGeminiKey: !!context.geminiApiKey,
      hasOllamaConfigured: !!(process.env.OLLAMA_BASE_URL || process.env.AI_PROVIDER === 'ollama'),
    };

    return NextResponse.json(status);
  } catch (error) {
    console.error('Config status API error:', error);
    return NextResponse.json(
      { error: 'Failed to check configuration status' },
      { status: 500 }
    );
  }
}
