// GET /api/auth/oauth/google - Initiate Google OAuth flow
// Redirects user to Google's authorization page
// Only available in hosted mode

import { NextResponse } from 'next/server';
import * as arctic from 'arctic';
import { cookies } from 'next/headers';
import { isHostedMode } from '@/lib/mode';
import { OAUTH_ORIGIN_COOKIE, getDefaultFrontendOrigin, getOauthOriginCookieOptions, getOauthStateCookieOptions, resolveReturnOrigin } from '@/lib/oauthOrigin';

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
    cookieStore.set('google_oauth_state', state, getOauthStateCookieOptions());
    cookieStore.set('google_oauth_code_verifier', codeVerifier, getOauthStateCookieOptions());

    const returnOrigin = resolveReturnOrigin(request);
    if (returnOrigin) {
      cookieStore.set(OAUTH_ORIGIN_COOKIE, returnOrigin, getOauthOriginCookieOptions());
    }

    return NextResponse.redirect(url);
  } catch (error) {
    console.error('Google OAuth initiation error:', error);
    return NextResponse.redirect(
      new URL('/login?error=oauth_init_failed', getDefaultFrontendOrigin())
    );
  }
}
