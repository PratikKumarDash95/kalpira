// POST /api/onboarding/complete - Mark onboarding as complete
// Only available in hosted mode

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@/lib/researcherContext';
import { assertTrustedOrigin } from '@/lib/csrf';
import { updateResearcher } from '@/lib/platformDb';
import { isHostedMode } from '@/lib/mode';

// Body-less POST, so it is a CORS "simple request" and never preflights; the
// session cookie is SameSite=None in production and rides along cross-site.
// Without the origin check, a page the researcher visits could flip their own
// onboarding state with the researcher's own cookie.
export async function POST(request: Request) {
  const csrfError = assertTrustedOrigin(request);
  if (csrfError) return csrfError;

  if (!isHostedMode()) {
    return NextResponse.json({ error: 'Only available in hosted mode' }, { status: 404 });
  }

  const { authorized, researcherId, error } = await getRequestContext();
  if (!authorized || !researcherId) {
    return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 });
  }

  try {
    const success = await updateResearcher(researcherId, {
      onboardingComplete: true,
    });

    if (!success) {
      return NextResponse.json({ error: 'Failed to complete onboarding' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Onboarding complete error:', error);
    return NextResponse.json(
      { error: 'Failed to complete onboarding' },
      { status: 500 }
    );
  }
}
