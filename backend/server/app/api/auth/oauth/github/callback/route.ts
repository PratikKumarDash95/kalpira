// GET /api/auth/oauth/github/callback
// Handle GitHub OAuth callback safely for Vercel + Supabase

import { NextResponse } from 'next/server';
import * as arctic from 'arctic';
import { cookies } from 'next/headers';
import { isHostedMode } from '@/lib/mode';
import { createSessionToken, getSessionCookieOptions, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getResearcherByOAuth, saveResearcher } from '@/lib/platformDb';
import { ResearcherAccount } from '@/types';
import { randomUUID } from 'crypto';
import { OAUTH_ORIGIN_COOKIE, getDefaultFrontendOrigin, getOauthCookieClearOptions } from '@/lib/oauthOrigin';

export const runtime = "nodejs";

// The OAuth callback route lives on this backend (it's where these route.ts
// files are actually served from), NOT on the frontend app. This must match
// a redirect URI registered in the GitHub OAuth app.
function getCallbackBaseUrl(): string {
  return (
    process.env.OAUTH_CALLBACK_BASE_URL ||
    (process.env.RENDER_EXTERNAL_URL ? process.env.RENDER_EXTERNAL_URL : '') ||
    'http://localhost:3003'
  );
}

/**
 * Safely create GitHub OAuth client
 * Never throw errors (prevents build crash)
 */
function getGitHubClient() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("GitHub OAuth environment variables missing");
    return null;
  }

  return new arctic.GitHub(
    clientId,
    clientSecret,
    `${getCallbackBaseUrl()}/api/auth/oauth/github/callback`
  );
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
  cookieStore.set(OAUTH_ORIGIN_COOKIE, '', getOauthCookieClearOptions());

  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code || !state) {
      return NextResponse.redirect(new URL('/login?error=missing_params', baseUrl));
    }

    // Verify state cookie
    const storedState = cookieStore.get('github_oauth_state')?.value;

    if (!storedState || state !== storedState) {
      return NextResponse.redirect(new URL('/login?error=invalid_state', baseUrl));
    }

    cookieStore.set('github_oauth_state', '', getOauthCookieClearOptions());

    // Create GitHub client safely
    const github = getGitHubClient();
    if (!github) {
      return NextResponse.redirect(new URL('/login?error=config', baseUrl));
    }

    // Exchange code for access token
    const tokens = await github.validateAuthorizationCode(code);
    const accessToken = tokens.accessToken();

    // Fetch user info
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!userResponse.ok) {
      return NextResponse.redirect(new URL('/login?error=user_fetch_failed', baseUrl));
    }

    const githubUser = await userResponse.json() as {
      id: number;
      login: string;
      name: string | null;
      avatar_url: string;
      email: string | null;
    };

    // Get email if private
    let email = githubUser.email;

    if (!email) {
      const emailsResponse = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (emailsResponse.ok) {
        const emails = await emailsResponse.json() as Array<{
          email: string;
          primary: boolean;
          verified: boolean;
        }>;

        const primaryEmail = emails.find(e => e.primary && e.verified);
        email = primaryEmail?.email || emails[0]?.email || null;
      }
    }

    if (!email) {
      return NextResponse.redirect(new URL('/login?error=no_email', baseUrl));
    }

    // Find or create researcher
    let researcher = await getResearcherByOAuth('github', String(githubUser.id));

    if (!researcher) {
      const now = Date.now();

      researcher = {
        id: randomUUID(),
        email,
        name: githubUser.name || githubUser.login,
        avatarUrl: githubUser.avatar_url || null,
        coverUrl: null,
        oauthProvider: 'github',
        oauthId: String(githubUser.id),
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
      const { updateResearcher } = await import('@/lib/platformDb');
      updateResearcher(researcher.id, { lastLoginAt: Date.now() }).catch(() => { });
    }

    // Create session
    const sessionToken = await createSessionToken(researcher.id);

    cookieStore.set(
      SESSION_COOKIE_NAME,
      sessionToken,
      getSessionCookieOptions()
    );

    const redirectTo = researcher.onboardingComplete ? '/studies' : '/onboarding';
    return NextResponse.redirect(new URL(redirectTo, baseUrl));

  } catch (error) {
    console.error('GitHub OAuth callback error:', error);
    return NextResponse.redirect(new URL('/login?error=oauth_failed', baseUrl));
  }
}
