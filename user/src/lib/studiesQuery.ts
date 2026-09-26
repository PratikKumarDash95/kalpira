// The studies list as one cache entry: key, fetcher, payload type, and the
// mutation-time refresh together, so a reader and a writer cannot disagree
// about any of them.
//
// Mirrors `lib/profileQuery.ts`, which does the same job for the session
// profile. Anything that creates, renames or deletes a study calls
// `revalidateStudies()` — never `invalidateQuery` directly, which would clear
// the list and flash the skeleton the user just navigated away from.

import type { StoredStudy } from '@/types';
import { getAllStudies } from '@/services/storageService';
import { revalidateQuery } from './queryCache';
import { STUDIES_QUERY_KEY } from './queryKeys';

export { STUDIES_QUERY_KEY };

export interface StudiesPayload {
  studies: StoredStudy[];
  /** Set by the API when storage is not configured; surfaced as a banner. */
  warning?: string;
}

/** Fetcher for `STUDIES_QUERY_KEY`. */
export function fetchStudies(): Promise<StudiesPayload> {
  return getAllStudies();
}

/**
 * Refetch the list behind whatever is already on screen — the cached rows stay
 * until the new ones land. Call after any mutation that changes the set of
 * studies or one of the fields the list shows.
 */
export function revalidateStudies(): void {
  // Deliberately not awaited: callers use this on the success path of a save,
  // immediately before navigating, and nothing downstream waits on it.
  void revalidateQuery(STUDIES_QUERY_KEY, getAllStudies);
}
