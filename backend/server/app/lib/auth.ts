// Session token utilities for researcher authentication
// Uses signed JWTs to prevent forgery
// Supports both standalone (password) and hosted (OAuth with researcherId) modes

import * as jose from 'jose';
import { isHostedMode } from './mode';

const SESSION_COOKIE_NAME = 'research-auth';

// Participant *link* token lifetime (used by /api/generate-link). This is a
// separate short-lived token embedded in shareable interview URLs — NOT a
// signed-in user session — so it keeps its own 2-day expiry.
const TOKEN_DURATION_DAYS = 2;
const TOKEN_DURATION_SECONDS = 60 * 60 * 24 * TOKEN_DURATION_DAYS;

// ── User session lifetime policy ──────────────────────────────────────────────
// Every signed-in user session (candidate / interviewer / admin, all roles)
// enforces TWO independent limits:
//   • ABSOLUTE cap (5 days): the session cannot outlive 5 days from login no
//     matter how active the user is — after that they must sign in again. This
//     is anchored by the `absoluteExp` claim, fixed at login and preserved
//     across refreshes.
//   • IDLE window (2 days): 2 days with no request auto-expires the session.
//     Each authenticated request slides this window forward (see
//     refreshSessionToken), capped by the absolute limit.
const DAY_SECONDS = 60 * 60 * 24;
const ABSOLUTE_SESSION_SECONDS = 5 * DAY_SECONDS;
const IDLE_SESSION_SECONDS = 2 * DAY_SECONDS;

// Cookie lifetime for a freshly issued / refreshed session equals the idle
// window, so the browser also drops the cookie after 2 days of inactivity.
// Role no longer affects lifetime (unified policy); the param is kept so the
// existing call sites don't need to change.
export function getSessionSecondsForRole(_role?: string): number {
  return IDLE_SESSION_SECONDS;
}

// Get the signing secret from environment
// Uses SESSION_SECRET if available, falls back to ADMIN_PASSWORD
function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) {
    throw new Error('SESSION_SECRET or ADMIN_PASSWORD environment variable is required');
  }

  // Warn if using ADMIN_PASSWORD as session secret (less secure)
  if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
    console.warn(
      '[Security] SESSION_SECRET not set - falling back to ADMIN_PASSWORD. ' +
      'For better security, set a dedicated SESSION_SECRET environment variable.'
    );
  }

  return new TextEncoder().encode(secret);
}

// Create a signed session token
// In hosted mode, embeds researcherId for multi-tenant context resolution.
// Lifetime is uniform across roles now (2-day idle / 5-day absolute); the role
// is still stored as a claim so callers can read it without a DB round-trip.
export async function createSessionToken(researcherId?: string, role?: string): Promise<string> {
  const secret = getSecret();
  const nowSec = Math.floor(Date.now() / 1000);

  // Fixed at login and carried across every refresh so the 5-day hard cap
  // survives sliding-window extensions.
  const absoluteExp = nowSec + ABSOLUTE_SESSION_SECONDS;

  const payload: Record<string, unknown> = { type: 'session', absoluteExp };

  // Always include researcherId if provided (needed for both hosted mode and Interviewer role)
  if (researcherId) {
    payload.researcherId = researcherId;
  }

  if (role) {
    payload.role = role;
  }

  if (isHostedMode()) {
    payload.mode = 'hosted';
  }

  // Live expiry = idle window, but never beyond the absolute cap.
  const exp = Math.min(nowSec + IDLE_SESSION_SECONDS, absoluteExp);

  const token = await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(nowSec)
    .setExpirationTime(exp)
    .sign(secret);

  return token;
}

// Re-issue a session token with the 2-day idle window slid forward, preserving
// the original absolute expiry. Returns null when the 5-day absolute cap has
// been reached — the caller should then NOT refresh, letting the current token
// lapse so the user is forced to sign in again.
export async function refreshSessionToken(
  session: { researcherId?: string; role?: string; absoluteExp?: number },
): Promise<string | null> {
  const { researcherId, role, absoluteExp } = session;
  // Legacy tokens issued before this policy have no absolute anchor — don't
  // refresh them; they expire on their own and re-issue fresh on next login.
  if (!absoluteExp) return null;

  const secret = getSecret();
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec >= absoluteExp) return null; // hard cap hit

  const payload: Record<string, unknown> = { type: 'session', absoluteExp };
  if (researcherId) payload.researcherId = researcherId;
  if (role) payload.role = role;
  if (isHostedMode()) payload.mode = 'hosted';

  const exp = Math.min(nowSec + IDLE_SESSION_SECONDS, absoluteExp);

  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(nowSec)
    .setExpirationTime(exp)
    .sign(secret);
}

