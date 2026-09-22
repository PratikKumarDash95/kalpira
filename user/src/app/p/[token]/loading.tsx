// Participant link landing (/p/[token]) — a focused, centred card rather than
// the console chrome, so this mirrors that instead of the dashboard shell.
// Keeps the same max width as the real card so nothing shifts on hydration.

import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div className="kalpira-light min-h-screen flex items-center justify-center p-4" role="status">
      <span className="sr-only">Loading interview…</span>
      <SkeletonCard className="w-full max-w-lg p-8">
        <Skeleton className="h-10 w-10 mb-5" />
        <Skeleton className="h-6 w-56 mb-3" />
        <Skeleton className="h-3.5 w-full mb-2.5" />
        <Skeleton className="h-3.5 w-4/5 mb-6" />
        <Skeleton className="h-11 w-full" />
      </SkeletonCard>
    </div>
  );
}
