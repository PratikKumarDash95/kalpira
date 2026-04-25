// GET /api/auth/me - Returns current researcher profile
// Used by client for displaying researcher info and onboarding status

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@/lib/researcherContext';
import { getResearcherById, toResearcherProfile } from '@/lib/platformDb';
import { isHostedMode } from '@/lib/mode';

export async function GET() {
  try {
    const { authorized, context, researcherId, error } = await getRequestContext();
    if (!authorized || !context) {
      return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 });
    }

    // In standalone mode, return basic info
    if (!isHostedMode()) {
      return NextResponse.json({
        mode: 'standalone',
        authenticated: true,
      });
    }

    // In hosted mode, return researcher profile
    if (!researcherId) {
      return NextResponse.json({ error: 'No researcher identity' }, { status: 401 });
    }

    const researcher = await getResearcherById(researcherId);
    if (!researcher) {
      return NextResponse.json({ error: 'Researcher not found' }, { status: 404 });
    }

    return NextResponse.json({
      mode: 'hosted',
      authenticated: true,
      profile: toResearcherProfile(researcher),
    });
  } catch (error) {
    console.error('Auth me error:', error);
    return NextResponse.json(
      { error: 'Failed to get profile' },
      { status: 500 }
    );
  }
}
