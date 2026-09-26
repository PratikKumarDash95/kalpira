'use client';

// Persistent admin chrome (sidebar + header) shared by every /admin route via
// the root layout. Navigation is real URL routing (next/link + usePathname),
// so reload and back/forward land on the same view instead of resetting to the
// dashboard — replacing the former single-page sessionStorage tab state.

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Users, Activity, BarChart3, Menu, X, Shield, LogOut, ChevronRight,
    UserCog, GraduationCap, MessageSquare, Gauge, Waves, Scale,
} from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { AdminShellSkeleton } from '@/components/ui/Skeleton';

type NavItem = { href: string; label: string; icon: React.ElementType };

const NAV: NavItem[] = [
    { href: '/', label: 'Overview', icon: BarChart3 },
    { href: '/candidates', label: 'Candidates', icon: Users },
    { href: '/interviewers', label: 'Interviewers', icon: UserCog },
    { href: '/studies', label: 'Studies', icon: GraduationCap },
    { href: '/sessions', label: 'Sessions', icon: Activity },
    { href: '/calibration', label: 'Calibration', icon: Gauge },
    { href: '/delivery-jobs', label: 'Delivery jobs', icon: Waves },
    { href: '/fairness', label: 'Fairness', icon: Scale },
    { href: '/feedback', label: 'Feedback', icon: MessageSquare },
];

// Clear cached admin UI drafts so a logged-out browser can't reveal them.
function clearAdminDrafts() {
    if (typeof window === 'undefined') return;
    try {
        const keys: string[] = [];
        for (let i = 0; i < window.sessionStorage.length; i++) {
            const key = window.sessionStorage.key(i);
            if (key && key.startsWith('kalpira:')) keys.push(key);
        }
        keys.forEach((k) => window.sessionStorage.removeItem(k));
    } catch {
        // storage unavailable — nothing to clear
    }
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname() || '/';
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // Admin-session gate: verify the caller is actually an admin BEFORE rendering
    // any admin chrome. A candidate/interviewer session (or logged-out browser)
    // gets the access screen below instead of the console. Server routes are
    // already protected; this stops the shell from rendering at all for them.
    //
    // Nothing here navigates off this origin. It used to set
    // `window.location.href = <main app>/login`, which made one portal able to
    // move the browser into another — a session valid on every port meant a
    // non-admin could be walked from the admin console into the candidate app
    // (and, via that app's own links, back again). Portals now only ever render
    // their own pages; a wrong-role visitor gets this screen.
    const [authState, setAuthState] = useState<'checking' | 'ok' | 'denied'>('checking');

    const checkAdmin = useCallback(async () => {
        try {
            const res = await apiFetch('/api/admin/me');
            setAuthState(res.ok ? 'ok' : 'denied');
        } catch {
            setAuthState('denied');
        }
    }, []);

    useEffect(() => {
        checkAdmin();
    }, [checkAdmin]);

    const handleSignOut = useCallback(async () => {
        try {
            await apiFetch('/api/auth', { method: 'DELETE' });
        } finally {
            clearAdminDrafts();
            setAuthState('denied');
        }
    }, []);

    if (authState === 'checking') {
        return <AdminShellSkeleton />;
    }

    if (authState === 'denied') {
        return <AdminAccessRequired onRetry={checkAdmin} onSignOut={handleSignOut} />;
    }

    const active = NAV.reduce((best, item) => {
        if (item.href === '/') return pathname === '/' ? item.href : best;
        return pathname === item.href || pathname.startsWith(`${item.href}/`) ? item.href : best;
    }, '/');
    const title = NAV.find((n) => n.href === active)?.label ?? 'Admin';

    return (
        <div className="app-shell min-h-screen flex">
            <AnimatePresence>
                {sidebarOpen && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-[color:var(--text)]/30 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
                )}
            </AnimatePresence>

            {/* Sidebar */}
            <aside className={`fixed lg:static inset-y-0 left-0 z-30 w-64 flex-shrink-0 bg-[color:var(--surface)] border-r border-[color:var(--line)] flex flex-col transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
                <div className="p-6 border-b border-[color:var(--line)]">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-brand-500 flex items-center justify-center shadow-[0_6px_16px_rgba(234,179,8,0.32)]">
                            <Shield size={18} className="text-white" />
                        </div>
                        <div>
                            <p className="font-bold text-[color:var(--text)] text-sm">Admin Panel</p>
                            <p className="text-xs text-[color:var(--muted)]">Kalpira</p>
                        </div>
                    </div>
                </div>
                <nav className="flex-1 p-4 space-y-1 overflow-auto">
                    {NAV.map((item) => {
                        const isActive = item.href === active;
                        return (
                            <Link key={item.href} href={item.href} onClick={() => setSidebarOpen(false)}
                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${isActive ? 'bg-[color:var(--brand-soft)] text-[color:var(--brand-strong)]' : 'text-[color:var(--muted)] hover:bg-[color:var(--surface-soft)] hover:text-[color:var(--text)]'}`}>
                                <item.icon size={16} />
                                {item.label}
                                {isActive && <ChevronRight size={14} className="ml-auto" />}
                            </Link>
                        );
                    })}
                </nav>
                <div className="p-4 border-t border-[color:var(--line)] space-y-2">
                    {/* No "Back to App" here. It jumped to the candidate app on
                        another port; that app is reachable by its own URL, and no
                        portal in this product navigates another one. */}
                    <button type="button" onClick={handleSignOut}
                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-[color:var(--danger)] hover:bg-[color:var(--danger-soft)] transition-all">
                        <LogOut size={16} /> Logout
                    </button>
                </div>
            </aside>

            {/* Main */}
            <div className="flex-1 flex flex-col min-w-0">
                <header className="sticky top-0 z-10 bg-[color:var(--surface)]/90 backdrop-blur-md border-b border-[color:var(--line)] px-4 sm:px-6 py-4 flex items-center gap-4">
                    <button type="button" onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-2 rounded-lg text-[color:var(--muted)] hover:bg-[color:var(--surface-soft)] hover:text-[color:var(--text)]">
                        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
                    </button>
                    <div className="flex-1">
                        <h1 className="text-lg font-bold text-[color:var(--text)] capitalize">{title}</h1>
                    </div>
                </header>

                <main className="flex-1 p-4 sm:p-6 overflow-auto">{children}</main>
            </div>
        </div>
    );
}

