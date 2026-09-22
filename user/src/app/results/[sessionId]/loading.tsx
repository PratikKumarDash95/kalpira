// Session results: a summary header, a row of score tiles, then the transcript /
// chart panels. Server-rendered per session id, so this is the real wait.

import { Skeleton, SkeletonCard, SkeletonPageHeader, SkeletonStatRow } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div className="kalpira-light min-h-screen p-4 sm:p-8" role="status">
      <span className="sr-only">Loading results…</span>
      <div className="max-w-4xl mx-auto">
        <SkeletonPageHeader className="mb-6 sm:mb-8" />
        <SkeletonStatRow count={4} className="mb-6" />
        <div className="grid lg:grid-cols-3 gap-4">
          <SkeletonCard className="lg:col-span-2 p-6">
            <Skeleton className="h-4 w-32 mb-5" />
            <Skeleton className="h-56 w-full mb-4" />
            <Skeleton className="h-3.5 w-full mb-2.5" />
            <Skeleton className="h-3.5 w-5/6" />
          </SkeletonCard>
          <SkeletonCard className="p-6">
            <Skeleton className="h-4 w-24 mb-5" />
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-2.5 w-full" />
                </div>
              ))}
            </div>
          </SkeletonCard>
        </div>
      </div>
    </div>
  );
}
