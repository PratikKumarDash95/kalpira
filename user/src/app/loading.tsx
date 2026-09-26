// Route-level fallback for any segment that does not define its own loading.tsx.
// Next renders this the moment a navigation starts, so the user sees the page's
// shape immediately instead of a blank screen or a frozen previous page.
//
// It carries the app chrome (navbar) on purpose: a bare skeleton replaces the
// page wholesale and takes the navbar with it, which is what made a transition
// look like the whole app reloading. Public routes with no navbar (login,
// register, /p/[token]) define their own chrome-less loading.tsx.

import { AppShellSkeleton } from '@/components/ui/Skeleton';

export default function Loading() {
  return <AppShellSkeleton />;
}
