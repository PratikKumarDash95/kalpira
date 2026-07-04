'use client';

import { useState } from 'react';
import { AdminApi, type AdminUser } from '@/lib/adminApi';
import { AdminAsync, useAdminData } from '@/components/AdminAsync';
import { InterviewersTable } from '@/components/adminViews';
import { ConfirmDialog } from '@/components/adminShared';
import { CreateUserModal, EditUserModal, UserDetailModal } from '@/components/adminModals';

export default function InterviewersPage() {
    const { data, loading, error, reload } = useAdminData(() => AdminApi.interviewers());
    const [search, setSearch] = useState('');
    const [createOpen, setCreateOpen] = useState(false);
    const [editUser, setEditUser] = useState<AdminUser | null>(null);
    const [detailUserId, setDetailUserId] = useState<string | null>(null);
    const [confirm, setConfirm] = useState<{ message: string; action: () => Promise<void> } | null>(null);
    const [confirmBusy, setConfirmBusy] = useState(false);

    const matches = (s: string) => !search || s.toLowerCase().includes(search.toLowerCase());
    const rows = (data?.interviewers ?? []).filter((u) => matches(u.name || '') || matches(u.email || ''));

    const runConfirm = async () => {
        if (!confirm) return;
        setConfirmBusy(true);
        try { await confirm.action(); setConfirm(null); }
        finally { setConfirmBusy(false); }
    };

    return (
        <AdminAsync loading={loading} error={error} onRetry={reload}>
            <InterviewersTable
                rows={rows} search={search} setSearch={setSearch}
                onCreate={() => setCreateOpen(true)} onView={setDetailUserId}
                onEdit={(iv) => setEditUser({ id: iv.id, name: iv.name, email: iv.email, role: 'interviewer', oauthProvider: iv.oauthProvider, onboardingComplete: true, createdAt: iv.createdAt, _count: { interviewSessions: iv.totalInterviews, studies: iv.studiesCreated } })}
                onDelete={(iv) => setConfirm({
                    message: `Delete interviewer ${iv.name || iv.email}? Their studies and assigned interviews will be affected.`,
                    action: async () => { await AdminApi.deleteUser(iv.id); await reload(); },
                })}
            />
            {createOpen && <CreateUserModal defaultRole="interviewer" onClose={() => setCreateOpen(false)} onCreated={reload} />}
            {editUser && <EditUserModal user={editUser} onClose={() => setEditUser(null)} onSaved={reload} />}
            {detailUserId && <UserDetailModal userId={detailUserId} onClose={() => setDetailUserId(null)} />}
            {confirm && <ConfirmDialog message={confirm.message} onConfirm={runConfirm} onCancel={() => setConfirm(null)} busy={confirmBusy} />}
        </AdminAsync>
    );
}
