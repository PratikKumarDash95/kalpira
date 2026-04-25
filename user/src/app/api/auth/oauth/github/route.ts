// GET /api/auth/oauth/github - Initiate GitHub OAuth flow
// Redirects user to GitHub's authorization page
// Only available in hosted mode

import { NextResponse } from 'next/server';
import * as arctic from 'arctic';
import { cookies } from 'next/headers';
import { isHostedMode } from '@/lib/mode';

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
