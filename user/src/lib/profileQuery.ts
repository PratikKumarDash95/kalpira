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
  authenticated?: boolean;
  /** The current shape of /api/auth/me. */
  profile?: SessionProfile;
  /** Older callers still read `user`; both are accepted. */
  user?: SessionProfile;
}

/**
 * Only an explicit 401 means there is no session. A server/network/profile
 * error rejects, leaving any known profile in the cache instead of signing
 * the UI out while authenticated dashboard requests still succeed.
 */
export async function fetchProfile(): Promise<ProfileResponse | null> {
  const res = await apiFetch(PROFILE_QUERY_KEY, { cache: 'no-store' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Failed to load profile (${res.status})`);
  const data = await res.json() as ProfileResponse;
  if (data.authenticated === false) return null;
  if (!profileOf(data)) throw new Error('Profile response missing identity');
  return data;
}

export function profileOf(res: ProfileResponse | null | undefined): SessionProfile | null {
  return res?.profile ?? res?.user ?? null;
}
