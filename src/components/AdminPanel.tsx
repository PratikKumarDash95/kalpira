'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Users, Activity, BookOpen, BarChart3, Trash2, Search,
    Menu, X, Shield, LogOut, ChevronRight, Clock, CheckCircle,
    AlertCircle, TrendingUp, Database, Zap
} from 'lucide-react';
import { useRouter } from 'next/navigation';

// ─── Types ───────────────────────────────────────────────────────────────────
interface Stats {
    totalUsers: number;
    totalStudies: number;
    totalSessions: number;
    recentUsers: { id: string; name: string | null; email: string | null; createdAt: string }[];
}

interface User {
    id: string;
    name: string | null;
    email: string | null;
    oauthProvider: string | null;
    onboardingComplete: boolean;
    createdAt: string;
    _count: { interviewSessions: number; studies: number };
}

interface Session {
    id: string;
    startedAt: string;
    completedAt: string | null;
    averageScore: number;
    role: string;
    user: { name: string | null; email: string | null } | null;
}

// ─── Animated Counter ─────────────────────────────────────────────────────────
function AnimatedNumber({ value }: { value: number }) {
    const [display, setDisplay] = useState(0);
    useEffect(() => {
        let start = 0;
        const end = value;
        if (start === end) return;
        const duration = 1000;
        const step = Math.ceil(end / (duration / 16));
        const timer = setInterval(() => {
            start = Math.min(start + step, end);
            setDisplay(start);
            if (start >= end) clearInterval(timer);
        }, 16);
        return () => clearInterval(timer);
    }, [value]);
    return <span>{display.toLocaleString()}</span>;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, color, delay }: {
    icon: React.ElementType; label: string; value: number; color: string; delay: number;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay, duration: 0.4 }}
            className={`relative overflow-hidden rounded-2xl border bg-slate-900/80 backdrop-blur-sm p-5 ${color}`}
        >
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">{label}</p>
                    <p className="text-3xl font-bold text-white">
                        <AnimatedNumber value={value} />
                    </p>
                </div>
                <div className={`p-3 rounded-xl bg-slate-800/80`}>
                    <Icon size={20} className="text-slate-300" />
                </div>
            </div>
            {/* Glow effect */}
            <div className="absolute -bottom-4 -right-4 w-24 h-24 rounded-full opacity-10 blur-2xl bg-current" />
        </motion.div>
    );
}

// ─── Main Admin Panel ─────────────────────────────────────────────────────────
type Tab = 'overview' | 'users' | 'sessions';

