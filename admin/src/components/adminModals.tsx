'use client';

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AdminApi, type AdminUser, type Role, type UserDetail } from '@/lib/adminApi';
import { Modal, Field, inputClass, useSubmit, formatDate, formatDateTime, RoleBadge } from '@/components/adminShared';

const ROLE_OPTIONS: Role[] = ['candidate', 'interviewer', 'admin'];

// ─── Create user ──────────────────────────────────────────────────────────
export function CreateUserModal({ defaultRole, onClose, onCreated }: {
    defaultRole: Role; onClose: () => void; onCreated: () => void;
}) {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<Role>(defaultRole);
    const { busy, error, run } = useSubmit();

    const submit = () =>
        run(async () => {
            await AdminApi.createUser({ name, email, password, role });
            onCreated();
            onClose();
        }).catch(() => {});

    return (
        <Modal title="Create user" onClose={onClose}>
            <div className="space-y-4">
                <Field label="Name">
                    <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
                </Field>
                <Field label="Email">
                    <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" type="email" />
                </Field>
                <Field label="Temporary password">
                    <input className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" type="text" />
                </Field>
                <Field label="Role">
                    <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                        {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                </Field>
                {error && <p className="text-xs text-red-400">{error}</p>}
                <button onClick={submit} disabled={busy} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium disabled:opacity-50">
                    {busy && <Loader2 size={14} className="animate-spin" />} Create user
                </button>
            </div>
        </Modal>
    );
}

// ─── Edit user ────────────────────────────────────────────────────────────
export function EditUserModal({ user, onClose, onSaved }: {
    user: Pick<AdminUser, 'id' | 'name' | 'email' | 'role'>; onClose: () => void; onSaved: () => void;
}) {
    const [name, setName] = useState(user.name || '');
    const [email, setEmail] = useState(user.email || '');
    const [role, setRole] = useState<Role>(user.role);
    const { busy, error, run } = useSubmit();

    const submit = () =>
        run(async () => {
            await AdminApi.updateUser({ userId: user.id, name, email, role });
            onSaved();
            onClose();
        }).catch(() => {});

    return (
        <Modal title="Edit user" onClose={onClose}>
            <div className="space-y-4">
                <Field label="Name">
                    <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Email">
                    <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
                </Field>
                <Field label="Role">
                    <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                        {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                </Field>
                {error && <p className="text-xs text-red-400">{error}</p>}
                <button onClick={submit} disabled={busy} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium disabled:opacity-50">
                    {busy && <Loader2 size={14} className="animate-spin" />} Save changes
                </button>
            </div>
        </Modal>
    );
}

// ─── User detail drawer ───────────────────────────────────────────────────
export function UserDetailModal({ userId, onClose }: { userId: string; onClose: () => void }) {
    const [detail, setDetail] = useState<UserDetail | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        AdminApi.userDetail(userId)
            .then((d) => { if (alive) setDetail(d); })
            .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Failed to load'); });
        return () => { alive = false; };
    }, [userId]);

    return (
        <Modal title="User detail" onClose={onClose} wide>
            {error && <p className="text-sm text-red-400">{error}</p>}
            {!detail && !error && (
                <div className="flex items-center justify-center py-10"><Loader2 size={22} className="animate-spin text-violet-400" /></div>
            )}
            {detail && (
                <div className="space-y-5">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-lg font-bold">
                            {(detail.user.name?.[0] || detail.user.email?.[0] || '?').toUpperCase()}
                        </div>
                        <div>
                            <p className="text-white font-semibold">{detail.user.name || 'Anonymous'}</p>
                            <p className="text-xs text-slate-400">{detail.user.email || '—'}</p>
                        </div>
                        <div className="ml-auto"><RoleBadge role={detail.user.role} /></div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Stat label="Sessions" value={detail.sessions.length} />
                        <Stat label="Studies" value={detail.studies.length} />
                        <Stat label="Badges" value={detail.badges.length} />
                        <Stat label="Readiness" value={detail.readinessScore != null ? `${Math.round(detail.readinessScore)}%` : '—'} />
                    </div>

                    <Section title="Recent sessions">
                        {detail.sessions.length === 0 ? <Empty /> : detail.sessions.slice(0, 8).map((s) => (
                            <Row key={s.id} left={s.role || 'General'} mid={s.completedAt ? 'completed' : 'active'} right={formatDateTime(s.startedAt)} />
                        ))}
                    </Section>

                    <Section title="Studies">
                        {detail.studies.length === 0 ? <Empty /> : detail.studies.slice(0, 8).map((s) => (
                            <Row key={s.id} left={s.name} mid={`${s.interviewCount} interviews`} right={formatDate(s.createdAt)} />
                        ))}
                    </Section>
                </div>
            )}
        </Modal>
    );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-center">
            <p className="text-lg font-bold text-white">{value}</p>
            <p className="text-[11px] text-slate-500 uppercase tracking-wide">{label}</p>
        </div>
    );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">{title}</p>
            <div className="rounded-xl border border-slate-800 divide-y divide-slate-800 overflow-hidden">{children}</div>
        </div>
    );
}
function Row({ left, mid, right }: { left: string; mid: string; right: string }) {
    return (
        <div className="flex items-center gap-3 px-3 py-2 text-xs">
            <span className="text-slate-200 truncate flex-1">{left}</span>
            <span className="text-slate-400">{mid}</span>
            <span className="text-slate-500 shrink-0">{right}</span>
        </div>
    );
}
function Empty() {
    return <p className="px-3 py-4 text-xs text-slate-500 text-center">Nothing yet</p>;
}
