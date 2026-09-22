// Route-level fallback for any segment that does not define its own loading.tsx.
// Next renders this the moment a navigation starts, so the user sees the page's
// shape immediately instead of a blank screen or a frozen previous page.

import { PageSkeleton } from '@/components/ui/Skeleton';

export default function Loading() {
  return <PageSkeleton />;
}
