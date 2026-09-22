// Shared loading placeholders for the admin console.
//
// Two loading states used to interrupt this app: AdminAsync drew a centred
// spinner over a fixed 256px block, and AdminShell printed "Verifying admin
// access…" in the middle of an empty screen. Both are replaced with skeletons of
// what is actually coming, so the chrome and the page shape appear immediately
// and nothing shifts when the data lands.
//
// Colours come from the .skeleton / .skeleton-card utilities in globals.css, so
// these follow the Lumen theme. No 'use client' — pure markup.

import React from 'react';

/** Shimmering placeholder bar/block. Size it with width/height classes. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

/** Elevated card matching the console's panel surface (shadow-card + radius). */
export function SkeletonCard({
  className = '',
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`skeleton-card p-5 ${className}`} aria-hidden="true">
      {children}
    </div>
  );
}

/** Row of stat tiles — every admin view opens with these. */
export function SkeletonStatRow({ count = 4, className = '' }: { count?: number; className?: string }) {
  return (
    <div className={`grid grid-cols-2 lg:grid-cols-4 gap-3 ${className}`} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} className="p-4">
          <Skeleton className="h-3 w-20 mb-3" />
          <Skeleton className="h-7 w-14" />
        </SkeletonCard>
      ))}
    </div>
  );
}

/**
 * Table placeholder matching `.data-table` rows — the shape most admin pages
 * resolve to (candidates, sessions, studies, interviewers, feedback).
 */
export function SkeletonTable({
  rows = 6,
  cols = 5,
  className = '',
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div className={`skeleton-card p-5 ${className}`} aria-hidden="true">
      {/* Header row */}
      <div className="flex gap-4 pb-4 mb-2 border-b border-[color:var(--line)]">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className={`h-3 ${i === 0 ? 'w-32' : 'w-20'}`} />
        ))}
      </div>
      <div className="space-y-4 pt-2">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4 items-center">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className={`h-3.5 ${c === 0 ? 'w-32' : 'w-20'}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Page-shaped placeholder for AdminAsync's loading slot. Rendered inside the
 * shell's <main>, so it deliberately carries no page chrome of its own.
 */
export function AdminContentSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading admin data…</span>
      <SkeletonStatRow className="mb-5" />
      <SkeletonTable rows={6} cols={5} />
    </div>
  );
}

/**
 * Whole-console placeholder for AdminShell while /api/admin/me is verified:
 * sidebar + header + content, matching the real shell's geometry so the layout
 * does not jump when access is confirmed.
 */
export function AdminShellSkeleton() {
  return (
    <div className="app-shell min-h-screen flex" role="status">
      <span className="sr-only">Verifying admin access…</span>

      {/* Sidebar */}
      <aside className="hidden lg:flex w-64 flex-shrink-0 bg-[color:var(--surface)] border-r border-[color:var(--line)] flex-col">
        <div className="p-6 border-b border-[color:var(--line)]">
          <div className="flex items-center gap-3">
            <Skeleton className="w-9 h-9" />
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-14" />
            </div>
          </div>
        </div>
        <div className="flex-1 p-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-[color:var(--surface)] border-b border-[color:var(--line)] px-4 sm:px-6 py-4">
          <Skeleton className="h-6 w-40" />
        </header>
        <main className="flex-1 p-4 sm:p-6">
          <AdminContentSkeleton />
        </main>
      </div>
    </div>
  );
}
