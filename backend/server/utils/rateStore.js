// ============================================
// Shared Distributed Counter Store
// ============================================
//
// WHY THIS EXISTS
// The whole platform used to keep rate-limit buckets and per-account auth
// budgets in a `new Map()` inside one Node process. That is fine for a single
// box and fatal the moment you add a second one behind a load balancer: every
// instance would hold its own counters, so a caller's "30 requests / minute"
// becomes "30 per instance x N instances" and the per-account lockout a
// guesser walks straight through. This module is the one shared answer both the
// Express limiter and the auth throttle read from, so the counters survive
// scale-out.
//
// TRANSPORT: Upstash Redis over HTTP REST, NOT a TCP client
// The backend runs on Render. Upstash's REST API means we need zero new
// dependencies (just global `fetch`) and no long-lived socket — the two things
// that make a connection-based Redis awkward on a request-scoped host. When
// UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set we go distributed;
// otherwise we fall back to a bounded in-memory map so local dev and a
// deliberate single-instance deployment keep working with no config.
//
// WINDOW MODEL: keys are window-scoped (`rl:<key>:<windowIndex>`). An increment
// therefore never needs a read-modify-write, and a missed EXPIRE only leaves a
// soon-abandoned key rather than an off-by-one that outlives the window. We set
// a short expiry anyway so idle keys are reclaimed.
//
// FAILURE MODE: fail-open. If Redis is unreachable we degrade to the in-memory
// counters for that call rather than throwing a 500 into a live interview. A
// rate limiter that takes the platform down is worse than one that briefly
// under-counts.

const WINDOW_MS_DEFAULT = 60_000;

// Hard ceiling on tracked in-memory keys, so an attacker minting addresses
// cannot grow the fallback map without bound. Past this the oldest key goes.
const MAX_LOCAL_KEYS = 50_000;

const redisUrl = process.env.UPSTASH_REDIS_REST_URL || null;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || null;
const DISTRIBUTED = Boolean(redisUrl && redisToken);

// Bound every Redis round trip so a slow/hung Upstash cannot pin a request open.
const REDIS_TIMEOUT_MS = 700;

// In-memory fallback store: key -> { count, expiresAt }.
const local = new Map();
let localInserts = 0;

function sweepLocal(now) {
  for (const [key, entry] of local) {
    if (entry.expiresAt <= now) local.delete(key);
  }
}

