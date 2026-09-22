import { Suspense } from 'react';
import PracticeSetup from '@/components/PracticeSetup';
import PageShell from '@/components/layout/PageShell';
import { SkeletonPageHeader, SkeletonCard, Skeleton } from '@/components/ui/Skeleton';

// The shell, not a bare spinner: the fallback replaces the page wholesale while
// useSearchParams suspends, so it has to carry the navbar or the chrome flashes away.
function SetupLoading() {
  return (
    <PageShell>
      <SkeletonPageHeader className="mb-6" />
      <SkeletonCard>
        <div className="space-y-4">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-32" />
        </div>
      </SkeletonCard>
    </PageShell>
  );
}

export default function SetupPage() {
  return (
    <Suspense fallback={<SetupLoading />}>
      <PracticeSetup />
    </Suspense>
  );
}
