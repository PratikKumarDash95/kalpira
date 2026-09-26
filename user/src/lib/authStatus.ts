// Cached, de-duplicated session check.
//
// Every protected page used to call /api/auth on mount (see useRequireAuth).
// That is a real server round trip — the app is a static bundle and the API is
// proxied to a separate backend — so moving between Dashboard → Studies →
// Settings cost a fresh auth request each time, and nothing on the page could
// render until it came back. The session is an httpOnly cookie that only changes
// on login/logout, so the answer is safe to reuse for a short window.

import { apiFetch } from './apiClient';
import { PROFILE_QUERY_KEY } from './profileQuery';
import { invalidateQuery } from './queryCache';

export interface AuthStatus {
  authenticated: boolean;
  researcherId?: string;
}

// Deliberately short: it bounds how long a signed-in-looking shell can outlive a
// session that ended elsewhere (another tab, an expiry). Data requests are still
// authorized server-side, so the worst case is one stale skeleton before the
// 401 redirects.
const TTL_MS = 30_000;

let cached: { at: number; value: AuthStatus } | null = null;
let inFlight: Promise<AuthStatus> | null = null;

/**
 * Resolve the current session, reusing a recent answer and sharing an in-flight
 * request between callers. Never rejects — an unreachable API resolves to
 * `{ authenticated: false }`, matching the previous behaviour.
 */
export function getAuthStatus(): Promise<AuthStatus> {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return Promise.resolve(cached.value);
  }
  if (inFlight) return inFlight;

  inFlight = apiFetch('/api/auth')
    .then((res) => res.json() as Promise<AuthStatus>)
    .then((value) => {
      // Only a signed-in answer is cached. A "guest" result must not be reused:
      // it would keep a user who just signed in in another tab stuck on /login.
      if (value?.authenticated) {
        cached = { at: Date.now(), value };
      }
      return value;
    })
    .catch(() => ({ authenticated: false }) as AuthStatus)
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * The cached answer, read synchronously, or `null` if there isn't a usable one.
 *
 * This lets a guard render a signed-in page on its *first* frame instead of
 * showing a skeleton for the one microtask it takes the cached promise to
 * resolve. Only a signed-in answer is ever cached, so a non-null result always
 * means "authenticated" — there is no way to read a stale "guest" from here.
 *
 * Still not an authorization decision: the cached answer is at most TTL_MS old
 * and every data request is authorized server-side regardless.
 */
export function peekAuthStatus(): AuthStatus | null {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  return null;
}

/**
 * Drop the cached answer. Call on login and logout so the next page render
 * reflects the new session instead of the previous one. Also drops the cached
 * profile, which is the same session described differently.
 */
export function invalidateAuthStatus(): void {
  cached = null;
  inFlight = null;
  invalidateQuery(PROFILE_QUERY_KEY);
}
