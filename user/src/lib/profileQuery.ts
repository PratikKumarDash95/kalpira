// The signed-in person's profile, as a cacheable read.
//
// Split out from the hook so non-React modules (authStatus, on login/logout) can
// name the cache key without importing React. `Navbar`, `StudyList`, `Settings`
// and the rest used to each call /api/auth/me on mount — a separate round trip
// per component, per navigation. They now all read this one cached entry.

import { apiFetch } from './apiClient';

export const PROFILE_QUERY_KEY = '/api/auth/me';

export interface SessionProfile {
  id?: string;
  name?: string;
  email?: string;
  avatarUrl?: string | null;
  role?: string;
  onboardingComplete?: boolean;
}

export interface ProfileResponse {
  /** The current shape of /api/auth/me. */
  profile?: SessionProfile;
  /** Older callers still read `user`; both are accepted. */
  user?: SessionProfile;
}

/**
 * Resolve the profile, or `null` when there is no session.
 *
 * A missing session is a *known* answer, not an error: callers distinguish it
 * from "not fetched yet" by whether the cache holds `null` or holds nothing at
 * all. Never rejects, so a network blip cannot be mistaken for a logout.
 */
export async function fetchProfile(): Promise<ProfileResponse | null> {
  try {
    const res = await apiFetch(PROFILE_QUERY_KEY);
    if (!res.ok) return null;
    return (await res.json()) as ProfileResponse;
  } catch {
    return null;
  }
}

export function profileOf(res: ProfileResponse | null | undefined): SessionProfile | null {
  return res?.profile ?? res?.user ?? null;
}
