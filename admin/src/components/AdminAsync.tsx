'use client';

// Shared loading/error frame for admin route pages, plus a small hook that
// loads data on mount and exposes a reload() for mutations/refresh.

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { AdminContentSkeleton } from '@/components/ui/Skeleton';

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
                <AdminContentSkeleton />
            ) : children}
        </>
    );
}
