// GET /api/auth/oauth/github/callback - Handle GitHub OAuth callback
// Validates the authorization code, creates/finds researcher, sets session

import { NextResponse } from 'next/server';
import * as arctic from 'arctic';
import { cookies } from 'next/headers';
import { isHostedMode } from '@/lib/mode';
import { createSessionToken, getSessionCookieOptions, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getResearcherByOAuth, saveResearcher } from '@/lib/platformDb';
import { ResearcherAccount } from '@/types';
import { randomUUID } from 'crypto';

function getGitHubClient() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

  if (!clientId || !clientSecret) {
    throw new Error('GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET required');
  }

  return new arctic.GitHub(clientId, clientSecret, `${baseUrl}/api/auth/oauth/github/callback`);
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
    const storedState = cookieStore.get('github_oauth_state')?.value;

    if (!storedState || state !== storedState) {
      return NextResponse.redirect(new URL('/login?error=invalid_state', baseUrl));
    }

    // Clean up OAuth cookie
    cookieStore.delete('github_oauth_state');

    // Exchange code for tokens
    const github = getGitHubClient();
    const tokens = await github.validateAuthorizationCode(code);
    const accessToken = tokens.accessToken();

    // Fetch user info from GitHub
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

    // If email is not public, fetch from emails endpoint
    let email = githubUser.email;
    if (!email) {
      const emailsResponse = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });
      if (emailsResponse.ok) {
        const emails = await emailsResponse.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
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
      // Create new researcher account
      const now = Date.now();
      researcher = {
        id: randomUUID(),
        email,
        name: githubUser.name || githubUser.login,
        avatarUrl: githubUser.avatar_url || null,
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
    console.error('GitHub OAuth callback error:', error);
    return NextResponse.redirect(new URL('/login?error=oauth_failed', baseUrl));
  }
}
