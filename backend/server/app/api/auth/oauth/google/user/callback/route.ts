// GET /api/auth/oauth/google/user/callback - Handle Google OAuth callback for candidate accounts
import { NextResponse } from 'next/server';
import * as arctic from 'arctic';
import { cookies } from 'next/headers';
import { createSessionToken, getSessionCookieOptions, getSessionSecondsForRole, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getGoogleProfile } from '@/lib/googleOAuth';
import supabaseDb from '@/lib/supabaseDb';
import { OAUTH_ORIGIN_COOKIE, getDefaultFrontendOrigin, getOauthCookieClearOptions } from '@/lib/oauthOrigin';

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

  return new arctic.Google(clientId, clientSecret, `${getCallbackBaseUrl()}/api/auth/oauth/google/user/callback`);
}

export async function GET(request: Request) {
  let step = 'initializing';

  const cookieStore = await cookies();
  // Return the browser to whichever frontend origin it started from (there
  // can be more than one live in parallel, e.g. a custom domain + Vercel
  // alias), falling back to the configured default if unset/stale.
  const baseUrl = cookieStore.get(OAUTH_ORIGIN_COOKIE)?.value || getDefaultFrontendOrigin();
  cookieStore.set(OAUTH_ORIGIN_COOKIE, '', getOauthCookieClearOptions());

  try {
    step = 'reading callback parameters';
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code || !state) {
      return NextResponse.redirect(new URL('/login?error=missing_params', baseUrl));
    }

    step = 'validating OAuth state';
    const storedState = cookieStore.get('google_user_oauth_state')?.value;
    const codeVerifier = cookieStore.get('google_user_oauth_code_verifier')?.value;

    if (!storedState || state !== storedState || !codeVerifier) {
      return NextResponse.redirect(new URL('/login?error=invalid_state', baseUrl));
    }

    cookieStore.set('google_user_oauth_state', '', getOauthCookieClearOptions());
    cookieStore.set('google_user_oauth_code_verifier', '', getOauthCookieClearOptions());

    const google = getGoogleClient();
    step = 'exchanging Google authorization code';
    const tokens = await google.validateAuthorizationCode(code, codeVerifier);
    step = 'reading Google profile';
    const googleUser = await getGoogleProfile(tokens);

    // Find existing CANDIDATE by OAuth provider+id. Scope by role: the same
    // Google account can also own an interviewer row, and this "user" flow must
    // only ever resolve the candidate account.
    step = 'finding user by Google OAuth id';
    let user = await supabaseDb.user.findFirst({
      where: { oauthProvider: 'google', oauthId: googleUser.id, role: 'candidate' },
    });

    if (!user) {
      // Check if a CANDIDATE account already exists for this email (link it).
      // Scope by role so a Google "user" sign-in never links to / promotes the
      // interviewer account that may share this email.
      step = 'finding user by Google email';
      const existing = await supabaseDb.user.findFirst({ where: { email: googleUser.email, role: 'candidate' } });
      if (existing) {
        // Link Google OAuth to existing account
        step = 'linking Google OAuth to existing user';
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
        // Create new candidate account
        step = 'creating candidate user';
        const now = new Date();
        user = await supabaseDb.user.create({
          data: {
            email: googleUser.email,
            name: googleUser.name,
            avatarUrl: googleUser.picture,
            oauthProvider: 'google',
            oauthId: googleUser.id,
            role: 'candidate',
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

    step = 'creating session';
    const sessionRole = user.role || 'candidate';
    const sessionToken = await createSessionToken(user.id, sessionRole);
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions(getSessionSecondsForRole(sessionRole)));

    // Land the account on the dashboard that matches its ACTUAL role. Someone
    // may sign in via the "user" button with an account that is actually an
    // interviewer/admin — send them to the right place instead of the candidate
    // landing (which would 401 on candidate-only endpoints).
    const redirectTo =
      user.role === 'interviewer' ? '/interviewer/dashboard'
      : user.role === 'admin' ? '/admin'
      : '/studies';
    return NextResponse.redirect(new URL(redirectTo, baseUrl));
  } catch (error: any) {
    const msg = error?.message || String(error);
    const cause = error?.cause?.message || error?.cause?.code || '';
    const nestedCause = error?.cause?.cause?.message || error?.cause?.cause?.code || '';
    console.error('Google user OAuth callback error:', step, msg, cause || '', nestedCause || '');
    const detail = encodeURIComponent(
      `${step}: ${msg}${cause ? ' | ' + cause : ''}${nestedCause ? ' | ' + nestedCause : ''}`.slice(0, 300)
    );
    return NextResponse.redirect(new URL(`/login?error=oauth_failed&detail=${detail}`, baseUrl));
  }
}
