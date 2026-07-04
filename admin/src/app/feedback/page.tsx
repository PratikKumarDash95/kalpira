'use client';

import { AdminApi } from '@/lib/adminApi';
import { AdminAsync, useAdminData } from '@/components/AdminAsync';
import { FeedbackTable } from '@/components/adminViews';

export default function FeedbackPage() {
    const { data, loading, error, reload } = useAdminData(() => AdminApi.feedback());
    return (
        <AdminAsync loading={loading} error={error} onRetry={reload}>
            <FeedbackTable rows={data?.feedback ?? []} avg={data?.averageRating ?? 0} />
        </AdminAsync>
    );
}