// Session verification result
export interface SessionVerifyResult {
  valid: boolean;
  researcherId?: string; // Present in hosted mode
  role?: string; // Present when the token was issued with a role
  absoluteExp?: number; // Unix seconds — fixed 5-day hard cap (for sliding refresh)
  issuedAt?: number; // Unix seconds — when this token was signed (refresh throttling)
}

// Verify a session token
// Returns validity and researcherId (hosted mode only)
export async function verifySessionToken(token: string): Promise<SessionVerifyResult> {
  if (!token) {
    return { valid: false };
  }

  try {
    const secret = getSecret();
    const { payload } = await jose.jwtVerify(token, secret);

    // Check that it's a session token (not a participant token)
    if (payload.type !== 'session') {
      return { valid: false };
    }

    // Always extract researcherId if present (for Interviewer role in standalone mode)
    const researcherId = payload.researcherId as string | undefined;
    const role = payload.role as string | undefined;
    const absoluteExp = payload.absoluteExp as number | undefined;
    const issuedAt = payload.iat as number | undefined;

    // Belt-and-suspenders: reject anything past the absolute 5-day cap even if a
    // future bug ever issued an `exp` beyond it.
    if (absoluteExp && Math.floor(Date.now() / 1000) >= absoluteExp) {
      return { valid: false };
    }

    // In hosted mode, researcherId is mandatory
    if (isHostedMode()) {
      if (!researcherId) {
        return { valid: false };
      }
      return { valid: true, researcherId, role, absoluteExp, issuedAt };
    }

    return { valid: true, researcherId, role, absoluteExp, issuedAt };
  } catch {
    // Token invalid, expired, or tampered with
    return { valid: false };
  }
}

// True when this backend is deployed on a host separate from the frontends
// (Render/Vercel/etc.), i.e. cookies ride cross-site fetch() calls and must be
// SameSite=None; Secure. Detect this from MULTIPLE signals, not just NODE_ENV —
// relying on NODE_ENV=production alone is fragile because hosts don't always
// set it, and a missing value silently downgrades the cookie to SameSite=Lax,
// which browsers refuse to send cross-site (the session then never sticks).
export function isCrossSiteDeployment(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    // Render sets these on every service.
    !!process.env.RENDER ||
    !!process.env.RENDER_EXTERNAL_URL ||
    // Explicit opt-in / opt-out escape hatch.
    process.env.CROSS_SITE_COOKIES === 'true'
  );
}

// Cookie configuration for session token
//
// PREFERRED SETUP: serve the backend from a subdomain of the frontend's
// registrable domain (e.g. api.kalpira.in for www.kalpira.in) and set
// COOKIE_DOMAIN=.kalpira.in. The cookie is then FIRST-PARTY and shared across
// all subdomains, so browsers that block third-party cookies still send it.
//
// FALLBACK: if the backend lives on an unrelated domain (onrender.com) the
// cookie is cross-site and must be SameSite=None; Secure — but note browsers
// increasingly BLOCK such third-party cookies entirely, so the subdomain setup
// above is strongly recommended. Locally everything is same-site localhost, so
// Lax (without Secure, since local dev is plain http) is kept as the default.
export function getSessionCookieOptions(maxAgeSeconds: number = TOKEN_DURATION_SECONDS) {
  const crossSite = isCrossSiteDeployment();
  // Optional: scope the cookie to a shared parent domain (leading dot), e.g.
  // ".kalpira.in", so api.kalpira.in and www.kalpira.in share one first-party
  // session cookie. Leave unset for same-origin / onrender.com deployments.
  const domain = process.env.COOKIE_DOMAIN?.trim() || undefined;
  return {
    httpOnly: true,
    secure: crossSite,
    sameSite: crossSite ? ('none' as const) : ('lax' as const),
    maxAge: maxAgeSeconds,
    path: '/',
    ...(domain ? { domain } : {}),
  };
}

// Clear the session cookie. A cookie set with Domain=<COOKIE_DOMAIN>/Path=/ can
// ONLY be removed by a Set-Cookie that repeats the SAME domain/path (and, for
// cross-site cookies, SameSite=None; Secure). Deleting by name alone leaves the
// domain-scoped cookie alive — so logout must use these matching attributes.
export function clearSessionCookie(cookieStore: {
  set: (name: string, value: string, options: Record<string, unknown>) => void;
}): void {
  const crossSite = isCrossSiteDeployment();
  const domain = process.env.COOKIE_DOMAIN?.trim() || undefined;
  cookieStore.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: crossSite,
    sameSite: crossSite ? ('none' as const) : ('lax' as const),
    maxAge: 0,
    expires: new Date(0),
    path: '/',
    ...(domain ? { domain } : {}),
  });
}

