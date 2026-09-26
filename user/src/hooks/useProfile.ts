'use client';

import { useQuery } from '@/lib/queryCache';
import {
  PROFILE_QUERY_KEY,
  fetchProfile,
  profileOf,
  type ProfileResponse,
  type SessionProfile,
} from '@/lib/profileQuery';

export type SessionStatus = 'unknown' | 'guest' | 'authed';

export interface UseProfileResult {
  /**
   * `unknown` until an answer is cached, then `guest` or `authed`. Callers that
   * render different chrome per state must handle `unknown` explicitly — that is
   * what stops a nav item appearing and then vanishing once the role lands.
   */
  status: SessionStatus;
  profile: SessionProfile | null;
  /** Revalidate now, keeping the current profile on screen. */
  refresh: () => void;
  isFetching: boolean;
}

/**
 * The signed-in person's profile, shared across every component that needs it.
 *
 * Backed by the shared query cache, so after the first page load this returns a
 * value synchronously on the first render — no skeleton, no request, and no
 * "Sign in" flashing before the avatar on each navigation.
 */
export function useProfile(ttl?: number): UseProfileResult {
  const { data, isFetching, refresh } = useQuery<ProfileResponse | null>(
    PROFILE_QUERY_KEY,
    fetchProfile,
    ttl === undefined ? undefined : { ttl },
  );

  if (data === undefined) {
    return { status: 'unknown', profile: null, refresh, isFetching };
  }

  const profile = profileOf(data);
  return {
    status: profile ? 'authed' : 'guest',
    profile,
    refresh,
    isFetching,
  };
}
