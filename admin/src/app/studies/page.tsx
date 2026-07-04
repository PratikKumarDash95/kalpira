'use client';

import { useState } from 'react';
import { AdminApi } from '@/lib/adminApi';
import { AdminAsync, useAdminData } from '@/components/AdminAsync';
import { StudiesTable } from '@/components/adminViews';
import { ConfirmDialog } from '@/components/adminShared';

export default function StudiesPage() {
    const { data, loading, error, reload } = useAdminData(() => AdminApi.studies());
    const [search, setSearch] = useState('');
    const [confirm, setConfirm] = useState<{ message: string; action: () => Promise<void> } | null>(null);
    const [confirmBusy, setConfirmBusy] = useState(false);

    const matches = (s: string) => !search || s.toLowerCase().includes(search.toLowerCase());
    const rows = (data?.studies ?? []).filter((s) => matches(s.name) || matches(s.owner?.email || ''));

    const runConfirm = async () => {
        if (!confirm) return;
        setConfirmBusy(true);
        try { await confirm.action(); setConfirm(null); }
        finally { setConfirmBusy(false); }
    };

    return (
        <AdminAsync loading={loading} error={error} onRetry={reload}>
            <StudiesTable
                rows={rows} search={search} setSearch={setSearch}
                onDelete={(s) => setConfirm({
                    message: `Delete study "${s.name}"? Stored interviews under it will be removed.`,
                    action: async () => { await AdminApi.deleteStudy(s.id); await reload(); },
                })}
            />
            {confirm && <ConfirmDialog message={confirm.message} onConfirm={runConfirm} onCancel={() => setConfirm(null)} busy={confirmBusy} />}
        </AdminAsync>
    );
}
