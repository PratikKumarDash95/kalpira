// Multiple frontend origins (custom domain + Vercel alias, etc.) can all
// initiate OAuth login against this single backend. To send the browser back
// to whichever origin it actually came from (rather than one hardcoded
// NEXT_PUBLIC_BASE_URL), the initiation route captures the request's Referer
// origin, validates it against the same allow-list used for CORS, and stashes
// it in a short-lived cookie that the callback route reads back.

const OAUTH_ORIGIN_COOKIE = 'oauth_return_origin';

function getAllowedOrigins(): string[] {
  return (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/** Fallback origin when no valid Referer is available (e.g. direct API hit). */
export function getDefaultFrontendOrigin(): string {
  return process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
}

/**
 * Resolve the frontend origin that should receive the post-login redirect,
 * from the initiating request's Referer header. Returns null if the Referer
 * is missing or not in the CORS allow-list (caller should fall back to
 * getDefaultFrontendOrigin()).
 */
export function resolveReturnOrigin(request: Request): string | null {
  const referer = request.headers.get('referer') || request.headers.get('referrer');
  if (!referer) return null;

  let origin: string;
  try {
    origin = new URL(referer).origin;
  } catch {
    return null;
  }

  const allowed = getAllowedOrigins();
  return allowed.includes(origin) ? origin : null;
}

export function getOauthOriginCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 600,
    path: '/',
  };
}

export { OAUTH_ORIGIN_COOKIE };
