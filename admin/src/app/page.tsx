'use client';

import { AdminApi } from '@/lib/adminApi';
import { AdminAsync, useAdminData } from '@/components/AdminAsync';
import { Overview } from '@/components/adminViews';

export default function OverviewPage() {
    const { data, loading, error, reload } = useAdminData(async () => {
        const [stats, fb] = await Promise.all([AdminApi.stats(), AdminApi.feedback()]);
        return { stats, avgRating: fb.averageRating, feedbackCount: fb.feedback.length };
    });

    return (
        <AdminAsync loading={loading} error={error} onRetry={reload}>
            <Overview stats={data?.stats ?? null} avgRating={data?.avgRating ?? 0} feedbackCount={data?.feedbackCount ?? 0} />
        </AdminAsync>
    );
}
