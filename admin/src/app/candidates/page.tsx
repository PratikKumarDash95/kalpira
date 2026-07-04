'use client';

import { useState } from 'react';
import { AdminApi, type AdminUser } from '@/lib/adminApi';
import { AdminAsync, useAdminData } from '@/components/AdminAsync';
import { UsersTable } from '@/components/adminViews';
import { ConfirmDialog } from '@/components/adminShared';
import { CreateUserModal, EditUserModal, UserDetailModal } from '@/components/adminModals';

export default function CandidatesPage() {
    const { data, loading, error, reload } = useAdminData(() => AdminApi.users('candidate'));
    const [search, setSearch] = useState('');
    const [createOpen, setCreateOpen] = useState(false);
    const [editUser, setEditUser] = useState<AdminUser | null>(null);
    const [detailUserId, setDetailUserId] = useState<string | null>(null);
    const [confirm, setConfirm] = useState<{ message: string; action: () => Promise<void> } | null>(null);
    const [confirmBusy, setConfirmBusy] = useState(false);

    const matches = (s: string) => !search || s.toLowerCase().includes(search.toLowerCase());
    const users = (data?.users ?? []).filter((u) => matches(u.name || '') || matches(u.email || ''));

    const runConfirm = async () => {
        if (!confirm) return;
        setConfirmBusy(true);
        try { await confirm.action(); setConfirm(null); }
        finally { setConfirmBusy(false); }
    };

    return (
        <AdminAsync loading={loading} error={error} onRetry={reload}>
            <UsersTable
                title="candidate" users={users} search={search} setSearch={setSearch}
                onCreate={() => setCreateOpen(true)} onEdit={setEditUser} onView={setDetailUserId}
                onDelete={(u) => setConfirm({
                    message: `Delete ${u.name || u.email}? This removes their sessions, studies and related data permanently.`,
                    action: async () => { await AdminApi.deleteUser(u.id); await reload(); },
                })}
            />
            {createOpen && <CreateUserModal defaultRole="candidate" onClose={() => setCreateOpen(false)} onCreated={reload} />}
            {editUser && <EditUserModal user={editUser} onClose={() => setEditUser(null)} onSaved={reload} />}
            {detailUserId && <UserDetailModal userId={detailUserId} onClose={() => setDetailUserId(null)} />}
            {confirm && <ConfirmDialog message={confirm.message} onConfirm={runConfirm} onCancel={() => setConfirm(null)} busy={confirmBusy} />}
        </AdminAsync>
    );
}
