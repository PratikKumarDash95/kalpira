// GET /api/auth/oauth/google/callback - Handle Google OAuth callback
// Validates the authorization code, creates/finds researcher, sets session

import { NextResponse } from 'next/server';
import * as arctic from 'arctic';
import { cookies } from 'next/headers';
import { isHostedMode } from '@/lib/mode';
import { createSessionToken, getSessionCookieOptions, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getGoogleProfile } from '@/lib/googleOAuth';
import { getResearcherByOAuth, saveResearcher } from '@/lib/platformDb';
import { ResearcherAccount } from '@/types';
import { randomUUID } from 'crypto';
import supabaseDb from '@/lib/supabaseDb';
import { OAUTH_ORIGIN_COOKIE, getDefaultFrontendOrigin } from '@/lib/oauthOrigin';

// The OAuth callback route lives on this backend (it's where these route.ts
// files are actually served from), NOT on the frontend app. This must match
// a redirect URI registered in Google Cloud Console.
function getCallbackBaseUrl(): string {
  return (
    process.env.OAUTH_CALLBACK_BASE_URL ||
    (process.env.RENDER_EXTERNAL_URL ? process.env.RENDER_EXTERNAL_URL : '') ||
    'http://localhost:3003'
  );
}

function getGoogleClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET required');
  }

  return new arctic.Google(clientId, clientSecret, `${getCallbackBaseUrl()}/api/auth/oauth/google/callback`);
}

export async function GET(request: Request) {
  if (!isHostedMode()) {
    return NextResponse.json(
      { error: 'OAuth is only available in hosted mode' },
      { status: 404 }
    );
  }

  const cookieStore = await cookies();
  // Return the browser to whichever frontend origin it started from (there
  // can be more than one live in parallel, e.g. a custom domain + Vercel
  // alias), falling back to the configured default if unset/stale.
  const baseUrl = cookieStore.get(OAUTH_ORIGIN_COOKIE)?.value || getDefaultFrontendOrigin();
  cookieStore.delete(OAUTH_ORIGIN_COOKIE);

  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code || !state) {
      return NextResponse.redirect(new URL('/login?error=missing_params', baseUrl));
    }

    // Verify state matches
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
    const googleUser = await getGoogleProfile(tokens);

    // Find or create researcher
    let researcher = await getResearcherByOAuth('google', googleUser.id);

    if (!researcher) {
      // Create new researcher account
      const now = Date.now();
      researcher = {
        id: randomUUID(),
        email: googleUser.email,
        name: googleUser.name,
        avatarUrl: googleUser.picture,
        coverUrl: null,
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

    await supabaseDb.user.upsert({
      where: { email: googleUser.email },
      update: {
        name: googleUser.name,
        avatarUrl: googleUser.picture,
        oauthProvider: 'google',
        oauthId: googleUser.id,
        emailVerifiedAt: new Date(),
        emailVerificationToken: null,
        emailVerificationSentAt: null,
      },
      create: {
        id: researcher.id,
        email: googleUser.email,
        name: googleUser.name,
        avatarUrl: googleUser.picture,
        oauthProvider: 'google',
        oauthId: googleUser.id,
        role: 'candidate',
        onboardingComplete: researcher.onboardingComplete,
        emailVerifiedAt: new Date(),
        emailVerificationToken: null,
        emailVerificationSentAt: null,
        createdAt: new Date(researcher.createdAt),
        updatedAt: new Date(),
      },
    });

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
