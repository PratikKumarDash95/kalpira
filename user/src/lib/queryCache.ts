// Cached, de-duplicated GET requests — the client-side half of "navigation
// should not feel like a reload".
//
// Every page used to fetch its own data on mount and start from a `loading`
// skeleton, so returning to a page you had already seen re-showed the skeleton
// and then re-painted the same rows. This module keeps the last answer per key
// in memory and hands it back synchronously, so a revisited page renders its
// real content on the first frame and revalidates quietly behind it.
//
// Deliberately small and dependency-free. It is NOT a general data layer:
//   - GET-shaped reads only. Mutations do not go through here; they apply their
//     own result with `setQuery`, or call `revalidateQuery` to refetch behind
//     the view already on screen.
//   - In-memory only. A hard reload starts empty; that is what the page
//     skeletons and `loading.tsx` are for.
//   - Never read during SSR. The server snapshot is always "nothing cached"
//     (see useQuery), so the module map is only ever populated in the browser
//     and cannot leak one request's data into another's render.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export const DEFAULT_TTL_MS = 30_000;

interface Entry {
  data: unknown;
  at: number;
}

const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();
const listeners = new Map<string, Set<() => void>>();
// Bumped by invalidateQuery so a request that was already on the wire cannot
// repopulate the cache with an answer that predates the caller's mutation.
const generations = new Map<string, number>();

function notify(key: string): void {
  const set = listeners.get(key);
  if (!set) return;
  // Copy first: a listener may unsubscribe while we are iterating.
  for (const fn of Array.from(set)) fn();
}

function generation(key: string): number {
  return generations.get(key) ?? 0;
}

function matches(key: string, keyOrPrefix: string): boolean {
  return key === keyOrPrefix || key.startsWith(keyOrPrefix);
}

/**
 * Synchronous cache read. Returns `undefined` when nothing has been fetched for
 * `key` — which callers must treat as "not known yet", distinct from a fetch
 * that resolved to `null`.
 */
export function peekQuery<T>(key: string): T | undefined {
  return entries.get(key)?.data as T | undefined;
}

/** Age of the cached entry in ms, or `Infinity` when there is none. */
export function queryAge(key: string): number {
  const entry = entries.get(key);
  return entry ? Date.now() - entry.at : Infinity;
}

export function isQueryFresh(key: string, ttl: number = DEFAULT_TTL_MS): boolean {
  return queryAge(key) < ttl;
}

/** Write a value into the cache and wake every subscriber for `key`. */
export function setQuery<T>(key: string, data: T): void {
  entries.set(key, { data, at: Date.now() });
  notify(key);
}

/**
 * Retire every entry under `keyOrPrefix` (`'/api/studies'` also covers
 * `'/api/studies/42'`): bump the generation so a request already on the wire
 * cannot cache an answer that predates the caller's mutation, and drop any
 * such request. `dropData` decides what subscribers see meanwhile — see the two
 * public wrappers below.
 */
function bust(keyOrPrefix: string, dropData: boolean): void {
  if (dropData) {
    for (const key of Array.from(entries.keys())) {
      if (!matches(key, keyOrPrefix)) continue;
      entries.delete(key);
      notify(key);
    }
  }
  for (const key of Array.from(generations.keys())) {
    if (matches(key, keyOrPrefix)) generations.set(key, generation(key) + 1);
  }
  for (const key of Array.from(inFlight.keys())) {
    if (matches(key, keyOrPrefix)) inFlight.delete(key);
  }
}

/**
 * Drop one key, or every key under a prefix. Call when the cached answer is now
 * **wrong** and must not be shown again; subscribers fall back to "not known
 * yet" and a mounted page re-renders its skeleton.
 */
export function invalidateQuery(keyOrPrefix: string): void {
  bust(keyOrPrefix, true);
}

/**
 * Refetch after a mutation **without** clearing what is on screen: the current
 * value stays until the new one lands, so a page already painted never falls
 * back to its skeleton.
 *
 * This is the right call for "the data changed" — a study was created, renamed
 * or deleted — where the previous answer is merely out of date, not misleading.
 * `invalidateQuery` is for the other case, where showing the old value at all
 * would be a lie.
 *
 * Also warms the key when nothing is cached, so the next visit paints real
 * content on its first frame.
 */
export function revalidateQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  bust(key, false);
  return fetchQuery(key, fetcher);
}

/**
 * Fetch `key` unless an identical request is already on the wire, and cache the
 * result. Always hits the network — freshness is the caller's decision
 * (`useQuery` skips the call when the entry is still fresh). Never rejects;
 * a failed request simply leaves the cache untouched so the caller keeps
 * whatever it already had.
 */
export function fetchQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const startedAt = generation(key);

  const request = fetcher()
    .then((data) => {
      // An invalidate() while this was in flight means the caller already
      // applied a newer truth; caching this answer would undo it.
      if (generation(key) === startedAt) setQuery(key, data);
      return data;
    })
    .finally(() => {
      if (inFlight.get(key) === request) inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

export interface UseQueryResult<T> {
  /**
   * The cached value, or `undefined` if nothing has been fetched yet. On the
   * server and during hydration this is always `undefined`, so a page renders
   * its skeleton rather than depending on data only the browser has.
   */
  data: T | undefined;
  /** True while a request for this key is in flight. */
  isFetching: boolean;
  /** Revalidate now, keeping the current data on screen (no skeleton flash). */
  refresh: () => void;
}

/**
 * Subscribe to a cached GET. Seeds from the cache synchronously, so a page
 * whose data is already cached renders real content on the first frame, and
 * revalidates in the background once the entry passes `ttl`.
 */
export function useQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  { ttl = DEFAULT_TTL_MS }: { ttl?: number } = {},
): UseQueryResult<T> {
  const [isFetching, setFetching] = useState(false);

  // Keep the latest fetcher in a ref: callers pass an inline arrow, so putting
  // it in the effect's deps would refetch on every render.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const subscribe = useCallback(
    (onChange: () => void) => {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(onChange);
      return () => {
        set.delete(onChange);
        if (set.size === 0) listeners.delete(key);
      };
    },
    [key],
  );

  const getSnapshot = useCallback(() => peekQuery<T>(key), [key]);

  // getServerSnapshot must be stable and must match the first client render,
  // or hydration complains — so both say "nothing cached".
  const data = useSyncExternalStore(subscribe, getSnapshot, () => undefined);

  useEffect(() => {
    if (isQueryFresh(key, ttl)) return;

    let cancelled = false;
    setFetching(true);
    fetchQuery(key, () => fetcherRef.current())
      .catch(() => {
        // Callers render from `data`; a failed refresh leaves it as it was.
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [key, ttl]);

  const refresh = useCallback(() => {
    setFetching(true);
    fetchQuery(key, () => fetcherRef.current())
      .catch(() => {})
      .finally(() => setFetching(false));
  }, [key]);

  return { data, isFetching, refresh };
}