function localIncr(key, ttlMs, now) {
  // Amortised cleanup so the map cannot grow without bound.
  if (++localInserts % 512 === 0) sweepLocal(now);
  while (local.size >= MAX_LOCAL_KEYS) {
    const oldest = local.keys().next();
    if (oldest.done) break;
    local.delete(oldest.value);
  }
  const entry = local.get(key);
  if (!entry || entry.expiresAt <= now) {
    const created = { count: 1, expiresAt: now + ttlMs };
    local.set(key, created);
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

function localPeek(key, now) {
  const entry = local.get(key);
  if (!entry || entry.expiresAt <= now) return 0;
  return entry.count;
}

function localDel(key) {
  local.delete(key);
}

// Send one command or a pipeline (array of arrays) to Upstash REST.
async function redisCommand(command) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REDIS_TIMEOUT_MS);
  try {
    const res = await fetch(redisUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redisToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Build a window-scoped key. The window index advances every `windowMs`, so a
// `peek` then `incr` inside one window both touch the same key.
function windowKey(prefix, key, windowMs) {
  const windowIndex = Math.floor(Date.now() / windowMs);
  return `rl:${prefix}:${key}:${windowIndex}`;
}

/**
 * Atomically increment this window's counter and return the new total.
 * On any Redis failure we fall back to the in-memory counter (fail-open).
 */
async function incr(prefix, key, windowMs = WINDOW_MS_DEFAULT) {
  const fullKey = windowKey(prefix, key, windowMs);
  const now = Date.now();
  if (!DISTRIBUTED) return localIncr(fullKey, windowMs * 2, now);
  try {
    const ttlSec = Math.ceil((windowMs * 2) / 1000);
    const json = await redisCommand([
      ['INCR', fullKey],
      ['EXPIRE', fullKey, String(ttlSec)],
    ]);
    const first = json && json.results ? json.results[0] : json;
    const count = Number(first && first.result);
    if (!Number.isFinite(count)) throw new Error('bad INCR reply');
    return count;
  } catch (err) {
    console.warn('[rateStore] Redis INCR failed, using local fallback:', err.message);
    return localIncr(fullKey, windowMs * 2, now);
  }
}

/**
 * Read this window's counter WITHOUT spending from it. Pairs with `incr` to
 * preserve the check-then-penalise split the auth throttle depends on.
 */
async function peek(prefix, key, windowMs = WINDOW_MS_DEFAULT) {
  const fullKey = windowKey(prefix, key, windowMs);
  const now = Date.now();
  if (!DISTRIBUTED) return localPeek(fullKey, now);
  try {
    const json = await redisCommand(['GET', fullKey]);
    const raw = json && 'result' in json ? json.result : undefined;
    const count = Number(raw);
    return Number.isFinite(count) ? count : 0;
  } catch (err) {
    console.warn('[rateStore] Redis GET failed, using local fallback:', err.message);
    return localPeek(fullKey, now);
  }
}

/** Drop this account/window's counter (e.g. after a successful sign-in). */
async function del(prefix, key, windowMs = WINDOW_MS_DEFAULT) {
  const fullKey = windowKey(prefix, key, windowMs);
  if (!DISTRIBUTED) return localDel(fullKey);
  try {
    await redisCommand(['DEL', fullKey]);
  } catch (err) {
    console.warn('[rateStore] Redis DEL failed:', err.message);
  }
  // Also clear the local mirror so a subsequent fallback read is not stale.
  localDel(fullKey);
}

// ============================================
// Generic short-lived KV (shared read cache)
// ============================================
// The counter primitives above are window-scoped integers. This is the same
// transport reused for caching small JSON reads (a study's config, a hot
// lookup) across instances so every box stops re-fetching identical rows from
// PostgREST on every request. Same fail-open posture: a Redis miss/error just
// reads through to the source.

// Separate namespace + its own local mirror, so cache entries never collide
// with counter keys and are not swept by the counter cleanup.
const cacheLocal = new Map(); // key -> { value, expiresAt }

async function kvGet(namespace, key) {
  const fullKey = `cv:${namespace}:${key}`;
  const now = Date.now();
  if (!DISTRIBUTED) {
    const entry = cacheLocal.get(fullKey);
    if (!entry || entry.expiresAt <= now) {
      if (entry) cacheLocal.delete(fullKey);
      return null;
    }
    return entry.value;
  }
  try {
    const json = await redisCommand(['GET', fullKey]);
    const raw = json && 'result' in json ? json.result : undefined;
    return raw == null ? null : JSON.parse(raw);
  } catch (err) {
    console.warn('[rateStore] Redis cache GET failed, reading through:', err.message);
    return null;
  }
}

async function kvSet(namespace, key, value, ttlMs) {
  const fullKey = `cv:${namespace}:${key}`;
  const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
  if (!DISTRIBUTED) {
    while (cacheLocal.size >= MAX_LOCAL_KEYS) {
      const oldest = cacheLocal.keys().next();
      if (oldest.done) break;
      cacheLocal.delete(oldest.value);
    }
    cacheLocal.set(fullKey, { value, expiresAt: Date.now() + ttlMs });
    return;
  }
  try {
    await redisCommand(['SET', fullKey, JSON.stringify(value), 'EX', String(ttlSec)]);
  } catch (err) {
    console.warn('[rateStore] Redis cache SET failed (non-fatal):', err.message);
  }
}

async function kvDel(namespace, key) {
  const fullKey = `cv:${namespace}:${key}`;
  cacheLocal.delete(fullKey);
  if (!DISTRIBUTED) return;
  try {
    await redisCommand(['DEL', fullKey]);
  } catch (err) {
    console.warn('[rateStore] Redis cache DEL failed (non-fatal):', err.message);
  }
}

module.exports = {
  isDistributed: () => DISTRIBUTED,
  windowKey,
  incr,
  peek,
  del,
  kvGet,
  kvSet,
  kvDel,
};
