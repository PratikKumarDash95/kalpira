// POST /api/onboarding/complete - Mark onboarding as complete
// Only available in hosted mode

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@/lib/researcherContext';
import { updateResearcher } from '@/lib/platformDb';
import { isHostedMode } from '@/lib/mode';

export async function POST() {
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
