// /login has no navbar — it is a focused, centred card, not an app page. The
// root loading.tsx carries the app chrome, so without this the navbar would
// flash in during a navigation to /login. Mirrors the real card's width so
// nothing shifts when it is replaced.

import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div className="kalpira-light app-shell flex min-h-screen items-center justify-center p-4 sm:p-8" role="status">
      <span className="sr-only">Loading…</span>
      <SkeletonCard className="w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-2xl" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-3.5 w-56" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </SkeletonCard>
    </div>
  );
}
