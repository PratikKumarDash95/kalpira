// Cache keys for `queryCache`, in one place so reads and invalidations agree.
//
// Kept dependency-free (no React) so any module can name a key — a service, a
// hook, or an event handler — without pulling hooks into its import graph.
//
// `PROFILE_QUERY_KEY` lives with its fetcher in `lib/profileQuery.ts`.

/** The signed-in user's study list. */
export const STUDIES_QUERY_KEY = '/api/studies';

/**
 * Prefix for a single study's detail entry. Trailing slash is deliberate:
 * `invalidateQuery` matches exact keys or prefixes, so this clears
 * `/api/studies/42` without touching the list itself.
 */
export const STUDIES_DETAIL_PREFIX = '/api/studies/';

/** One study's detail payload. */
export function studyQueryKey(id: string): string {
  return `${STUDIES_DETAIL_PREFIX}${id}`;
}

/**
 * The interviews belonging to one study. Shaped like the URL it fetches, so the
 * key and the request can be read side by side.
 */
export function studyInterviewsQueryKey(id: string): string {
  return `/api/interviews?studyId=${id}`;
}

/**
 * A delivery profile — the signed-in person's own, or (for an interviewer
 * viewing a candidate) the one belonging to `sessionId`. The session travels in
 * the URL; no account id is ever sent from the client.
 */
export function deliveryProfileQueryKey(sessionId?: string): string {
  return sessionId
    ? `/api/delivery/profile?sessionId=${encodeURIComponent(sessionId)}`
    : '/api/delivery/profile';
}
