'use client';

// Shared loading/error frame for admin route pages, plus a small hook that
// loads data on mount and exposes a reload() for mutations/refresh.

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

export function useAdminData<T>(loader: () => Promise<T>): {
    data: T | null; loading: boolean; error: string | null; reload: () => Promise<void>;
} {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setData(await loader());
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load admin data. Are you signed in as an admin?');
        } finally {
            setLoading(false);
        }
        // loader is recreated each render by callers; intentionally run once on mount + manual reload.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => { reload(); }, [reload]);

    return { data, loading, error, reload };
}

export function AdminAsync({ loading, error, onRetry, children }: {
    loading: boolean; error: string | null; onRetry: () => void; children: React.ReactNode;
}) {
    return (
        <>
            <div className="mb-4 flex items-center justify-end">
                <button type="button" onClick={onRetry} title="Refresh" className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white">
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {error && (
                <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex items-center justify-between">
                    <span>{error}</span>
                    <button type="button" onClick={onRetry} className="ml-3 text-red-400 hover:text-red-200" aria-label="Retry"><X size={14} /></button>
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center h-64">
                    <div className="flex flex-col items-center gap-3">
                        <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-slate-400 text-sm">Loading admin data…</p>
                    </div>
                </div>
            ) : children}
        </>
    );
}
