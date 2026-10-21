'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useProfile } from '@/hooks/useProfile';
import { fetchQuery } from '@/lib/queryCache';
import { STUDIES_QUERY_KEY, fetchStudies } from '@/lib/studiesQuery';
import { fetchCandidateDashboard, CANDIDATE_DASHBOARD_QUERY_KEY } from '@/lib/candidateDashboardQuery';
import { fetchDeliveryProfile, deliveryProfileQueryKey } from '@/lib/deliveryQuery';
import { fetchAbility, abilityQueryKey } from '@/lib/abilityQuery';
import { fetchInterviewerDashboard, INTERVIEWER_DASHBOARD_QUERY_KEY } from '@/lib/interviewerDashboardQuery';
import { getAllInterviews } from '@/services/storageService';

/**
 * AppCacheWarmer: Background data & route pre-fetcher.
 * 
 * Pre-warms the cache for all primary application views and prefetches client
 * routes as soon as an authenticated session is confirmed. When the user navigates
 * between Studies, Ability, Delivery, and Dashboards, the JavaScript bundles and
 * data are already present in memory — rendering immediately on the first frame
 * with zero loading delay, zero network lag, and no flashing skeletons.
 */
export default function AppCacheWarmer() {
  const router = useRouter();
  const { status, profile } = useProfile();
  const warmedRef = useRef(false);

  useEffect(() => {
    if (status !== 'authed' || !profile?.id || warmedRef.current) return;
    warmedRef.current = true;

    // Prefetch common Next.js route chunks in parallel
    try {
      router.prefetch('/dashboard');
      router.prefetch('/studies');
      router.prefetch('/ability');
      router.prefetch('/delivery');
      if (profile.role === 'interviewer' || profile.role === 'admin') {
        router.prefetch('/interviewer/dashboard');
      } else {
        router.prefetch('/candidate/dashboard');
      }
    } catch {
      // Safe noop if router prefetch fails in non-browser env
    }

    // Use requestIdleCallback or defer slightly to ensure initial paint is prioritized
    const scheduleWarm = typeof window !== 'undefined' && 'requestIdleCallback' in window
      ? (window as any).requestIdleCallback
      : (cb: () => void) => setTimeout(cb, 100);

    const idleHandle = scheduleWarm(() => {
      const userId = profile.id!;
      const isCandidate = profile.role !== 'interviewer' && profile.role !== 'admin';

      // 1. Pre-warm Studies list
      void fetchQuery(STUDIES_QUERY_KEY, fetchStudies);

      // 2. Pre-warm Delivery Profile
      void fetchQuery(deliveryProfileQueryKey(), () => fetchDeliveryProfile());

      // 3. Pre-warm Ability Profile
      void fetchQuery(abilityQueryKey(userId), () => fetchAbility(userId));

      // 4. Pre-warm general Interviews list
      void fetchQuery('/api/interviews?summary=1', () => getAllInterviews({ summary: true }));

      // 4. Pre-warm Candidate Dashboard for candidate accounts
      if (isCandidate) {
        void fetchQuery(CANDIDATE_DASHBOARD_QUERY_KEY, fetchCandidateDashboard);
      } else {
        // Pre-warm Interviewer Dashboard for interviewer/admin accounts
        void fetchQuery(INTERVIEWER_DASHBOARD_QUERY_KEY, fetchInterviewerDashboard);
      }
    });

    return () => {
      if (typeof window !== 'undefined' && 'cancelIdleCallback' in window && typeof idleHandle === 'number') {
        (window as any).cancelIdleCallback(idleHandle);
      }
    };
  }, [status, profile, router]);

  return null;
}
