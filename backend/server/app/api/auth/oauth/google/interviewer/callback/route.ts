// GET /api/auth/oauth/google/interviewer/callback - Handle Google OAuth callback for interviewer accounts
import { NextResponse } from 'next/server';
import * as arctic from 'arctic';
import { cookies } from 'next/headers';
import { createSessionToken, getSessionCookieOptions, getSessionSecondsForRole, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getGoogleProfile } from '@/lib/googleOAuth';
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

  return new arctic.Google(clientId, clientSecret, `${getCallbackBaseUrl()}/api/auth/oauth/google/interviewer/callback`);
}

function getInterviewerLoginUrl(baseUrl: string, error: string) {
  const url = new URL('/login', baseUrl);
  url.searchParams.set('role', 'interviewer');
  url.searchParams.set('error', error);
  return url;
}

export async function GET(request: Request) {
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
      return NextResponse.redirect(getInterviewerLoginUrl(baseUrl, 'missing_params'));
    }

    const storedState = cookieStore.get('google_interviewer_oauth_state')?.value;
    const codeVerifier = cookieStore.get('google_interviewer_oauth_code_verifier')?.value;

    if (!storedState || state !== storedState || !codeVerifier) {
      return NextResponse.redirect(getInterviewerLoginUrl(baseUrl, 'invalid_state'));
    }

    cookieStore.delete('google_interviewer_oauth_state');
    cookieStore.delete('google_interviewer_oauth_code_verifier');

    const google = getGoogleClient();
    const tokens = await google.validateAuthorizationCode(code, codeVerifier);
    const googleUser = await getGoogleProfile(tokens);

    // Find existing interviewer by OAuth provider+id
    let user = await supabaseDb.user.findFirst({
      where: { oauthProvider: 'google', oauthId: googleUser.id, role: 'interviewer' },
    });

    if (!user) {
      // Link an existing INTERVIEWER account for this email (scoped by role).
      // A candidate account may separately own the same email — we must NOT
      // promote/overwrite it; only ever touch the interviewer row here.
      const existing = await supabaseDb.user.findFirst({
        where: { email: googleUser.email, role: 'interviewer' },
      });

      if (existing) {
        user = await supabaseDb.user.update({
          where: { id: existing.id },
          data: {
            oauthProvider: 'google',
            oauthId: googleUser.id,
            avatarUrl: existing.avatarUrl || googleUser.picture,
            emailVerifiedAt: existing.emailVerifiedAt || new Date(),
            emailVerificationToken: null,
            emailVerificationSentAt: null,
          },
        });
      } else {
        // Create new interviewer account via Google
        const now = new Date();
        user = await supabaseDb.user.create({
          data: {
            email: googleUser.email,
            name: googleUser.name,
            avatarUrl: googleUser.picture,
            oauthProvider: 'google',
            oauthId: googleUser.id,
            role: 'interviewer',
            emailVerifiedAt: now,
            emailVerificationToken: null,
            emailVerificationSentAt: null,
            onboardingComplete: false,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
    }

    const sessionToken = await createSessionToken(user.id, 'interviewer');
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions(getSessionSecondsForRole('interviewer')));

    return NextResponse.redirect(new URL('/interviewer/dashboard', baseUrl));
  } catch (error) {
    console.error('Google interviewer OAuth callback error:', error);
    return NextResponse.redirect(getInterviewerLoginUrl(baseUrl, 'oauth_failed'));
  }
}
