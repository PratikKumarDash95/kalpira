// POST /api/onboarding/save-credentials - Encrypt and store researcher credentials
// Redis credential saving removed — only API keys are saved now

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@/lib/researcherContext';
import { updateResearcher } from '@/lib/platformDb';
import { encrypt } from '@/lib/crypto';
import { isHostedMode } from '@/lib/mode';
import supabaseDb from '@/lib/supabaseDb';

export async function POST(request: Request) {
  const { authorized, researcherId, context, error } = await getRequestContext();
  if (!authorized || !context) {
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

    if (isHostedMode()) {
      if (!researcherId) {
        return NextResponse.json({ error: 'No researcher identity' }, { status: 401 });
      }

      const success = await updateResearcher(researcherId, updates);
      if (!success) {
        return NextResponse.json({ error: 'Failed to save credentials' }, { status: 500 });
      }
    } else {
      const userId = researcherId || context.userId;
      if (!userId) {
        return NextResponse.json({ error: 'No user identity' }, { status: 401 });
      }

      await supabaseDb.user.update({
        where: { id: userId },
        data: updates,
      });
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
