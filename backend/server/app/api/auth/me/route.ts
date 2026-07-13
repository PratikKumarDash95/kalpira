// GET /api/auth/me - Returns current researcher profile
// Used by client for displaying researcher info and onboarding status

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@/lib/researcherContext';
import { getResearcherById, toResearcherProfile, updateResearcher } from '@/lib/platformDb';
import { isHostedMode } from '@/lib/mode';
import supabaseDb from '@/lib/supabaseDb';

export async function GET() {
  try {
    const { authorized, context, researcherId, error } = await getRequestContext();
    if (!authorized || !context) {
      return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 });
    }

    // In standalone mode, password users still carry a researcherId in the
    // session. A session WITHOUT a researcherId is not a real user identity
    // (e.g. the legacy global-admin login) — do NOT fall back to findFirst(),
    // which returned an arbitrary/seeded row and made a logged-out or admin
    // browser display someone else's profile.
    if (!isHostedMode()) {
      if (!researcherId) {
        return NextResponse.json({ mode: 'standalone', authenticated: false, profile: null }, { status: 401 });
      }

      const user = await supabaseDb.user.findUnique({ where: { id: researcherId } });

      return NextResponse.json({
        mode: 'standalone',
        authenticated: true,
        profile: user ? {
          id: user.id,
          email: user.email || '',
          name: user.name || user.email || 'Kalpira User',
          // role drives client-side dashboard routing (candidate vs interviewer
          // vs admin). Omitting it made the frontend treat every account as a
          // candidate and hit candidate-only endpoints, which 401 for others.
          role: user.role || 'candidate',
          avatarUrl: user.avatarUrl,
          coverUrl: user.coverUrl,
          onboardingComplete: user.onboardingComplete,
          hasRedisConfigured: true,
        } : null,
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

export async function PATCH(request: Request) {
  try {
    const { authorized, context, researcherId, error } = await getRequestContext();
    if (!authorized || !context) {
      return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    const avatarUrl = typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() : undefined;
    const coverUrl = typeof body.coverUrl === 'string' ? body.coverUrl.trim() : undefined;

    if (name !== undefined && name.length === 0) {
      return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
    }

    if (avatarUrl !== undefined && avatarUrl.length > 0) {
      try {
        const parsed = new URL(avatarUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return NextResponse.json({ error: 'Avatar URL must be http or https' }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: 'Avatar URL is invalid' }, { status: 400 });
      }
    }

    if (coverUrl !== undefined && coverUrl.length > 0) {
      try {
        const parsed = new URL(coverUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return NextResponse.json({ error: 'Cover URL must be http or https' }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: 'Cover URL is invalid' }, { status: 400 });
      }
    }

    const userId = researcherId || context.userId;
    if (!userId) {
      return NextResponse.json({ error: 'No profile identity' }, { status: 401 });
    }

    const updates: { name?: string; avatarUrl?: string | null; coverUrl?: string | null } = {};
    if (name !== undefined) updates.name = name;
    if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl || null;
    if (coverUrl !== undefined) updates.coverUrl = coverUrl || null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No profile changes provided' }, { status: 400 });
    }

    if (isHostedMode()) {
      const updated = await updateResearcher(userId, updates);
      if (!updated) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    } else {
      await supabaseDb.user.update({ where: { id: userId }, data: updates });
    }

    const user = await supabaseDb.user.findUnique({ where: { id: userId } });
    return NextResponse.json({
      success: true,
      profile: user ? {
        id: user.id,
        email: user.email || '',
        name: user.name || user.email || 'Kalpira User',
        role: user.role || 'candidate',
        avatarUrl: user.avatarUrl,
        coverUrl: user.coverUrl,
        onboardingComplete: user.onboardingComplete,
        hasRedisConfigured: true,
      } : null,
    });
  } catch (error) {
    console.error('Profile update error:', error);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}
