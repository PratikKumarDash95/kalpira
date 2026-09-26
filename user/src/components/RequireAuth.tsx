'use client';

import React from 'react';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { AppShellSkeleton } from '@/components/ui/Skeleton';

interface RequireAuthProps {
  children: React.ReactNode;
  redirectTo?: string;
}

/**
 * Wrap a page's content with this to require a logged-in session.
 * Shows the page's skeleton while the session is confirmed, redirects to
 * `redirectTo` (default /login) if the user isn't authenticated, and only
 * renders children once confirmed.
 *
 * The placeholder keeps the app chrome (see AppShellSkeleton): the navbar stays
 * mounted across the wait, so confirming a session no longer looks like the page
 * reloading. It also reads as "already loading" rather than "not started", and
 * the layout does not jump when the real content replaces it.
 *
 * In practice this fallback is rarely seen: useRequireAuth seeds from the cached
 * session answer, so every navigation after the first renders children straight
 * away.
 */
export default function RequireAuth({ children, redirectTo = '/login' }: RequireAuthProps) {
  const { status } = useRequireAuth(redirectTo);

  if (status !== 'authed') {
    return <AppShellSkeleton />;
  }

  return <>{children}</>;
}
