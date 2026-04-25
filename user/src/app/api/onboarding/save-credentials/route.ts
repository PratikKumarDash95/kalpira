// POST /api/onboarding/save-credentials - Encrypt and store researcher credentials
// Only available in hosted mode
// Redis credential saving removed — only API keys are saved now

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@/lib/researcherContext';
import { updateResearcher } from '@/lib/platformDb';
import { encrypt } from '@/lib/crypto';
import { isHostedMode } from '@/lib/mode';

export async function POST(request: Request) {
  if (!isHostedMode()) {
    return NextResponse.json({ error: 'Only available in hosted mode' }, { status: 404 });
  }

  const { authorized, researcherId, error } = await getRequestContext();
  if (!authorized || !researcherId) {
    return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { geminiApiKey, anthropicApiKey } = body as {
      geminiApiKey?: string;
      anthropicApiKey?: string;
    };

    // Build updates — only encrypt and store non-empty values
    const updates: Record<string, string | number | null> = {};

    if (geminiApiKey) {
      updates.encryptedGeminiApiKey = encrypt(geminiApiKey);
    }

    if (anthropicApiKey) {
      updates.encryptedAnthropicApiKey = encrypt(anthropicApiKey);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No credentials provided' }, { status: 400 });
    }

    const success = await updateResearcher(researcherId, updates);
    if (!success) {
      return NextResponse.json({ error: 'Failed to save credentials' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Save credentials error:', error);
    return NextResponse.json(
      { error: 'Failed to save credentials' },
      { status: 500 }
    );
  }
}
