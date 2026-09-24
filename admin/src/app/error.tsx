'use client';

// Route-level error boundary for the admin console.
//
// Without this file a render fault anywhere in a page replaced the entire app
// with Next's production fallback — "Application error: a client-side exception
// has occurred (see the browser console for more information)." — which says
// nothing about which page broke or why. That is how /candidates stayed blank:
// the users API stopped returning `_count`, one table cell threw on
// `u._count.interviewSessions`, and the console message was the only clue.
//
// The shell lives in the root layout, so the sidebar survives and the faulty
// route is the only thing replaced. `reset` re-renders the segment, which is
// enough to recover from a transient API failure without a full reload.

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        // Next only shows the digest to the client in production; the full error
        // is in the server log. Keeping this in the console means the two can be
        // matched up instead of guessed at.
        console.error('[admin] route render failed', error);
    }, [error]);

    return (
        <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] shadow-card p-6">
            <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
                <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-[color:var(--text)]">This page could not be displayed</h2>
                    <p className="mt-1 text-sm text-[color:var(--muted)]">
                        The admin console hit an error while rendering this view. The rest of the console still works —
                        pick another page from the sidebar, or try this one again.
                    </p>

                    {/* Surfaced rather than hidden: if the API returned an unexpected
                        shape, the message below is what says so. */}
                    {error?.message && (
                        <p className="mt-3 rounded-lg bg-[color:var(--surface-soft)] border border-[color:var(--line)] px-3 py-2 text-xs text-[color:var(--text-soft)] break-words">
                            {error.message}
                            {error.digest && <span className="text-[color:var(--faint)]"> (digest {error.digest})</span>}
                        </p>
                    )}

                    <button
                        type="button"
                        onClick={reset}
                        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-600 hover:bg-brand-500 px-4 py-2 text-sm font-medium text-white"
                    >
                        <RefreshCw size={14} /> Try again
                    </button>
                </div>
            </div>
        </div>
    );
}
