// ============================================
// Simple In-Memory Rate Limiter
// ============================================
// Token-bucket style limiter per IP. No external deps.
// For production, replace with `express-rate-limit` + Redis store.

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 30;

function createRateLimiter({ windowMs = DEFAULT_WINDOW_MS, max = DEFAULT_MAX_REQUESTS, keyFn } = {}) {
  const buckets = new Map();

  // Periodic cleanup so old entries don't grow unbounded
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.windowStart > windowMs * 2) buckets.delete(key);
    }
  }, windowMs).unref?.();

  return function rateLimit(req, res, next) {
    const key = keyFn ? keyFn(req) : (req.ip || req.connection?.remoteAddress || 'unknown');
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || now - bucket.windowStart > windowMs) {
      bucket = { count: 0, windowStart: now };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.windowStart + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Please slow down.',
        code: 'RATE_LIMITED',
        retryAfter,
      });
    }

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    next();
  };
}

module.exports = { createRateLimiter };
