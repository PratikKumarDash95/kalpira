// ============================================
// Rate Limiter — Distributed Fixed-Window Middleware
// ============================================
// Token-bucket style limiter, now backed by the shared counter store (Upstash
// Redis when configured, bounded in-memory otherwise) so it is correct across
// multiple instances behind a load balancer. See ./rateStore.js for why.
//
// KEY SELECTION — IP ONLY, and deliberately so
// This middleware runs BEFORE the session/JWT is verified, so it cannot trust
// any caller-supplied identity. Reading `x-user-id` or a raw cookie here would
// be a bypass: a guesser simply rotates that value per request and mints a fresh
// bucket every time, defeating the limiter outright. The unauthenticated,
// unforgeable dimension available at this point is the source address (resolved
// behind Render's proxy via `trust proxy`), so that is what we key on.
//
// The per-ACCOUNT budget — the one that survives a distributed guesser spread
// across many addresses — lives in app/lib/throttle.ts, where the key is the
// *validated* target email, not a header a caller chooses. The two dimensions
// are complementary; neither belongs here pre-auth.
//
// A NAT/carrier collapse (thousands of users behind one address) is a real
// concern for the pure per-IP model, but fixing it correctly means throttling on
// verified identity AFTER auth, at the route — not loosening trust here. A
// server-supplied `keyFn` is accepted for that future use; it must never read
// attacker-controlled input.

const { incr } = require('./rateStore');

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 30;

function createRateLimiter({ windowMs = DEFAULT_WINDOW_MS, max = DEFAULT_MAX_REQUESTS, keyFn, prefix = 'ip' } = {}) {
  return async function rateLimit(req, res, next) {
    try {
      // IP is the only key this pre-auth layer may trust. `keyFn`, when passed,
      // must itself derive from server-verified state (never a raw header).
      const ip = req.ip || req.connection?.remoteAddress || 'unknown';
      const bucketKey = keyFn ? keyFn(req) : `ip:${ip}`;

      const count = await incr(prefix, bucketKey, windowMs);
      const limit = max;
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
