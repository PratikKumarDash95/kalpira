'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, AlertTriangle } from 'lucide-react';
import type { Role } from '@/lib/adminApi';

export const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const formatDateTime = (d: string | null) =>
    d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

// ─── Role badge ───────────────────────────────────────────────────────────
const roleColors: Record<Role, string> = {
    admin: 'bg-violet-500/10 text-violet-300 border-violet-500/20',
    interviewer: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
    candidate: 'bg-slate-700/50 text-slate-300 border-slate-600/20',
};

export function RoleBadge({ role }: { role: Role }) {
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${roleColors[role]}`}>
            {role}
        </span>
    );
}

// ─── Modal shell ──────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, wide }: {
    title: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ opacity: 0, scale: 0.96, y: 12 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96, y: 12 }}
                    onClick={(e) => e.stopPropagation()}
                    className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[85vh] overflow-auto rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl`}
                >
                    <div className="sticky top-0 flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900">
                        <h3 className="font-semibold text-white text-sm">{title}</h3>
                        <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Close">
                            <X size={16} />
                        </button>
                    </div>
                    <div className="p-5">{children}</div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}

// ─── Confirm dialog ───────────────────────────────────────────────────────
export function ConfirmDialog({ message, confirmLabel = 'Delete', onConfirm, onCancel, busy }: {
    message: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void; busy?: boolean;
}) {
    return (
        <Modal title="Please confirm" onClose={onCancel}>
            <div className="flex items-start gap-3 mb-5">
                <AlertTriangle size={20} className="text-amber-400 shrink-0 mt-0.5" />
                <p className="text-sm text-slate-300">{message}</p>
            </div>
            <div className="flex gap-2 justify-end">
                <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
                <button
                    onClick={onConfirm}
                    disabled={busy}
                    className="px-4 py-2 rounded-lg text-sm bg-red-600 hover:bg-red-500 text-white font-medium disabled:opacity-50 flex items-center gap-2"
                >
                    {busy && <Loader2 size={14} className="animate-spin" />}
                    {confirmLabel}
                </button>
            </div>
        </Modal>
    );
}

// ─── Form fields ──────────────────────────────────────────────────────────
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-400">{label}</span>
            {children}
        </label>
    );
}

export const inputClass =
    'w-full rounded-lg bg-[color:var(--surface)] border border-[color:var(--line-strong)] px-3 py-2 text-sm text-[color:var(--text)] placeholder-[color:var(--faint)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-ring)] focus:border-brand-500';

// ─── Small hook for async form submit state ───────────────────────────────
export function useSubmit() {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const run = async (fn: () => Promise<void>) => {
        setBusy(true); setError(null);
        try { await fn(); }
        catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong'); throw e; }
        finally { setBusy(false); }
    };
    return { busy, error, setError, run };
}
