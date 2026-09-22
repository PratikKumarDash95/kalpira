// A single study: header, meta tiles, then its interview list. Server-rendered
// per study id.

import { SkeletonList, SkeletonPageHeader, SkeletonStatRow } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div className="kalpira-light min-h-screen p-4 sm:p-8" role="status">
      <span className="sr-only">Loading study…</span>
      <div className="max-w-5xl mx-auto">
        <SkeletonPageHeader className="mb-6 sm:mb-8" />
        <SkeletonStatRow className="mb-6" />
        <SkeletonList rows={5} />
      </div>
    </div>
  );
}
