// Multiple frontend origins (custom domain + Vercel alias, etc.) can all
// initiate OAuth login against this single backend. To send the browser back
// to whichever origin it actually came from (rather than one hardcoded
// NEXT_PUBLIC_BASE_URL), the initiation route captures the request's Referer
// origin, validates it against the same allow-list used for CORS, and stashes
// it in a short-lived cookie that the callback route reads back.

const OAUTH_ORIGIN_COOKIE = 'oauth_return_origin';

// Known production frontends. These are ALWAYS allowed regardless of the
// CORS_ORIGIN env var, so a stale/misconfigured deploy env can't lock out the
// live apps or break the post-login redirect back to the custom domain.
const BASELINE_ORIGINS = [
  'https://kalpira.in',
  'https://www.kalpira.in',
  // First-party subdomains (recommended production setup — share one cookie).
  'https://admin.kalpira.in',
  'https://interviewer.kalpira.in',
  'https://api.kalpira.in',
  // Legacy Vercel aliases (kept so nothing breaks during the migration).
  'https://kalpira.vercel.app',
  'https://kalpira-admin.vercel.app',
  'https://kalpira-interviewer.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
];

/** Merged allow-list: baseline production origins + any from CORS_ORIGIN env. */
export function getAllowedOrigins(): string[] {
  const fromEnv = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return Array.from(new Set([...BASELINE_ORIGINS, ...fromEnv]));
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
