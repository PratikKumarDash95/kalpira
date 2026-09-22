// Route-level fallback for every interviewer segment. The skeleton primitives
// live in the shared user app (see the "@/*" -> "../user/src/*" alias in
// tsconfig), so this app renders the same placeholders as the main app.

import { PageSkeleton } from '@/components/ui/Skeleton';

export default function Loading() {
  return <PageSkeleton />;
}
