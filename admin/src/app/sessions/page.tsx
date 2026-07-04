'use client';

import { AdminApi } from '@/lib/adminApi';
import { AdminAsync, useAdminData } from '@/components/AdminAsync';
import { SessionsTable } from '@/components/adminViews';

export default function SessionsPage() {
    const { data, loading, error, reload } = useAdminData(() => AdminApi.sessions());
    return (
        <AdminAsync loading={loading} error={error} onRetry={reload}>
            <SessionsTable rows={data?.sessions ?? []} />
        </AdminAsync>
    );
}
