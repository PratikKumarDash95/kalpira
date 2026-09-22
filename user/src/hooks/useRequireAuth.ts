'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAuthStatus } from '@/lib/authStatus';

export type AuthGuardStatus = 'checking' | 'authed' | 'guest';

/**
 * Client-side auth guard for pages that require a logged-in session.
 * Resolves the session through getAuthStatus(), which reuses a recent signed-in
 * answer — so moving between protected pages no longer costs a fresh /api/auth
 * round trip before anything can render. Redirects to `redirectTo` if not
 * authenticated.
 *
 * Note: this only gates rendering in the browser. Any data these pages fetch
 * must still be protected server-side — this hook does not replace that.
 */
export function useRequireAuth(redirectTo: string = '/login'): { status: AuthGuardStatus } {
  const router = useRouter();
  const [status, setStatus] = useState<AuthGuardStatus>('checking');

  useEffect(() => {
    let cancelled = false;

    getAuthStatus()
      .then(data => {
        if (cancelled) return;
        if (data?.authenticated) {
          setStatus('authed');
        } else {
          setStatus('guest');
          router.replace(redirectTo);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('guest');
        router.replace(redirectTo);
      });

    return () => {
      cancelled = true;
    };
  }, [redirectTo, router]);

  return { status };
}