export {
  SESSION_COOKIE_NAME,
  TOKEN_DURATION_DAYS,
  TOKEN_DURATION_SECONDS,
  ABSOLUTE_SESSION_SECONDS,
  IDLE_SESSION_SECONDS,
};

// === Participant Token Verification ===

// Get participant token secret (separate from session secret)
function getParticipantSecret(): Uint8Array | null {
  const secret = process.env.PARTICIPANT_TOKEN_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) return null;

  // Warn if using ADMIN_PASSWORD as participant token secret (less secure)
  if (!process.env.PARTICIPANT_TOKEN_SECRET && process.env.NODE_ENV === 'production') {
    console.warn(
      '[Security] PARTICIPANT_TOKEN_SECRET not set - falling back to ADMIN_PASSWORD. ' +
      'For better security, set a dedicated PARTICIPANT_TOKEN_SECRET environment variable.'
    );
  }

  return new TextEncoder().encode(secret);
}

// Parse cookies from request headers
function getCookieValue(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.split('=');
    if (key === name) {
      return valueParts.join('=');
    }
  }
  return null;
}

// Check if request has valid admin session cookie
async function hasValidAdminSession(request: Request): Promise<boolean> {
  const sessionToken = getCookieValue(request, SESSION_COOKIE_NAME);
  if (!sessionToken) return false;
  const result = await verifySessionToken(sessionToken);
  return result.valid;
}

// Participant token verification result
export interface ParticipantVerifyResult {
  valid: boolean;
  studyId?: string;
  researcherId?: string; // Present in hosted mode tokens
  isAdmin?: boolean;
  error?: string;
}

// Verify participant token from Authorization header
// Also accepts valid admin session cookies (for researcher preview)
// Returns studyId if from participant token, undefined if from admin session
// Checks if links are enabled for the study (unless admin)
export async function verifyParticipantToken(request: Request): Promise<ParticipantVerifyResult> {
  // First, check for participant token in Authorization header
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (token) {
    const secret = getParticipantSecret();
    if (secret) {
      try {
        const { payload } = await jose.jwtVerify(token, secret);

        // Reject session tokens used as participant tokens (token-type confusion)
        if (payload.type === 'session') {
          // Fall through to admin session check
        } else {
          const studyId = payload.studyId as string;
          const researcherId = payload.researcherId as string | undefined;

          // Note: "links disabled" check moved to getParticipantRequestContext()
          // where the correct per-researcher KV client is available

          return { valid: true, studyId, researcherId };
        }
      } catch (error) {
        // Check if it's an expiration error
        if (error instanceof jose.errors.JWTExpired) {
          return { valid: false, error: 'This link has expired. Please request a new participant link from the researcher.' };
        }
        // Token invalid, fall through to check admin session
      }
    }
  }

  // No valid participant token - check for admin session (researcher preview)
  const isAdmin = await hasValidAdminSession(request);
  if (isAdmin) {
    return { valid: true, isAdmin: true };
  }

  return { valid: false };
}

// === Password Hashing Utilities ===
import { pbkdf2, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const pbkdf2Async = promisify(pbkdf2);
const PASSWORD_HASH_ALGORITHM = 'pbkdf2_sha512';
const PASSWORD_HASH_ITERATIONS = 310000;
const PASSWORD_HASH_BYTES = 64;

/**
 * Hash a password using a versioned PBKDF2 format.
 * Returns format: "pbkdf2_sha512$iterations$salt$hash"
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await pbkdf2Async(password, salt, PASSWORD_HASH_ITERATIONS, PASSWORD_HASH_BYTES, 'sha512');
  return `${PASSWORD_HASH_ALGORITHM}$${PASSWORD_HASH_ITERATIONS}$${salt}$${derivedKey.toString('hex')}`;
}

/**
 * Verify a password against a stored hash
 * Supports both the current versioned format and the legacy "salt:hash" format.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const versionedParts = storedHash.split('$');
  if (versionedParts.length === 4) {
    const [algorithm, iterationText, salt, key] = versionedParts;
    const iterations = Number(iterationText);

    if (
      algorithm !== PASSWORD_HASH_ALGORITHM ||
      !salt ||
      !key ||
      !Number.isInteger(iterations) ||
      iterations <= 0
    ) {
      return false;
    }

    const derivedKey = await pbkdf2Async(password, salt, iterations, PASSWORD_HASH_BYTES, 'sha512');
    const expected = Buffer.from(key, 'hex');
    const actual = Buffer.from(derivedKey.toString('hex'), 'hex');

    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;

  const derivedKey = await pbkdf2Async(password, salt, 1000, PASSWORD_HASH_BYTES, 'sha512');
  const expected = Buffer.from(key, 'hex');
  const actual = Buffer.from(derivedKey.toString('hex'), 'hex');

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
