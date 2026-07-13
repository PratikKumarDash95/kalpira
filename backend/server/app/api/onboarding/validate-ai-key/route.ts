// POST /api/onboarding/validate-ai-key — DEPRECATED / GONE.
//
// Users no longer supply their own AI keys, so there is nothing to validate.
// Kept as a stub so any stale client fails cleanly (410) instead of 500-ing.

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      valid: false,
      error: 'Bring-your-own API keys are no longer supported. Studies and practices now run on the platform AI.',
      code: 'GONE',
    },
    { status: 410 },
  );
}
