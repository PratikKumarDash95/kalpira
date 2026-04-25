// POST /api/onboarding/validate-redis - Validate storage connection
// Kept for hosted mode compatibility — now validates SQLite instead of Redis

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@/lib/researcherContext';
import { isHostedMode } from '@/lib/mode';
import { isKVAvailable } from '@/lib/kv';

export async function POST(request: Request) {
  if (!isHostedMode()) {
    return NextResponse.json({ error: 'Only available in hosted mode' }, { status: 404 });
  }

  const { authorized, error } = await getRequestContext();
  if (!authorized) {
    return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 });
  }

  try {
    // With SQLite, storage is always available locally
    const available = await isKVAvailable();
    if (available) {
      return NextResponse.json({ valid: true });
    }
    return NextResponse.json({ valid: false, error: 'Database connection failed' });
  } catch (err) {
    console.error('Storage validation error:', err);
    return NextResponse.json({
      valid: false,
      error: 'Failed to validate storage connection.',
    });
  }
}
