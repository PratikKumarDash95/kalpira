// Multiple frontend origins (custom domain + Vercel alias, etc.) can all
// initiate OAuth login against this single backend. To send the browser back
// to whichever origin it actually came from (rather than one hardcoded
// NEXT_PUBLIC_BASE_URL), the initiation route captures the request's Referer
// origin, validates it against the same allow-list used for CORS, and stashes
// it in a short-lived cookie that the callback route reads back.

import { getAuthCookieDomain } from './cookieDomain';

const OAUTH_ORIGIN_COOKIE = 'oauth_return_origin';

// Origins this backend trusts unconditionally in a real deployment. Kept to the
// `*.kalpira.in` hostnames only, because those are DNS-controlled by the
// operator: they cannot be claimed by a third party, so trusting them cannot
// silently turn into a session-cookie-carrying cross-site origin (which is what
// `credentials: true` + a reclaimed host would give an attacker). The reclaimable
// `*.vercel.app` aliases are deliberately NOT here — see TRANSITIONAL_ORIGINS.
const PRODUCTION_BASELINE_ORIGINS = [
  'https://kalpira.in',
  'https://www.kalpira.in',
  // First-party subdomains (recommended production setup — share one cookie).
  'https://admin.kalpira.in',
  'https://interviewer.kalpira.in',
  'https://api.kalpira.in',
];

// Transitional Vercel aliases, used during the move to the `*.kalpira.in`
// subdomains. A deleted/renamed Vercel project frees its `<slug>.vercel.app`
// hostname for anyone to claim, so these are NOT hardcoded-trusted forever: in
// production they are honored only when (a) the operator listed them in
// CORS_ORIGIN, or (b) CORS_ORIGIN is unset entirely — the (b) case is the
// "misconfigured/empty env must not lock out the live app" scenario the
// baseline existed to protect against, so we keep the safety net exactly as long
// as it is not overriding a deliberate configuration. Drop them by setting
// CORS_ORIGIN to the `*.kalpira.in` origins once the custom domains are live.
const TRANSITIONAL_ORIGINS = [
  'https://kalpira.vercel.app',
  'https://kalpira-admin.vercel.app',
  'https://kalpira-interviewer.vercel.app',
];

// Dev-only origins. Never merged into the list once this is a real deployment
// — a production server has no reason to accept a browser calling it from
// `localhost:*`, and leaving the door open means any local app that happens to
// run on a developer's own machine (or on a shared/jump host) is treated as
// first-party here.
const DEV_ONLY_ORIGINS = [
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

  if (process.env.NODE_ENV === 'production') {
    // In production, fall back to the transitional aliases ONLY when CORS_ORIGIN
    // is empty — an unset env must not lock out whoever is still on the Vercel
    // URLs, but a *configured* env is the operator's explicit decision and we
    // honor exactly what it says (no silent, permanent Vercel trust).
    const baseline = fromEnv.length
      ? PRODUCTION_BASELINE_ORIGINS
      : [...PRODUCTION_BASELINE_ORIGINS, ...TRANSITIONAL_ORIGINS];
    return Array.from(new Set([...baseline, ...fromEnv]));
  }

  // Non-production (local dev / staging): trust the full set so every frontend
  // variant works out of the box.
  return Array.from(new Set([
    ...PRODUCTION_BASELINE_ORIGINS,
    ...TRANSITIONAL_ORIGINS,
    ...DEV_ONLY_ORIGINS,
    ...fromEnv,
  ]));
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

// Shared options for ALL short-lived OAuth cookies (state, code_verifier,
// return_origin). These must carry the same COOKIE_DOMAIN as the session
// cookie (see auth.ts getSessionCookieOptions) — otherwise a login started on
// the apex domain (kalpira.in) sets a host-only cookie that never reaches the
// callback if it lands on a sibling host (e.g. www.kalpira.in), causing a
// false "state mismatch" -> /login?error=invalid_state ("Session expired").
export function getOauthStateCookieOptions() {
  const domain = getAuthCookieDomain();
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 600,
    path: '/',
    ...(domain ? { domain } : {}),
  };
}

export function getOauthOriginCookieOptions() {
  return getOauthStateCookieOptions();
}

// A cookie set with a Domain attribute can only be cleared by a Set-Cookie
// that repeats the SAME domain/path (RFC 6265) — deleting by name alone
// leaves it alive until it expires on its own. Match auth.ts's
// clearSessionCookie pattern: call cookieStore.set(name, '', { ...this, maxAge: 0 })
// wherever a callback route clears one of the short-lived OAuth cookies above.
export function getOauthCookieClearOptions() {
  const domain = getAuthCookieDomain();
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 0,
    expires: new Date(0),
    path: '/',
    ...(domain ? { domain } : {}),
  };
}

export { OAUTH_ORIGIN_COOKIE };
