// POST /api/onboarding/validate-ai-key - Test if an AI API key works
// Makes a small test call to verify the key is valid
// Only available in hosted mode

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@/lib/researcherContext';
import { isHostedMode } from '@/lib/mode';

export async function POST(request: Request) {
  if (!isHostedMode()) {
    return NextResponse.json({ error: 'Only available in hosted mode' }, { status: 404 });
  }

  const { authorized, error } = await getRequestContext();
  if (!authorized) {
    return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { provider, apiKey } = body as { provider: 'gemini' | 'claude'; apiKey: string };

    if (!provider || !apiKey) {
      return NextResponse.json({ error: 'Missing provider or apiKey' }, { status: 400 });
    }

    if (provider === 'gemini') {
      // Test Gemini key with a minimal request
      // Use header-based auth (x-goog-api-key) to avoid leaking the key in URL query strings
      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Say hello in one word.' }] }],
            generationConfig: { maxOutputTokens: 10 },
          }),
        }
      );

      if (!response.ok) {
        return NextResponse.json({
          valid: false,
          error: response.status === 400 || response.status === 403
            ? 'Invalid API key'
            : `API error (status ${response.status}). Please check your key and try again.`,
        });
      }

      return NextResponse.json({ valid: true });
    }

    if (provider === 'claude') {
      // Test Anthropic key with a minimal request
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Say hello in one word.' }],
        }),
      });

      if (!response.ok) {
        return NextResponse.json({
          valid: false,
          error: response.status === 401 ? 'Invalid API key' : `API error (${response.status})`,
        });
      }

      return NextResponse.json({ valid: true });
    }

    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
  } catch (error) {
    console.error('AI key validation error:', error);
    return NextResponse.json({ valid: false, error: 'Validation request failed' });
  }
}
