// GET /api/auth/oauth/google/interviewer - Initiate Google OAuth for interviewer accounts
import { NextResponse } from 'next/server';
import * as arctic from 'arctic';
import { cookies } from 'next/headers';
import { OAUTH_ORIGIN_COOKIE, getDefaultFrontendOrigin, getOauthOriginCookieOptions, resolveReturnOrigin } from '@/lib/oauthOrigin';

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

  return new arctic.Google(clientId, clientSecret, `${getCallbackBaseUrl()}/api/auth/oauth/google/interviewer/callback`);
}

function getInterviewerLoginUrl(baseUrl: string, error: string) {
  const url = new URL('/login', baseUrl);
  url.searchParams.set('role', 'interviewer');
  url.searchParams.set('error', error);
  return url;
}

export async function GET(request: Request) {
  try {
    const google = getGoogleClient();
    const state = arctic.generateState();
    const codeVerifier = arctic.generateCodeVerifier();

    const url = google.createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email']);

    const cookieStore = await cookies();
    cookieStore.set('google_interviewer_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    });
    cookieStore.set('google_interviewer_oauth_code_verifier', codeVerifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    });

    const returnOrigin = resolveReturnOrigin(request);
    if (returnOrigin) {
      cookieStore.set(OAUTH_ORIGIN_COOKIE, returnOrigin, getOauthOriginCookieOptions());
    }

    return NextResponse.redirect(url);
  } catch (error) {
    console.error('Google interviewer OAuth initiation error:', error);
    return NextResponse.redirect(getInterviewerLoginUrl(getDefaultFrontendOrigin(), 'oauth_init_failed'));
  }
}
