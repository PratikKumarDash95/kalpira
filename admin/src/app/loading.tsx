// Route-level fallback for every admin segment (none define their own). Rendered
// inside AdminShell's <main>, so it is the content shape only — no page chrome.

import { AdminContentSkeleton } from '@/components/ui/Skeleton';

export default function Loading() {
  return <AdminContentSkeleton />;
}
