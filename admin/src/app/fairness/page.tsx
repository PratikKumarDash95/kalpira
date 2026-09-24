'use client';

import { AdminApi } from '@/lib/adminApi';
import { AdminAsync, useAdminData } from '@/components/AdminAsync';
import FairnessView from '@/components/FairnessView';

// The study list is the only thing this page loads up front: an audit is run for one study
// at a time, and the runs themselves are read when a study is chosen rather than for every
// study on mount.
export default function FairnessPage() {
    const { data, loading, error, reload } = useAdminData(() => AdminApi.studies());
    return (
        <AdminAsync loading={loading} error={error} onRetry={reload}>
            {data ? <FairnessView studies={data.studies} /> : null}
        </AdminAsync>
    );
}
