'use client';

import { AdminApi } from '@/lib/adminApi';
import { AdminAsync, useAdminData } from '@/components/AdminAsync';
import CalibrationView from '@/components/CalibrationView';

export default function CalibrationPage() {
    const { data, loading, error, reload } = useAdminData(() => AdminApi.itemBank());
    return (
        <AdminAsync loading={loading} error={error} onRetry={reload}>
            {data ? <CalibrationView bank={data} onCalibrated={reload} /> : null}
        </AdminAsync>
    );
}
