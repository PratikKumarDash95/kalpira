// ============================================
// readCache.ts — thin typed wrapper over the shared KV store
// ============================================
//
// Server-side read caching. Until now the only cache in the system was
// client-side (user/src/lib/queryCache.ts), so every one of 10k concurrent
// candidates hitting a page re-read the same immutable-ish rows from PostgREST
// on every request. This caches small, hot, rarely-changing reads (a study's
// config JSON, resolved identity) behind the same Upstash-backed store the rate
// limiter uses, so the win holds across instances, not just within one box.
//
// DELIBERATELY NARROW
//   - Short TTLs only. This is not a source of truth; a stale read is bounded
//     by the TTL and callers still write through to the DB.
//   - Never cache anything that varies per-caller (a signed participant link,
//     an ownership check). Cache the *shared* row, decide authorization fresh.
//   - Fail-open: a store error reads through to the loader, exactly like the
//     limiter. A cache outage must not become an availability outage.

// The store is CommonJS; require it directly (runs under tsx / CJS output).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const store = require('../../utils/rateStore');

/** Default TTL for shared config-style reads. Short enough to stay honest. */
export const DEFAULT_CACHE_TTL_MS = 30_000;

export interface CacheOptions {
  ttlMs?: number;
}

/**
 * Read `key` under `namespace`, falling back to `loader` on a miss and then
 * caching whatever the loader returned. `loader` may return `null` (a genuine
 * "not found"); that is cached too, so a stampede on a missing row does not
 * hammer the source — the null is what the next reader gets until it appears.
 */
export async function cachedRead<T>(
  namespace: string,
  key: string,
  loader: () => Promise<T | null>,
  { ttlMs = DEFAULT_CACHE_TTL_MS }: CacheOptions = {},
): Promise<T | null> {
  const hit = await store.kvGet(namespace, key);
  if (hit !== null && hit !== undefined) return hit as T;

  const value = await loader();
  await store.kvSet(namespace, key, value ?? null, ttlMs);
  return value;
}

/**
 * Drop a cached read after a write makes it stale (a study was edited). Best
 * effort — a failed invalidation is bounded by the TTL regardless.
 */
export async function invalidateCache(namespace: string, key: string): Promise<void> {
  await store.kvDel(namespace, key);
}
