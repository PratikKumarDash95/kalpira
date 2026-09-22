'use client';

import React from 'react';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { PageSkeleton } from '@/components/ui/Skeleton';

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
 * The placeholder is a skeleton of the page chrome rather than a spinner: it
 * reads as "already loading" instead of "not started", and the layout does not
 * jump when the real content replaces it.
 */
export default function RequireAuth({ children, redirectTo = '/login' }: RequireAuthProps) {
  const { status } = useRequireAuth(redirectTo);

  if (status !== 'authed') {
    return <PageSkeleton />;
  }

  return <>{children}</>;
}
