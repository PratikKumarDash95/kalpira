'use client';

import { Suspense } from 'react';
import StudySetup from '@/components/StudySetup';
import PageShell from '@/components/layout/PageShell';
import { SkeletonPageHeader, SkeletonCard, Skeleton } from '@/components/ui/Skeleton';
import RequireAuth from '@/components/RequireAuth';

export default function InterviewerSetupPage() {
    return (
        <RequireAuth redirectTo="/interviewer/login">
            <Suspense fallback={
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
        </RequireAuth>
    );
}

