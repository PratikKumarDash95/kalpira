'use client';

// Persistent admin chrome (sidebar + header) shared by every /admin route via
// the root layout. Navigation is real URL routing (next/link + usePathname),
// so reload and back/forward land on the same view instead of resetting to the
// dashboard — replacing the former single-page sessionStorage tab state.

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Users, Activity, BarChart3, Menu, X, Shield, LogOut, ChevronRight,
    Database, UserCog, GraduationCap, MessageSquare,
} from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';

type NavItem = { href: string; label: string; icon: React.ElementType };

const NAV: NavItem[] = [
    { href: '/', label: 'Overview', icon: BarChart3 },
    { href: '/candidates', label: 'Candidates', icon: Users },
    { href: '/interviewers', label: 'Interviewers', icon: UserCog },
    { href: '/studies', label: 'Studies', icon: GraduationCap },
    { href: '/sessions', label: 'Sessions', icon: Activity },
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
    const mainAppUrl = process.env.NEXT_PUBLIC_MAIN_APP_URL || 'http://localhost:3000';

    // Admin-session gate: verify the caller is actually an admin BEFORE rendering
    // any admin chrome. A candidate/interviewer session (or logged-out browser)
    // is bounced to the main app login so the admin UI can't be viewed by simply
    // navigating to this app's URL. Server routes are already protected, but this
    // stops the shell from rendering at all for non-admins.
    const [authState, setAuthState] = useState<'checking' | 'ok' | 'denied'>('checking');

    useEffect(() => {
        let cancelled = false;
        apiFetch('/api/admin/me')
            .then((res) => {
                if (cancelled) return;
                if (res.ok) {
                    setAuthState('ok');
                } else {
                    setAuthState('denied');
                    window.location.href = `${mainAppUrl}/login`;
                }
            })
            .catch(() => {
                if (cancelled) return;
                setAuthState('denied');
                window.location.href = `${mainAppUrl}/login`;
            });
        return () => { cancelled = true; };
    }, [mainAppUrl]);

    if (authState !== 'ok') {
        return (
            <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
                <div className="flex items-center gap-3 text-slate-400 text-sm">
                    <Shield size={16} className="text-violet-400" />
                    {authState === 'denied' ? 'Redirecting to sign in…' : 'Verifying admin access…'}
                </div>
            </div>
        );
    }

    const active = NAV.reduce((best, item) => {
        if (item.href === '/') return pathname === '/' ? item.href : best;
        return pathname === item.href || pathname.startsWith(`${item.href}/`) ? item.href : best;
    }, '/');
    const title = NAV.find((n) => n.href === active)?.label ?? 'Admin';

    const handleLogout = async () => {
        try {
            await apiFetch('/api/auth', { method: 'DELETE' });
        } finally {
            clearAdminDrafts();
            window.location.href = `${mainAppUrl}/login`;
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 text-white flex">
            <AnimatePresence>
                {sidebarOpen && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/60 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
                )}
            </AnimatePresence>

            {/* Sidebar */}
            <aside className={`fixed lg:static inset-y-0 left-0 z-30 w-64 flex-shrink-0 bg-slate-900/95 backdrop-blur-xl border-r border-slate-800 flex flex-col transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
                <div className="p-6 border-b border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
                            <Shield size={18} className="text-white" />
                        </div>
                        <div>
                            <p className="font-bold text-white text-sm">Admin Panel</p>
                            <p className="text-xs text-slate-400">InterviewCoach</p>
                        </div>
                    </div>
                </div>
                <nav className="flex-1 p-4 space-y-1 overflow-auto">
                    {NAV.map((item) => {
                        const isActive = item.href === active;
                        return (
                            <Link key={item.href} href={item.href} onClick={() => setSidebarOpen(false)}
                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${isActive ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                                <item.icon size={16} />
                                {item.label}
                                {isActive && <ChevronRight size={14} className="ml-auto" />}
                            </Link>
                        );
                    })}
                </nav>
                <div className="p-4 border-t border-slate-800 space-y-2">
                    <button type="button" onClick={() => { window.location.href = `${mainAppUrl}/studies`; }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-all">
                        <Database size={16} /> Back to App
                    </button>
                    <button type="button" onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition-all">
                        <LogOut size={16} /> Logout
                    </button>
                </div>
            </aside>

            {/* Main */}
            <div className="flex-1 flex flex-col min-w-0">
                <header className="sticky top-0 z-10 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800 px-4 sm:px-6 py-4 flex items-center gap-4">
                    <button type="button" onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white">
                        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
                    </button>
                    <div className="flex-1">
                        <h1 className="text-lg font-bold text-white capitalize">{title}</h1>
                    </div>
                </header>

                <main className="flex-1 p-4 sm:p-6 overflow-auto">{children}</main>
            </div>
        </div>
    );
}
