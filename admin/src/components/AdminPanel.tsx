'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Users, Activity, BookOpen, BarChart3, Trash2, Search, UserCog,
    Menu, X, Shield, LogOut, ChevronRight, Database, Zap, Star,
    Eye, Pencil, UserPlus, GraduationCap, MessageSquare, RefreshCw, CheckCircle, AlertCircle,
} from 'lucide-react';
import { useSessionState } from '@/hooks/useSessionState';
import {
    AdminApi, type Stats, type AdminUser, type Interviewer,
    type AdminStudy, type AdminSession, type FeedbackItem, type Role,
} from '@/lib/adminApi';
import { apiFetch } from '@/lib/apiClient';
import {
    RoleBadge, ConfirmDialog, formatDate, formatDateTime,
} from '@/components/adminShared';
import { CreateUserModal, EditUserModal, UserDetailModal } from '@/components/adminModals';

type Tab = 'overview' | 'candidates' | 'interviewers' | 'studies' | 'sessions' | 'feedback';

// ─── Animated counter ─────────────────────────────────────────────────────
function AnimatedNumber({ value }: { value: number }) {
    const [display, setDisplay] = useState(0);
    useEffect(() => {
        let start = 0;
        const end = value;
        if (start === end) { setDisplay(end); return; }
        const step = Math.max(1, Math.ceil(end / 60));
        const timer = setInterval(() => {
            start = Math.min(start + step, end);
            setDisplay(start);
            if (start >= end) clearInterval(timer);
        }, 16);
        return () => clearInterval(timer);
    }, [value]);
    return <span>{display.toLocaleString()}</span>;
}

function StatCard({ icon: Icon, label, value, sub, color, delay }: {
    icon: React.ElementType; label: string; value: number; sub?: string; color: string; delay: number;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }}
            className={`relative overflow-hidden rounded-2xl border bg-slate-900/80 backdrop-blur-sm p-5 ${color}`}
        >
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">{label}</p>
                    <p className="text-3xl font-bold text-white"><AnimatedNumber value={value} /></p>
                    {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
                </div>
                <div className="p-3 rounded-xl bg-slate-800/80"><Icon size={20} className="text-slate-300" /></div>
            </div>
        </motion.div>
    );
}

function Avatar({ name, email }: { name: string | null; email: string | null }) {
    return (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
            {(name?.[0] || email?.[0] || '?').toUpperCase()}
        </div>
    );
}

function Stars({ n }: { n: number }) {
    return (
        <span className="inline-flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((i) => (
                <Star key={i} size={12} className={i <= n ? 'text-amber-400 fill-amber-400' : 'text-slate-700'} />
            ))}
        </span>
    );
}

const tableWrap = 'rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden';
const th = 'text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider';

