// GET /api/auth/oauth/github - Initiate GitHub OAuth flow
// Redirects user to GitHub's authorization page
// Only available in hosted mode

import { NextResponse } from 'next/server';
import * as arctic from 'arctic';
import { cookies } from 'next/headers';
import { isHostedMode } from '@/lib/mode';

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

function getGitHubClient() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET required');
  }

  return new arctic.GitHub(clientId, clientSecret, `${getCallbackBaseUrl()}/api/auth/oauth/github/callback`);
}

export async function GET() {
  if (!isHostedMode()) {
    return NextResponse.json(
      { error: 'OAuth is only available in hosted mode' },
      { status: 404 }
    );
  }

  try {
    const github = getGitHubClient();
    const state = arctic.generateState();

    const url = github.createAuthorizationURL(state, ['user:email']);

    // Store state in cookie for callback verification
    const cookieStore = await cookies();
    cookieStore.set('github_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Lax needed for OAuth redirects
      maxAge: 600, // 10 minutes
      path: '/',
    });

    return NextResponse.redirect(url);
  } catch (error) {
    console.error('GitHub OAuth initiation error:', error);
    return NextResponse.redirect(
      new URL('/login?error=oauth_init_failed', process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000')
    );
  }
}