/**
 * Shown in place of the console when the browser has no admin session — a
 * candidate or interviewer session, or nobody signed in.
 *
 * Self-contained by design: the only actions are re-checking the session and
 * signing out, and neither leaves this origin. Signing in as an administrator
 * happens in the main Kalpira app, which this screen says in words rather than
 * navigating there.
 */
function AdminAccessRequired({
    onRetry,
    onSignOut,
}: {
    onRetry: () => void;
    onSignOut: () => void;
}) {
    return (
        <div className="app-shell min-h-screen grid place-items-center p-4 sm:p-6">
            <div className="surface w-full max-w-md rounded-2xl p-8 text-center">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-500 shadow-[0_6px_16px_rgba(234,179,8,0.32)]">
                    <Shield size={22} className="text-white" />
                </div>

                <h1 className="mt-5 text-lg font-bold text-[color:var(--text)]">Admin access required</h1>
                <p className="mt-2 text-sm text-[color:var(--muted)]">
                    This console only serves Kalpira administrators, and the browser is not signed in as one.
                    Sign in with an administrator account in the main Kalpira app, then try again.
                </p>

                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
                    <button type="button" onClick={onRetry} className="btn-primary px-5 py-2.5 text-sm font-semibold">
                        Try again
                    </button>
                    <button type="button" onClick={onSignOut} className="btn-secondary px-5 py-2.5 text-sm font-semibold">
                        Sign out
                    </button>
                </div>
            </div>
        </div>
    );
}
