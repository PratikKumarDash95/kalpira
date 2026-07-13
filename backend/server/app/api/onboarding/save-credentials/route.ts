// POST /api/onboarding/save-credentials — DEPRECATED / GONE.
//
// The self-service flow no longer uses bring-your-own AI keys. Studies and
// practices run on the platform's AI, and capacity is governed by the user's
// subscription instead. This endpoint is kept as a stub so any stale client that
// still calls it fails cleanly (410) rather than silently storing keys.

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      error: 'Bring-your-own API keys are no longer supported. Studies and practices now run on the platform AI, governed by your subscription.',
      code: 'GONE',
    },
    { status: 410 },
  );
}
