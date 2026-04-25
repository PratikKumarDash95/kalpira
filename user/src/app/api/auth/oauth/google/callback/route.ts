// GET /api/auth/oauth/google/callback - Handle Google OAuth callback
// Validates the authorization code, creates/finds researcher, sets session

import { NextResponse } from 'next/server';
import * as arctic from 'arctic';
import { cookies } from 'next/headers';
import { isHostedMode } from '@/lib/mode';
import { createSessionToken, getSessionCookieOptions, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getResearcherByOAuth, saveResearcher } from '@/lib/platformDb';
import { ResearcherAccount } from '@/types';
import { randomUUID } from 'crypto';

function getGoogleClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET required');
  }

  return new arctic.Google(clientId, clientSecret, `${baseUrl}/api/auth/oauth/google/callback`);
}

function getBaseUrl(): string {
  return process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
}

export async function GET(request: Request) {
  if (!isHostedMode()) {
    return NextResponse.json(
      { error: 'OAuth is only available in hosted mode' },
      { status: 404 }
    );
  }

  const baseUrl = getBaseUrl();

  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code || !state) {
      return NextResponse.redirect(new URL('/login?error=missing_params', baseUrl));
    }

    // Verify state matches
    const cookieStore = await cookies();
    const storedState = cookieStore.get('google_oauth_state')?.value;
    const codeVerifier = cookieStore.get('google_oauth_code_verifier')?.value;

    if (!storedState || state !== storedState || !codeVerifier) {
      return NextResponse.redirect(new URL('/login?error=invalid_state', baseUrl));
    }

    // Clean up OAuth cookies
    cookieStore.delete('google_oauth_state');
    cookieStore.delete('google_oauth_code_verifier');

    // Exchange code for tokens
    const google = getGoogleClient();
    const tokens = await google.validateAuthorizationCode(code, codeVerifier);
    const accessToken = tokens.accessToken();

    // Fetch user info from Google
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userResponse.ok) {
      return NextResponse.redirect(new URL('/login?error=user_fetch_failed', baseUrl));
    }

    const googleUser = await userResponse.json() as {
      id: string;
      email: string;
      name: string;
      picture: string;
    };

    // Find or create researcher
    let researcher = await getResearcherByOAuth('google', googleUser.id);

    if (!researcher) {
      // Create new researcher account
      const now = Date.now();
      researcher = {
        id: randomUUID(),
        email: googleUser.email,
        name: googleUser.name,
        avatarUrl: googleUser.picture || null,
        oauthProvider: 'google',
        oauthId: googleUser.id,
        createdAt: now,
        lastLoginAt: now,
        onboardingComplete: false,
        encryptedRedisUrl: null,
        encryptedRedisToken: null,
        encryptedGeminiApiKey: null,
        encryptedAnthropicApiKey: null,
        redisConfiguredAt: null,
      } satisfies ResearcherAccount;

      await saveResearcher(researcher);
    } else {
      // Update last login time (fire-and-forget)
      const { updateResearcher } = await import('@/lib/platformDb');
      updateResearcher(researcher.id, { lastLoginAt: Date.now() }).catch(() => {});
    }

    // Create session token with researcher ID
    const sessionToken = await createSessionToken(researcher.id);

    // Set session cookie
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions());

    // Redirect based on onboarding status
    const redirectTo = researcher.onboardingComplete ? '/studies' : '/onboarding';
    return NextResponse.redirect(new URL(redirectTo, baseUrl));
  } catch (error) {
    console.error('Google OAuth callback error:', error);
    return NextResponse.redirect(new URL('/login?error=oauth_failed', baseUrl));
  }
}
