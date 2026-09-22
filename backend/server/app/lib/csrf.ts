// CSRF guard for state-changing requests that a cross-site page can issue as a
// CORS "simple request" (no preflight): body-less POSTs and multipart/form-data
// uploads. The session cookie is SameSite=None in production — the API sits on a
// different host from the frontends — so the browser attaches it to those
// cross-site requests, making them forgeable without a check like this one.
//
// JSON endpoints are already covered implicitly: `application/json` forces a
// preflight, which the CORS allow-list in server.ts refuses. This helper covers
// the endpoints that never reach a preflight.
//
// Browsers always send Origin on a non-GET request (same-origin included), so
// requiring an allow-listed Origin — falling back to Referer for the few older
// clients that omit it — rejects cross-site callers while leaving the
// first-party frontends untouched.

import { NextResponse } from 'next/server';
import { getAllowedOrigins } from './oauthOrigin';

/** Origin of the request, from Origin or Referer. Null when neither is usable. */
function resolveRequestOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  // A sandboxed/opaque origin serialises as the literal "null" — never trust it.
  if (origin && origin !== 'null') {
    try {
      return new URL(origin).origin;
    } catch {
      return null;
    }
  }

  const referer = request.headers.get('referer') || request.headers.get('referrer');
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Returns a 403 NextResponse when a state-changing request does not come from an
 * allow-listed first-party origin, or null when it may proceed.
 *
 * Fails closed: a request with no Origin and no Referer is rejected, so this is
 * only safe to apply to browser-only endpoints (never to webhooks or
 * server-to-server callers, which send neither header).
 *
 * Call at the very top of the handler, before touching any state.
 */
export function assertTrustedOrigin(request: Request): NextResponse | null {
  const origin = resolveRequestOrigin(request);

  if (!origin || !getAllowedOrigins().includes(origin)) {
    console.warn(
      `[CSRF] rejected ${request.method} — origin not allowed: ${origin || '(none)'}`
    );
    return NextResponse.json({ error: 'Request origin not allowed' }, { status: 403 });
  }

  return null;
}