export default function AdminPanel() {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<Tab>('overview');
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [stats, setStats] = useState<Stats | null>(null);
    const [users, setUsers] = useState<User[]>([]);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const fetchStats = useCallback(async () => {
        const res = await fetch('/api/admin/stats');
        if (res.ok) setStats(await res.json());
    }, []);

    const fetchUsers = useCallback(async () => {
        const res = await fetch('/api/admin/users');
        if (res.ok) {
            const data = await res.json();
            setUsers(data.users || []);
        }
    }, []);

    const fetchSessions = useCallback(async () => {
        const res = await fetch('/api/admin/sessions');
        if (res.ok) {
            const data = await res.json();
            setSessions(data.sessions || []);
        }
    }, []);

    useEffect(() => {
        Promise.all([fetchStats(), fetchUsers(), fetchSessions()]).finally(() =>
            setLoading(false)
        );
    }, [fetchStats, fetchUsers, fetchSessions]);

    const handleDeleteUser = async (userId: string) => {
        if (!confirm('Are you sure you want to delete this user? This cannot be undone.')) return;
        setDeletingId(userId);
        const res = await fetch('/api/admin/users', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId }),
        });
        if (res.ok) {
            setUsers(prev => prev.filter(u => u.id !== userId));
            if (stats) setStats({ ...stats, totalUsers: stats.totalUsers - 1 });
        }
        setDeletingId(null);
    };

    const handleLogout = async () => {
        await fetch('/api/auth', { method: 'DELETE' });
        router.push('/login');
    };

    const filteredUsers = users.filter(u =>
    (u.name?.toLowerCase().includes(search.toLowerCase()) ||
        u.email?.toLowerCase().includes(search.toLowerCase()))
    );

    const navItems: { id: Tab; label: string; icon: React.ElementType }[] = [
        { id: 'overview', label: 'Overview', icon: BarChart3 },
        { id: 'users', label: 'Users', icon: Users },
        { id: 'sessions', label: 'Sessions', icon: Activity },
    ];

    const formatDate = (d: string) =>
        new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    const formatDuration = (start: string, end: string | null) => {
        if (!end) return 'Ongoing';
        const ms = new Date(end).getTime() - new Date(start).getTime();
        const mins = Math.floor(ms / 60000);
        return `${mins}m`;
    };

    return (
        <div className="min-h-screen bg-slate-950 text-white flex">
            {/* ── Sidebar ── */}
            <AnimatePresence>
                {(sidebarOpen || true) && (
                    <>
                        {/* Mobile overlay */}
                        {sidebarOpen && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="fixed inset-0 bg-black/60 z-20 lg:hidden"
                                onClick={() => setSidebarOpen(false)}
                            />
                        )}

                        <motion.aside
                            initial={false}
                            className={`
                fixed lg:static inset-y-0 left-0 z-30 w-64 flex-shrink-0
                bg-slate-900/95 backdrop-blur-xl border-r border-slate-800
                flex flex-col transition-transform duration-300
                ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
              `}
                        >
                            {/* Logo */}
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

                            {/* Nav */}
                            <nav className="flex-1 p-4 space-y-1">
                                {navItems.map(item => (
                                    <button
                                        key={item.id}
                                        onClick={() => { setActiveTab(item.id); setSidebarOpen(false); }}
                                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === item.id
                                            ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30'
                                            : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                                            }`}
                                    >
                                        <item.icon size={16} />
                                        {item.label}
                                        {activeTab === item.id && (
                                            <ChevronRight size={14} className="ml-auto" />
                                        )}
                                    </button>
                                ))}
                            </nav>

                            {/* Footer */}
                            <div className="p-4 border-t border-slate-800 space-y-2">
                                <button
                                    onClick={() => router.push('/studies')}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-all"
                                >
                                    <Database size={16} />
                                    Back to App
                                </button>
                                <button
                                    onClick={handleLogout}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition-all"
                                >
                                    <LogOut size={16} />
                                    Logout
                                </button>
                            </div>
                        </motion.aside>
                    </>
                )}
            </AnimatePresence>

            {/* ── Main Content ── */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Header */}
                <header className="sticky top-0 z-10 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800 px-4 sm:px-6 py-4 flex items-center gap-4">
                    <button
                        onClick={() => setSidebarOpen(!sidebarOpen)}
                        className="lg:hidden p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-all"
                    >
                        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
                    </button>
                    <div className="flex-1">
                        <h1 className="text-lg font-bold text-white capitalize">{activeTab}</h1>
                        <p className="text-xs text-slate-500 hidden sm:block">
                            {activeTab === 'overview' && 'Platform statistics and recent activity'}
                            {activeTab === 'users' && 'Manage registered users'}
                            {activeTab === 'sessions' && 'View all interview sessions'}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-xs text-slate-400 hidden sm:block">Live</span>
                    </div>
                </header>

                {/* Content */}
                <main className="flex-1 p-4 sm:p-6 overflow-auto">
                    {loading ? (
                        <div className="flex items-center justify-center h-64">
                            <div className="flex flex-col items-center gap-3">
                                <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                                <p className="text-slate-400 text-sm">Loading admin data...</p>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* ── OVERVIEW TAB ── */}
                            {activeTab === 'overview' && (
                                <div className="space-y-6">
                                    {/* Stats Grid */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                        <StatCard icon={Users} label="Total Users" value={stats?.totalUsers ?? 0} color="border-violet-500/20" delay={0} />
                                        <StatCard icon={BookOpen} label="Studies Created" value={stats?.totalStudies ?? 0} color="border-blue-500/20" delay={0.1} />
                                        <StatCard icon={Activity} label="Interview Sessions" value={stats?.totalSessions ?? 0} color="border-emerald-500/20" delay={0.2} />
                                    </div>

                                    {/* Recent Users */}
                                    <motion.div
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: 0.3 }}
                                        className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm overflow-hidden"
                                    >
                                        <div className="p-5 border-b border-slate-800 flex items-center gap-3">
                                            <TrendingUp size={16} className="text-violet-400" />
                                            <h2 className="font-semibold text-white text-sm">Recent Signups</h2>
                                        </div>
                                        <div className="divide-y divide-slate-800">
                                            {stats?.recentUsers.length === 0 && (
                                                <p className="p-5 text-slate-500 text-sm text-center">No users yet</p>
                                            )}
                                            {stats?.recentUsers.map(u => (
                                                <div key={u.id} className="flex items-center gap-4 p-4 hover:bg-slate-800/40 transition-colors">
                                                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-sm font-bold flex-shrink-0">
                                                        {(u.name?.[0] || u.email?.[0] || '?').toUpperCase()}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium text-white truncate">{u.name || 'Anonymous'}</p>
                                                        <p className="text-xs text-slate-400 truncate">{u.email || 'No email'}</p>
                                                    </div>
                                                    <p className="text-xs text-slate-500 flex-shrink-0">{formatDate(u.createdAt)}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </motion.div>

                                    {/* Quick Stats */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <motion.div
                                            initial={{ opacity: 0, y: 20 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: 0.4 }}
                                            className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5"
                                        >
                                            <div className="flex items-center gap-2 mb-3">
                                                <Zap size={16} className="text-yellow-400" />
                                                <h3 className="text-sm font-semibold text-white">Platform Health</h3>
                                            </div>
                                            <div className="space-y-2">
                                                {[
                                                    { label: 'Database', status: 'Connected', ok: true },
                                                    { label: 'Auth System', status: 'Active', ok: true },
                                                    { label: 'AI Service', status: 'Running', ok: true },
                                                ].map(item => (
                                                    <div key={item.label} className="flex items-center justify-between">
                                                        <span className="text-xs text-slate-400">{item.label}</span>
                                                        <div className="flex items-center gap-1.5">
                                                            {item.ok
                                                                ? <CheckCircle size={12} className="text-emerald-400" />
                                                                : <AlertCircle size={12} className="text-red-400" />}
                                                            <span className={`text-xs font-medium ${item.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                                                                {item.status}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </motion.div>

                                        <motion.div
                                            initial={{ opacity: 0, y: 20 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: 0.5 }}
                                            className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5"
                                        >
                                            <div className="flex items-center gap-2 mb-3">
                                                <Clock size={16} className="text-blue-400" />
                                                <h3 className="text-sm font-semibold text-white">Quick Actions</h3>
                                            </div>
                                            <div className="space-y-2">
                                                <button
                                                    onClick={() => setActiveTab('users')}
                                                    className="w-full text-left text-xs text-slate-300 hover:text-white px-3 py-2 rounded-lg hover:bg-slate-800 transition-all flex items-center justify-between"
                                                >
                                                    Manage Users <ChevronRight size={12} />
                                                </button>
                                                <button
                                                    onClick={() => setActiveTab('sessions')}
                                                    className="w-full text-left text-xs text-slate-300 hover:text-white px-3 py-2 rounded-lg hover:bg-slate-800 transition-all flex items-center justify-between"
                                                >
                                                    View Sessions <ChevronRight size={12} />
                                                </button>
                                                <button
                                                    onClick={() => router.push('/studies')}
                                                    className="w-full text-left text-xs text-slate-300 hover:text-white px-3 py-2 rounded-lg hover:bg-slate-800 transition-all flex items-center justify-between"
                                                >
                                                    Go to Dashboard <ChevronRight size={12} />
                                                </button>
                                            </div>
                                        </motion.div>
                                    </div>
                                </div>
                            )}

                            {/* ── USERS TAB ── */}
                            {activeTab === 'users' && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="space-y-4"
                                >
                                    {/* Search */}
                                    <div className="relative">
                                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                        <input
                                            type="text"
                                            placeholder="Search by name or email..."
                                            value={search}
                                            onChange={e => setSearch(e.target.value)}
                                            className="w-full pl-9 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50"
                                        />
                                    </div>

                                    {/* Table */}
                                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <thead>
                                                    <tr className="border-b border-slate-800 bg-slate-900/80">
                                                        <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">User</th>
                                                        <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider hidden sm:table-cell">Auth</th>
                                                        <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider hidden md:table-cell">Sessions</th>
                                                        <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider hidden lg:table-cell">Joined</th>
                                                        <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-800">
                                                    {filteredUsers.length === 0 && (
                                                        <tr>
                                                            <td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">
                                                                No users found
                                                            </td>
                                                        </tr>
                                                    )}
                                                    {filteredUsers.map(user => (
                                                        <tr key={user.id} className="hover:bg-slate-800/40 transition-colors">
                                                            <td className="px-4 py-3">
                                                                <div className="flex items-center gap-3">
                                                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                                                        {(user.name?.[0] || user.email?.[0] || '?').toUpperCase()}
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <p className="font-medium text-white truncate text-sm">{user.name || 'Anonymous'}</p>
                                                                        <p className="text-xs text-slate-400 truncate">{user.email || '—'}</p>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 hidden sm:table-cell">
                                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${user.oauthProvider
                                                                    ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                                                    : 'bg-slate-700/50 text-slate-400 border border-slate-600/20'
                                                                    }`}>
                                                                    {user.oauthProvider || 'Password'}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3 hidden md:table-cell">
                                                                <span className="text-slate-300">{user._count.interviewSessions}</span>
                                                            </td>
                                                            <td className="px-4 py-3 hidden lg:table-cell">
                                                                <span className="text-slate-400 text-xs">{formatDate(user.createdAt)}</span>
                                                            </td>
                                                            <td className="px-4 py-3 text-right">
                                                                <button
                                                                    onClick={() => handleDeleteUser(user.id)}
                                                                    disabled={deletingId === user.id}
                                                                    className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
                                                                    title="Delete user"
                                                                >
                                                                    {deletingId === user.id
                                                                        ? <div className="w-4 h-4 border border-red-400 border-t-transparent rounded-full animate-spin" />
                                                                        : <Trash2 size={14} />}
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="px-4 py-3 border-t border-slate-800 bg-slate-900/40">
                                            <p className="text-xs text-slate-500">{filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''} found</p>
                                        </div>
                                    </div>
                                </motion.div>
                            )}

                            {/* ── SESSIONS TAB ── */}
                            {activeTab === 'sessions' && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden"
                                >
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b border-slate-800 bg-slate-900/80">
                                                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Candidate</th>
                                                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider hidden sm:table-cell">Role</th>
                                                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider hidden sm:table-cell">Score</th>
                                                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider hidden md:table-cell">Duration</th>
                                                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
                                                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider hidden lg:table-cell">Date</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-800">
                                                {sessions.length === 0 && (
                                                    <tr>
                                                        <td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">
                                                            No sessions yet
                                                        </td>
                                                    </tr>
                                                )}
                                                {sessions.map(session => (
                                                    <tr key={session.id} className="hover:bg-slate-800/40 transition-colors">
                                                        <td className="px-4 py-3">
                                                            <div>
                                                                <p className="font-medium text-white text-sm">{session.user?.name || 'Anonymous'}</p>
                                                                <p className="text-xs text-slate-400 truncate">{session.user?.email || '—'}</p>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3 hidden sm:table-cell">
                                                            <p className="text-slate-300 text-sm truncate max-w-[160px]">
                                                                {session.role || 'General'}
                                                            </p>
                                                        </td>
                                                        <td className="px-4 py-3 hidden sm:table-cell">
                                                            <span className="text-slate-300 text-sm">
                                                                {session.averageScore ? `${session.averageScore.toFixed(1)}%` : 'N/A'}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 hidden md:table-cell">
                                                            <span className="text-slate-400 text-xs">
                                                                {formatDuration(session.startedAt, session.completedAt)}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${session.completedAt
                                                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                                                    : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                                                }`}>
                                                                {session.completedAt ? 'completed' : 'active'}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 hidden lg:table-cell">
                                                            <span className="text-slate-400 text-xs">{formatDate(session.startedAt)}</span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="px-4 py-3 border-t border-slate-800 bg-slate-900/40">
                                        <p className="text-xs text-slate-500">{sessions.length} session{sessions.length !== 1 ? 's' : ''} total</p>
                                    </div>
                                </motion.div>
                            )}
                        </>
                    )}
                </main>
            </div>
        </div>
    );
}
