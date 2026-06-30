// GET /api/auth/oauth/google/user/callback - Handle Google OAuth callback for candidate accounts
import { NextResponse } from 'next/server';
import * as arctic from 'arctic';
import { cookies } from 'next/headers';
import { createSessionToken, getSessionCookieOptions, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getGoogleProfile } from '@/lib/googleOAuth';
import supabaseDb from '@/lib/supabaseDb';

function getGoogleClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET required');
  }

  return new arctic.Google(clientId, clientSecret, `${baseUrl}/api/auth/oauth/google/user/callback`);
}

function getBaseUrl(): string {
  return process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
}

export async function GET(request: Request) {
  const baseUrl = getBaseUrl();
  let step = 'initializing';

  try {
    step = 'reading callback parameters';
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code || !state) {
      return NextResponse.redirect(new URL('/login?error=missing_params', baseUrl));
    }

    step = 'validating OAuth state';
    const cookieStore = await cookies();
    const storedState = cookieStore.get('google_user_oauth_state')?.value;
    const codeVerifier = cookieStore.get('google_user_oauth_code_verifier')?.value;

    if (!storedState || state !== storedState || !codeVerifier) {
      return NextResponse.redirect(new URL('/login?error=invalid_state', baseUrl));
    }

    cookieStore.delete('google_user_oauth_state');
    cookieStore.delete('google_user_oauth_code_verifier');

    const google = getGoogleClient();
    step = 'exchanging Google authorization code';
    const tokens = await google.validateAuthorizationCode(code, codeVerifier);
    step = 'reading Google profile';
    const googleUser = await getGoogleProfile(tokens);

    // Find existing user by OAuth provider+id
    step = 'finding user by Google OAuth id';
    let user = await supabaseDb.user.findFirst({
      where: { oauthProvider: 'google', oauthId: googleUser.id },
    });

    if (!user) {
      // Check if email is already registered (link accounts)
      step = 'finding user by Google email';
      const existing = await supabaseDb.user.findUnique({ where: { email: googleUser.email } });
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
    const sessionToken = await createSessionToken(user.id);
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions());

    const redirectTo = '/studies';
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
