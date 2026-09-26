// A single study: header, meta tiles, then its interview list. Server-rendered
// per study id.
//
// Same shape as the real page, inside the app chrome so the navbar stays put
// across the wait.

import {
  AppShellSkeleton,
  SkeletonList,
  SkeletonPageHeader,
  SkeletonStatRow,
} from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <AppShellSkeleton>
      <SkeletonPageHeader className="mb-6 sm:mb-8" />
      <SkeletonStatRow className="mb-6" />
      <SkeletonList rows={5} />
    </AppShellSkeleton>
  );
}
