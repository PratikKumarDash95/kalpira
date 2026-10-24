// GET /api/auth/me - Returns current researcher profile
// Used by client for displaying researcher info and onboarding status

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';
import { isHostedMode } from '@/lib/mode';
import supabaseDb from '@/lib/supabaseDb';

async function getProfileIdentity() {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session?.valid || !session.researcherId) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { userId: session.researcherId };
}

function toProfile(user: NonNullable<Awaited<ReturnType<typeof supabaseDb.user.findUnique>>>) {
  return {
    id: user.id,
    email: user.email || '',
    name: user.name || user.email || 'Kalpira User',
    role: user.role || 'candidate',
    avatarUrl: user.avatarUrl,
    coverUrl: user.coverUrl,
    onboardingComplete: user.onboardingComplete,
    hasRedisConfigured: true,
    hasGeminiKey: !!user.encryptedGeminiApiKey,
    hasAnthropicKey: !!user.encryptedAnthropicApiKey,
  };
}

export async function GET() {
  try {
    // A profile needs only a verified identity, not decrypted AI credentials.
    // Credential-loading failures must not turn a valid session into a 401.
    const identity = await getProfileIdentity();
    if (identity.error) return identity.error;
    const user = await supabaseDb.user.findUnique({ where: { id: identity.userId } });
    if (!user) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }
    return NextResponse.json({
      mode: isHostedMode() ? 'hosted' : 'standalone',
      authenticated: true,
      profile: toProfile(user),
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
    const identity = await getProfileIdentity();
    if (identity.error) return identity.error;

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

    const userId = identity.userId;

    const updates: { name?: string; avatarUrl?: string | null; coverUrl?: string | null } = {};
    if (name !== undefined) updates.name = name;
    if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl || null;
    if (coverUrl !== undefined) updates.coverUrl = coverUrl || null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No profile changes provided' }, { status: 400 });
    }

    const existing = await supabaseDb.user.findUnique({ where: { id: userId } });
    if (!existing) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    const user = await supabaseDb.user.update({ where: { id: userId }, data: updates });
    return NextResponse.json({ success: true, profile: toProfile(user) });
  } catch (error) {
    console.error('Profile update error:', error);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}
