// GET /api/auth/oauth/google/interviewer/callback - Handle Google OAuth callback for interviewer accounts
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

  return new arctic.Google(clientId, clientSecret, `${baseUrl}/api/auth/oauth/google/interviewer/callback`);
}

function getBaseUrl(): string {
  return process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
}

function getInterviewerLoginUrl(baseUrl: string, error: string) {
  const url = new URL('/login', baseUrl);
  url.searchParams.set('role', 'interviewer');
  url.searchParams.set('error', error);
  return url;
}

export async function GET(request: Request) {
  const baseUrl = getBaseUrl();

  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code || !state) {
      return NextResponse.redirect(getInterviewerLoginUrl(baseUrl, 'missing_params'));
    }

    const cookieStore = await cookies();
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
      // Email is unique across all roles, so link/promote an existing account
      // instead of inserting a duplicate row.
      const existing = await supabaseDb.user.findUnique({
        where: { email: googleUser.email },
      });

      if (existing) {
        user = await supabaseDb.user.update({
          where: { id: existing.id },
          data: {
            oauthProvider: 'google',
            oauthId: googleUser.id,
            avatarUrl: existing.avatarUrl || googleUser.picture,
            role: 'interviewer',
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
            onboardingComplete: false,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
    }

    const sessionToken = await createSessionToken(user.id);
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions());

    return NextResponse.redirect(new URL('/interviewer/dashboard', baseUrl));
  } catch (error) {
    console.error('Google interviewer OAuth callback error:', error);
    return NextResponse.redirect(getInterviewerLoginUrl(baseUrl, 'oauth_failed'));
  }
}
