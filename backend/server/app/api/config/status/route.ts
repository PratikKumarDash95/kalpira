// GET /api/config/status - Returns which optional API keys are configured
// Only returns boolean status, never actual key values

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@/lib/researcherContext';
import { isRazorpayConfigured } from '@/lib/razorpay';

export async function GET() {
  try {
    const { authorized, context, error } = await getRequestContext();
    if (!authorized || !context) {
      return NextResponse.json({ error: error || 'Authentication required' }, { status: 401 });
    }

    // AI keys are no longer user-supplied for the self-service flow
    // (studies/practices run on the platform's AI), so only the still-relevant
    // flags are surfaced here.
    const status = {
      hasOllamaConfigured: !!(process.env.OLLAMA_BASE_URL || process.env.AI_PROVIDER === 'ollama'),
      hasRazorpayConfigured: isRazorpayConfigured(),
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
