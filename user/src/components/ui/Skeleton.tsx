// Shared loading placeholders.
//
// These exist so a page that is still fetching shows its real shape instead of a
// centred spinner or a blank screen: the layout does not jump when the data
// lands, which is what makes navigation feel instant even when it is not.
//
// No 'use client' — these are pure markup, usable from both server (`loading.tsx`)
// and client components. Colours come from the .skeleton / .skeleton-card
// utilities in globals.css, so they follow the Lumen theme automatically.

import React from 'react';

/** Shimmering placeholder bar/block. Size it with width/height classes. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

/**
 * Elevated card matching the app's card surface (white, 1rem radius,
 * shadow-card) — the same chrome real content sits in, so there is no shift.
 * Pass padding via className when the real card differs.
 */
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

/** A block of text lines; the last is short so it reads as a paragraph. */
export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2.5 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3.5 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}

/** Icon tile + title + subtitle, as used at the top of most pages. */
export function SkeletonPageHeader({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`} aria-hidden="true">
      <div className="flex items-center gap-3 min-w-0">
        <Skeleton className="w-10 h-10 flex-shrink-0" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48 sm:w-64" />
          <Skeleton className="h-3.5 w-32" />
        </div>
      </div>
      {/* Action buttons, hidden on small screens exactly like the real headers. */}
      <div className="hidden md:flex gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-24" />
      </div>
    </div>
  );
}

/** Row of bordered stat tiles. */
export function SkeletonStatRow({ count = 3, className = '' }: { count?: number; className?: string }) {
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-3 gap-3 ${className}`} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} className="p-4">
          <Skeleton className="h-3 w-16 mb-3" />
          <Skeleton className="h-6 w-12" />
        </SkeletonCard>
      ))}
    </div>
  );
}

/** Stack of elevated list rows, one per record. */
export function SkeletonList({ rows = 4, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-3 ${className}`} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonCard key={i} className="p-4 flex items-center gap-4">
          <Skeleton className="w-9 h-9 flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-8 w-20 flex-shrink-0" />
        </SkeletonCard>
      ))}
    </div>
  );
}

/**
 * Whole-page placeholder used while the session is confirmed and by route-level
 * `loading.tsx`. `role="status"` announces the wait to screen readers without
 * making them read every placeholder bar.
 */
export function PageSkeleton({ maxWidth = 'max-w-5xl' }: { maxWidth?: string }) {
  return (
    <div className="kalpira-light min-h-screen p-4 sm:p-8" role="status">
      <span className="sr-only">Loading…</span>
      <div className={`${maxWidth} mx-auto`}>
        <SkeletonPageHeader className="mb-6 sm:mb-8" />
        <SkeletonStatRow className="mb-6" />
        <SkeletonList rows={4} />
      </div>
    </div>
  );
}
