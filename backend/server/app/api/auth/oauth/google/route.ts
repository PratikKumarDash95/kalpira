// GET /api/auth/oauth/google - Initiate Google OAuth flow
// Redirects user to Google's authorization page
// Only available in hosted mode

import { NextResponse } from 'next/server';
import * as arctic from 'arctic';
import { cookies } from 'next/headers';
import { isHostedMode } from '@/lib/mode';

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

export async function GET() {
  if (!isHostedMode()) {
    return NextResponse.json(
      { error: 'OAuth is only available in hosted mode' },
      { status: 404 }
    );
  }

  try {
    const google = getGoogleClient();
    const state = arctic.generateState();
    const codeVerifier = arctic.generateCodeVerifier();

    const url = google.createAuthorizationURL(state, codeVerifier, [
      'openid',
      'profile',
      'email',
    ]);

    // Store state and code verifier in cookies for callback verification
    const cookieStore = await cookies();
    cookieStore.set('google_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Lax needed for OAuth redirects
      maxAge: 600, // 10 minutes
      path: '/',
    });
    cookieStore.set('google_oauth_code_verifier', codeVerifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    });

    return NextResponse.redirect(url);
  } catch (error) {
    console.error('Google OAuth initiation error:', error);
    return NextResponse.redirect(
      new URL('/login?error=oauth_init_failed', process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000')
    );
  }
}
