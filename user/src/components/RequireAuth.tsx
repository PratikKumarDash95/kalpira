'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';
import { useRequireAuth } from '@/hooks/useRequireAuth';

interface RequireAuthProps {
  children: React.ReactNode;
  redirectTo?: string;
}

/**
 * Wrap a page's content with this to require a logged-in session.
 * Shows a spinner while checking, redirects to `redirectTo` (default /login)
 * if the user isn't authenticated, and only renders children once confirmed.
 */
export default function RequireAuth({ children, redirectTo = '/login' }: RequireAuthProps) {
  const { status } = useRequireAuth(redirectTo);

  if (status !== 'authed') {
    return (
      <div className="kalpira-light min-h-screen flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-stone-400" />
      </div>
    );
  }

  return <>{children}</>;
}
