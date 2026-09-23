'use client';

import { AdminApi } from '@/lib/adminApi';
import { AdminAsync, useAdminData } from '@/components/AdminAsync';
import DeliveryJobsView from '@/components/DeliveryJobsView';

export default function DeliveryJobsPage() {
    const { data, loading, error, reload } = useAdminData(() => AdminApi.deliveryJobs(100));
    return (
        <AdminAsync loading={loading} error={error} onRetry={reload}>
            {data ? <DeliveryJobsView health={data} onRetried={reload} /> : null}
        </AdminAsync>
    );
}
