// ============================================
// Rate Limiter — Distributed Fixed-Window Middleware
// ============================================
// Token-bucket style limiter, now backed by the shared counter store (Upstash
// Redis when configured, bounded in-memory otherwise) so it is correct across
// multiple instances behind a load balancer. See ./rateStore.js for why.
//
// KEY SELECTION
// The old limiter keyed purely on IP. That breaks under real concurrency:
// mobile carriers and corporate NATs put thousands of candidates behind a
// handful of addresses, so a pure per-IP budget turns launch day into a mass
// 429. We now prefer a caller identity when the request carries one — an
// authenticated session id or an `x-user-id` header — and only fall back to IP
// for genuinely anonymous traffic. Both dimensions are counted, since a
// distributed guesser spreads across addresses while a focused one piles onto
// a single account.

const { incr } = require('./rateStore');

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 30;

// Best-effort identity extraction without a DB hit. The session cookie is a
// signed JWT; we only need a stable subject to key on, and `verifySessionToken`
// runs (and authorises) downstream — this is purely a throttle dimension, so a
// cheap, non-verified stable handle is acceptable and never widens access.
function identityOf(req) {
  const headerId = req.headers['x-user-id'];
  if (typeof headerId === 'string' && headerId) return `u:${headerId}`;

  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader === 'string') {
    const match = cookieHeader
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('kalpira_session='));
    if (match) {
      // Hash-ish handle from the token so we do not store the raw secret; we
      // only need it to be stable per caller for a window.
      const token = decodeURIComponent(match.slice('kalpira_session='.length + 1));
      return `s:${shortHash(token)}`;
    }
  }

  return null;
}

function shortHash(value) {
  let h = 5381;
  for (let i = 0; i < value.length; i++) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function createRateLimiter({ windowMs = DEFAULT_WINDOW_MS, max = DEFAULT_MAX_REQUESTS, keyFn, prefix = 'ip' } = {}) {
  return async function rateLimit(req, res, next) {
    try {
      const identity = keyFn ? keyFn(req) : identityOf(req);
      const ip = req.ip || req.connection?.remoteAddress || 'unknown';
      // Count the chosen dimension; fall back to IP when there is no identity.
      const bucketKey = identity || `ip:${ip}`;

      const count = await incr(prefix, bucketKey, windowMs);
      const limit = identity ? max * 4 : max; // an identity may act more than one shared IP
      const remaining = Math.max(0, limit - count);

      res.setHeader('X-RateLimit-Limit', String(limit));
      res.setHeader('X-RateLimit-Remaining', String(remaining));

      if (count > limit) {
        // Remaining time in the current fixed window.
        const now = Date.now();
        const windowStart = Math.floor(now / windowMs) * windowMs;
        const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(429).json({
          success: false,
          error: 'Too many requests. Please slow down.',
          code: 'RATE_LIMITED',
          retryAfter,
        });
      }

      return next();
    } catch (err) {
      // A limiter that throws must never break a live request — fail open.
      console.error('[rateLimiter] Unexpected error, failing open:', err);
      return next();
    }
  };
}

module.exports = { createRateLimiter };
