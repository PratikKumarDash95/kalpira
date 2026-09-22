'use client';

import { Suspense } from 'react';
import StudySetup from '@/components/StudySetup';
import PageShell from '@/components/layout/PageShell';
import { SkeletonPageHeader, SkeletonCard, Skeleton } from '@/components/ui/Skeleton';

// The interviewer setup page reuses the same StudySetup component.
// After saving, the study is owned by the interviewer (role=interviewer user).
// The StudySetup component calls /api/studies which uses the session cookie
// to attribute the study to the logged-in user.
export default function InterviewerSetupPage() {
    return (
        <Suspense fallback={
            // Carries the shell so the navbar does not disappear while suspending.
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
        }>
            <StudySetup />
        </Suspense>
    );
}