// ─── Main ─────────────────────────────────────────────────────────────────
export default function AdminPanel() {
    const mainAppUrl = process.env.NEXT_PUBLIC_MAIN_APP_URL || 'http://localhost:3000';
    const [activeTab, setActiveTab] = useSessionState<Tab>('kalpira:admin:active-tab', 'overview');
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const [stats, setStats] = useState<Stats | null>(null);
    const [candidates, setCandidates] = useState<AdminUser[]>([]);
    const [interviewers, setInterviewers] = useState<Interviewer[]>([]);
    const [studies, setStudies] = useState<AdminStudy[]>([]);
    const [sessions, setSessions] = useState<AdminSession[]>([]);
    const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
    const [avgRating, setAvgRating] = useState(0);

    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useSessionState('kalpira:admin:search', '');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Modal state
    const [createRole, setCreateRole] = useState<Role | null>(null);
    const [editUser, setEditUser] = useState<AdminUser | null>(null);
    const [detailUserId, setDetailUserId] = useState<string | null>(null);
    const [confirm, setConfirm] = useState<{ message: string; action: () => Promise<void> } | null>(null);
    const [confirmBusy, setConfirmBusy] = useState(false);

    const loadAll = useCallback(async () => {
        setLoading(true);
        setErrorMsg(null);
        try {
            const [s, c, iv, st, se, fb] = await Promise.all([
                AdminApi.stats(),
                AdminApi.users('candidate'),
                AdminApi.interviewers(),
                AdminApi.studies(),
                AdminApi.sessions(),
                AdminApi.feedback(),
            ]);
            setStats(s);
            setCandidates(c.users);
            setInterviewers(iv.interviewers);
            setStudies(st.studies);
            setSessions(se.sessions);
            setFeedback(fb.feedback);
            setAvgRating(fb.averageRating);
        } catch (e) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to load admin data. Are you signed in as an admin?');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadAll(); }, [loadAll]);

    const runConfirm = async () => {
        if (!confirm) return;
        setConfirmBusy(true);
        try {
            await confirm.action();
            setConfirm(null);
        } catch (e) {
            setErrorMsg(e instanceof Error ? e.message : 'Action failed');
        } finally {
            setConfirmBusy(false);
        }
    };

    const handleLogout = async () => {
        await apiFetch('/api/auth', { method: 'DELETE' });
        window.location.href = `${mainAppUrl}/login`;
    };

    const matches = (s: string) => {
        if (!search) return true;
        return s.toLowerCase().includes(search.toLowerCase());
    };

    const navItems: { id: Tab; label: string; icon: React.ElementType }[] = [
        { id: 'overview', label: 'Overview', icon: BarChart3 },
        { id: 'candidates', label: 'Candidates', icon: Users },
        { id: 'interviewers', label: 'Interviewers', icon: UserCog },
        { id: 'studies', label: 'Studies', icon: GraduationCap },
        { id: 'sessions', label: 'Sessions', icon: Activity },
        { id: 'feedback', label: 'Feedback', icon: MessageSquare },
    ];

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
                    {navItems.map((item) => (
                        <button key={item.id} onClick={() => { setActiveTab(item.id); setSidebarOpen(false); }}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === item.id ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                            <item.icon size={16} />
                            {item.label}
                            {activeTab === item.id && <ChevronRight size={14} className="ml-auto" />}
                        </button>
                    ))}
                </nav>
                <div className="p-4 border-t border-slate-800 space-y-2">
                    <button onClick={() => { window.location.href = `${mainAppUrl}/studies`; }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-all">
                        <Database size={16} /> Back to App
                    </button>
                    <button onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition-all">
                        <LogOut size={16} /> Logout
                    </button>
                </div>
            </aside>

            {/* Main */}
            <div className="flex-1 flex flex-col min-w-0">
                <header className="sticky top-0 z-10 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800 px-4 sm:px-6 py-4 flex items-center gap-4">
                    <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white">
                        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
                    </button>
                    <div className="flex-1">
                        <h1 className="text-lg font-bold text-white capitalize">{activeTab}</h1>
                    </div>
                    <button onClick={loadAll} title="Refresh" className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white">
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    </button>
                </header>

                <main className="flex-1 p-4 sm:p-6 overflow-auto">
                    {errorMsg && (
                        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex items-center justify-between">
                            <span>{errorMsg}</span>
                            <button onClick={() => setErrorMsg(null)} className="ml-3 text-red-400 hover:text-red-200" aria-label="Dismiss"><X size={14} /></button>
                        </div>
                    )}

                    {loading ? (
                        <div className="flex items-center justify-center h-64">
                            <div className="flex flex-col items-center gap-3">
                                <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                                <p className="text-slate-400 text-sm">Loading admin data…</p>
                            </div>
                        </div>
                    ) : (
                        <>
                            {activeTab === 'overview' && <Overview stats={stats} avgRating={avgRating} feedbackCount={feedback.length} go={setActiveTab} />}

                            {activeTab === 'candidates' && (
                                <UsersTable
                                    title="candidate" users={candidates.filter((u) => matches(u.name || '') || matches(u.email || ''))}
                                    search={search} setSearch={setSearch}
                                    onCreate={() => setCreateRole('candidate')}
                                    onEdit={setEditUser} onView={setDetailUserId}
                                    onDelete={(u) => setConfirm({
                                        message: `Delete ${u.name || u.email}? This removes their sessions, studies and related data permanently.`,
                                        action: async () => { await AdminApi.deleteUser(u.id); await loadAll(); },
                                    })}
                                />
                            )}

                            {activeTab === 'interviewers' && (
                                <InterviewersTable
                                    rows={interviewers.filter((u) => matches(u.name || '') || matches(u.email || ''))}
                                    search={search} setSearch={setSearch}
                                    onCreate={() => setCreateRole('interviewer')}
                                    onView={setDetailUserId}
                                    onEdit={(iv) => setEditUser({ id: iv.id, name: iv.name, email: iv.email, role: 'interviewer', oauthProvider: iv.oauthProvider, onboardingComplete: true, createdAt: iv.createdAt, _count: { interviewSessions: iv.totalInterviews, studies: iv.studiesCreated } })}
                                    onDelete={(iv) => setConfirm({
                                        message: `Delete interviewer ${iv.name || iv.email}? Their studies and assigned interviews will be affected.`,
                                        action: async () => { await AdminApi.deleteUser(iv.id); await loadAll(); },
                                    })}
                                />
                            )}

                            {activeTab === 'studies' && (
                                <StudiesTable
                                    rows={studies.filter((s) => matches(s.name) || matches(s.owner?.email || ''))}
                                    search={search} setSearch={setSearch}
                                    onDelete={(s) => setConfirm({
                                        message: `Delete study "${s.name}"? Stored interviews under it will be removed.`,
                                        action: async () => { await AdminApi.deleteStudy(s.id); await loadAll(); },
                                    })}
                                />
                            )}

                            {activeTab === 'sessions' && <SessionsTable rows={sessions} />}

                            {activeTab === 'feedback' && <FeedbackTable rows={feedback} avg={avgRating} />}
                        </>
                    )}
                </main>
            </div>

            {/* Modals */}
            {createRole && <CreateUserModal defaultRole={createRole} onClose={() => setCreateRole(null)} onCreated={loadAll} />}
            {editUser && <EditUserModal user={editUser} onClose={() => setEditUser(null)} onSaved={loadAll} />}
            {detailUserId && <UserDetailModal userId={detailUserId} onClose={() => setDetailUserId(null)} />}
            {confirm && <ConfirmDialog message={confirm.message} onConfirm={runConfirm} onCancel={() => setConfirm(null)} busy={confirmBusy} />}
        </div>
    );
}

// ─── Overview ─────────────────────────────────────────────────────────────
function Overview({ stats, avgRating, feedbackCount, go }: {
    stats: Stats | null; avgRating: number; feedbackCount: number; go: (t: Tab) => void;
}) {
    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={Users} label="Candidates" value={stats?.totalCandidates ?? 0} color="border-violet-500/20" delay={0} />
                <StatCard icon={UserCog} label="Interviewers" value={stats?.totalInterviewers ?? 0} color="border-blue-500/20" delay={0.05} />
                <StatCard icon={BookOpen} label="Studies" value={stats?.totalStudies ?? 0} sub={`${stats?.activeStudies ?? 0} active`} color="border-emerald-500/20" delay={0.1} />
                <StatCard icon={Activity} label="Interviews" value={stats?.totalSessions ?? 0} sub={`${stats?.activeInterviews ?? 0} active`} color="border-amber-500/20" delay={0.15} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
                    <div className="p-5 border-b border-slate-800 flex items-center gap-3">
                        <UserPlus size={16} className="text-violet-400" />
                        <h2 className="font-semibold text-white text-sm">Recent signups</h2>
                    </div>
                    <div className="divide-y divide-slate-800">
                        {(!stats || stats.recentUsers.length === 0) && <p className="p-5 text-slate-500 text-sm text-center">No users yet</p>}
                        {stats?.recentUsers.map((u) => (
                            <div key={u.id} className="flex items-center gap-4 p-4">
                                <Avatar name={u.name} email={u.email} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-white truncate">{u.name || 'Anonymous'}</p>
                                    <p className="text-xs text-slate-400 truncate">{u.email || 'No email'}</p>
                                </div>
                                <RoleBadge role={u.role} />
                                <p className="text-xs text-slate-500 hidden sm:block">{formatDate(u.createdAt)}</p>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                        <div className="flex items-center gap-2 mb-3"><Star size={16} className="text-amber-400" /><h3 className="text-sm font-semibold text-white">Interviewer feedback</h3></div>
                        <p className="text-3xl font-bold text-white">{avgRating ? avgRating.toFixed(1) : '—'}<span className="text-sm text-slate-500"> / 5</span></p>
                        <p className="text-xs text-slate-500 mt-1">{feedbackCount} review{feedbackCount !== 1 ? 's' : ''}</p>
                        <button onClick={() => go('feedback')} className="mt-3 text-xs text-violet-300 hover:text-violet-200 flex items-center gap-1">View all <ChevronRight size={12} /></button>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                        <div className="flex items-center gap-2 mb-3"><Zap size={16} className="text-yellow-400" /><h3 className="text-sm font-semibold text-white">Platform health</h3></div>
                        <div className="space-y-2">
                            {[{ label: 'Database', ok: true }, { label: 'Auth System', ok: true }, { label: 'AI Service', ok: true }].map((it) => (
                                <div key={it.label} className="flex items-center justify-between">
                                    <span className="text-xs text-slate-400">{it.label}</span>
                                    <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                                        {it.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />} {it.ok ? 'Healthy' : 'Down'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Search + create header ───────────────────────────────────────────────
function Toolbar({ search, setSearch, onCreate, createLabel }: {
    search: string; setSearch: (s: string) => void; onCreate?: () => void; createLabel?: string;
}) {
    return (
        <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input type="text" placeholder="Search by name or email…" value={search} onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
            </div>
            {onCreate && (
                <button onClick={onCreate} className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium">
                    <UserPlus size={16} /> {createLabel || 'Create'}
                </button>
            )}
        </div>
    );
}

function IconBtn({ onClick, title, children, danger }: { onClick: () => void; title: string; children: React.ReactNode; danger?: boolean }) {
    return (
        <button onClick={onClick} title={title} aria-label={title}
            className={`p-2 rounded-lg transition-all ${danger ? 'text-slate-500 hover:text-red-400 hover:bg-red-500/10' : 'text-slate-500 hover:text-violet-300 hover:bg-violet-500/10'}`}>
            {children}
        </button>
    );
}

// ─── Candidates / users table ─────────────────────────────────────────────
function UsersTable({ title, users, search, setSearch, onCreate, onEdit, onView, onDelete }: {
    title: string; users: AdminUser[]; search: string; setSearch: (s: string) => void;
    onCreate: () => void; onEdit: (u: AdminUser) => void; onView: (id: string) => void; onDelete: (u: AdminUser) => void;
}) {
    return (
        <div className="space-y-4">
            <Toolbar search={search} setSearch={setSearch} onCreate={onCreate} createLabel={`New ${title}`} />
            <div className={tableWrap}>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead><tr className="border-b border-slate-800 bg-slate-900/80">
                            <th className={th}>User</th>
                            <th className={`${th} hidden sm:table-cell`}>Auth</th>
                            <th className={`${th} hidden md:table-cell`}>Sessions</th>
                            <th className={`${th} hidden lg:table-cell`}>Joined</th>
                            <th className={`${th} text-right`}>Actions</th>
                        </tr></thead>
                        <tbody className="divide-y divide-slate-800">
                            {users.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">No {title}s found</td></tr>}
                            {users.map((u) => (
                                <tr key={u.id} className="hover:bg-slate-800/40">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <Avatar name={u.name} email={u.email} />
                                            <div className="min-w-0">
                                                <p className="font-medium text-white truncate text-sm">{u.name || 'Anonymous'}</p>
                                                <p className="text-xs text-slate-400 truncate">{u.email || '—'}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 hidden sm:table-cell">
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700/50 text-slate-400 border border-slate-600/20">
                                            {u.oauthProvider || 'Password'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 hidden md:table-cell text-slate-300">{u._count.interviewSessions}</td>
                                    <td className="px-4 py-3 hidden lg:table-cell text-slate-400 text-xs">{formatDate(u.createdAt)}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center justify-end gap-1">
                                            <IconBtn onClick={() => onView(u.id)} title="View detail"><Eye size={14} /></IconBtn>
                                            <IconBtn onClick={() => onEdit(u)} title="Edit"><Pencil size={14} /></IconBtn>
                                            <IconBtn onClick={() => onDelete(u)} title="Delete" danger><Trash2 size={14} /></IconBtn>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="px-4 py-3 border-t border-slate-800 bg-slate-900/40">
                    <p className="text-xs text-slate-500">{users.length} {title}{users.length !== 1 ? 's' : ''}</p>
                </div>
            </div>
        </div>
    );
}

// ─── Interviewers table (with scaling stats) ──────────────────────────────
function InterviewersTable({ rows, search, setSearch, onCreate, onView, onEdit, onDelete }: {
    rows: Interviewer[]; search: string; setSearch: (s: string) => void;
    onCreate: () => void; onView: (id: string) => void; onEdit: (iv: Interviewer) => void; onDelete: (iv: Interviewer) => void;
}) {
    return (
        <div className="space-y-4">
            <Toolbar search={search} setSearch={setSearch} onCreate={onCreate} createLabel="New interviewer" />
            <div className={tableWrap}>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead><tr className="border-b border-slate-800 bg-slate-900/80">
                            <th className={th}>Interviewer</th>
                            <th className={`${th} hidden sm:table-cell`}>Studies</th>
                            <th className={th}>Interviews</th>
                            <th className={`${th} hidden md:table-cell`}>Active now</th>
                            <th className={`${th} hidden lg:table-cell`}>Joined</th>
                            <th className={`${th} text-right`}>Actions</th>
                        </tr></thead>
                        <tbody className="divide-y divide-slate-800">
                            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">No interviewers found</td></tr>}
                            {rows.map((iv) => (
                                <tr key={iv.id} className="hover:bg-slate-800/40">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <Avatar name={iv.name} email={iv.email} />
                                            <div className="min-w-0">
                                                <p className="font-medium text-white truncate text-sm">{iv.name || 'Anonymous'}</p>
                                                <p className="text-xs text-slate-400 truncate">{iv.email || '—'}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 hidden sm:table-cell">
                                        <span className="text-slate-300">{iv.studiesCreated}</span>
                                        <span className="text-slate-500 text-xs"> ({iv.activeStudies} active)</span>
                                    </td>
                                    <td className="px-4 py-3 text-slate-300">{iv.totalInterviews}</td>
                                    <td className="px-4 py-3 hidden md:table-cell">
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${iv.activeInterviews > 0 ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20' : 'bg-slate-700/40 text-slate-400'}`}>
                                            {iv.activeInterviews}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 hidden lg:table-cell text-slate-400 text-xs">{formatDate(iv.createdAt)}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center justify-end gap-1">
                                            <IconBtn onClick={() => onView(iv.id)} title="View detail"><Eye size={14} /></IconBtn>
                                            <IconBtn onClick={() => onEdit(iv)} title="Edit"><Pencil size={14} /></IconBtn>
                                            <IconBtn onClick={() => onDelete(iv)} title="Delete" danger><Trash2 size={14} /></IconBtn>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="px-4 py-3 border-t border-slate-800 bg-slate-900/40">
                    <p className="text-xs text-slate-500">{rows.length} interviewer{rows.length !== 1 ? 's' : ''}</p>
                </div>
            </div>
        </div>
    );
}

// ─── Studies table ────────────────────────────────────────────────────────
function StudiesTable({ rows, search, setSearch, onDelete }: {
    rows: AdminStudy[]; search: string; setSearch: (s: string) => void; onDelete: (s: AdminStudy) => void;
}) {
    return (
        <div className="space-y-4">
            <Toolbar search={search} setSearch={setSearch} />
            <div className={tableWrap}>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead><tr className="border-b border-slate-800 bg-slate-900/80">
                            <th className={th}>Study</th>
                            <th className={`${th} hidden sm:table-cell`}>Owner</th>
                            <th className={th}>Interviews</th>
                            <th className={`${th} hidden md:table-cell`}>Status</th>
                            <th className={`${th} hidden lg:table-cell`}>Created</th>
                            <th className={`${th} text-right`}>Actions</th>
                        </tr></thead>
                        <tbody className="divide-y divide-slate-800">
                            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">No studies found</td></tr>}
                            {rows.map((s) => (
                                <tr key={s.id} className="hover:bg-slate-800/40">
                                    <td className="px-4 py-3">
                                        <p className="font-medium text-white text-sm truncate max-w-[220px]">{s.name}</p>
                                        {s.roleTitle && <p className="text-xs text-slate-400 truncate">{s.roleTitle}</p>}
                                    </td>
                                    <td className="px-4 py-3 hidden sm:table-cell">
                                        <p className="text-slate-300 text-sm truncate max-w-[160px]">{s.owner?.name || s.owner?.email || 'Unknown'}</p>
                                    </td>
                                    <td className="px-4 py-3 text-slate-300">
                                        {s.totalSessions}
                                        {s.activeSessions > 0 && <span className="text-amber-400 text-xs"> ({s.activeSessions} active)</span>}
                                    </td>
                                    <td className="px-4 py-3 hidden md:table-cell">
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.isLocked ? 'bg-slate-700/40 text-slate-400' : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'}`}>
                                            {s.isLocked ? 'locked' : 'open'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 hidden lg:table-cell text-slate-400 text-xs">{formatDate(s.createdAt)}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center justify-end">
                                            <IconBtn onClick={() => onDelete(s)} title="Delete" danger><Trash2 size={14} /></IconBtn>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="px-4 py-3 border-t border-slate-800 bg-slate-900/40">
                    <p className="text-xs text-slate-500">{rows.length} stud{rows.length !== 1 ? 'ies' : 'y'}</p>
                </div>
            </div>
        </div>
    );
}

// ─── Sessions table ───────────────────────────────────────────────────────
function SessionsTable({ rows }: { rows: AdminSession[] }) {
    return (
        <div className={tableWrap}>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead><tr className="border-b border-slate-800 bg-slate-900/80">
                        <th className={th}>Candidate</th>
                        <th className={`${th} hidden sm:table-cell`}>Role</th>
                        <th className={`${th} hidden sm:table-cell`}>Score</th>
                        <th className={th}>Status</th>
                        <th className={`${th} hidden lg:table-cell`}>Date</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-800">
                        {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">No sessions yet</td></tr>}
                        {rows.map((s) => (
                            <tr key={s.id} className="hover:bg-slate-800/40">
                                <td className="px-4 py-3">
                                    <p className="font-medium text-white text-sm">{s.candidateName || s.user?.name || 'Anonymous'}</p>
                                    <p className="text-xs text-slate-400 truncate">{s.candidateEmail || s.user?.email || '—'}</p>
                                </td>
                                <td className="px-4 py-3 hidden sm:table-cell text-slate-300 text-sm truncate max-w-[160px]">{s.role || 'General'}</td>
                                <td className="px-4 py-3 hidden sm:table-cell text-slate-300 text-sm">{s.averageScore ? `${s.averageScore.toFixed(1)}%` : 'N/A'}</td>
                                <td className="px-4 py-3">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.completedAt ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'}`}>
                                        {s.completedAt ? 'completed' : 'active'}
                                    </span>
                                </td>
                                <td className="px-4 py-3 hidden lg:table-cell text-slate-400 text-xs">{formatDate(s.startedAt)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="px-4 py-3 border-t border-slate-800 bg-slate-900/40">
                <p className="text-xs text-slate-500">{rows.length} session{rows.length !== 1 ? 's' : ''}</p>
            </div>
        </div>
    );
}

// ─── Feedback table ───────────────────────────────────────────────────────
function FeedbackTable({ rows, avg }: { rows: FeedbackItem[]; avg: number }) {
    return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-amber-500/10"><Star size={20} className="text-amber-400" /></div>
                <div>
                    <p className="text-2xl font-bold text-white">{avg ? avg.toFixed(1) : '—'} <span className="text-sm text-slate-500">/ 5</span></p>
                    <p className="text-xs text-slate-500">{rows.length} feedback entr{rows.length !== 1 ? 'ies' : 'y'} from candidates</p>
                </div>
            </div>
            <div className={tableWrap}>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead><tr className="border-b border-slate-800 bg-slate-900/80">
                            <th className={th}>Candidate</th>
                            <th className={`${th} hidden sm:table-cell`}>Interviewer</th>
                            <th className={th}>Rating</th>
                            <th className={`${th} hidden md:table-cell`}>Comment</th>
                            <th className={`${th} hidden lg:table-cell`}>Date</th>
                        </tr></thead>
                        <tbody className="divide-y divide-slate-800">
                            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">No feedback yet</td></tr>}
                            {rows.map((f) => (
                                <tr key={f.id} className="hover:bg-slate-800/40 align-top">
                                    <td className="px-4 py-3">
                                        <p className="font-medium text-white text-sm">{f.candidateName || 'Anonymous'}</p>
                                        <p className="text-xs text-slate-400 truncate">{f.candidateEmail || '—'}</p>
                                    </td>
                                    <td className="px-4 py-3 hidden sm:table-cell">
                                        <p className="text-slate-300 text-sm">{f.interviewer?.name || 'Unknown'}</p>
                                        <p className="text-xs text-slate-500 truncate">{f.interviewer?.email || '—'}</p>
                                    </td>
                                    <td className="px-4 py-3"><Stars n={f.rating} /></td>
                                    <td className="px-4 py-3 hidden md:table-cell text-slate-400 text-xs max-w-[280px]">{f.comment || '—'}</td>
                                    <td className="px-4 py-3 hidden lg:table-cell text-slate-500 text-xs">{formatDateTime(f.createdAt)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
