'use client';

// Presentational admin views, extracted from the former single-page AdminPanel
// so each route segment (/candidates, /sessions, …) can render just its own
// table. These are pure/props-driven — data fetching lives in the route pages.

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
    Users, Activity, BookOpen, BarChart3, Trash2, Search, UserCog,
    ChevronRight, Zap, Star, Eye, Pencil, UserPlus, MessageSquare,
    CheckCircle, AlertCircle,
} from 'lucide-react';
import {
    type Stats, type AdminUser, type Interviewer,
    type AdminStudy, type AdminSession, type FeedbackItem,
} from '@/lib/adminApi';
import { RoleBadge, formatDate, formatDateTime } from '@/components/adminShared';

// ─── Animated counter ─────────────────────────────────────────────────────
export function AnimatedNumber({ value }: { value: number }) {
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

export function StatCard({ icon: Icon, label, value, sub, color, delay }: {
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

export function Avatar({ name, email }: { name: string | null; email: string | null }) {
    return (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
            {(name?.[0] || email?.[0] || '?').toUpperCase()}
        </div>
    );
}

export function Stars({ n }: { n: number }) {
    return (
        <span className="inline-flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((i) => (
                <Star key={i} size={12} className={i <= n ? 'text-amber-400 fill-amber-400' : 'text-slate-700'} />
            ))}
        </span>
    );
}

export const tableWrap = 'rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden';
export const th = 'text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider';

// ─── Search + create header ───────────────────────────────────────────────
export function Toolbar({ search, setSearch, onCreate, createLabel }: {
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
                <button type="button" onClick={onCreate} className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium">
                    <UserPlus size={16} /> {createLabel || 'Create'}
                </button>
            )}
        </div>
    );
}

export function IconBtn({ onClick, title, children, danger }: { onClick: () => void; title: string; children: React.ReactNode; danger?: boolean }) {
    return (
        <button type="button" onClick={onClick} title={title} aria-label={title}
            className={`p-2 rounded-lg transition-all ${danger ? 'text-slate-500 hover:text-red-400 hover:bg-red-500/10' : 'text-slate-500 hover:text-violet-300 hover:bg-violet-500/10'}`}>
            {children}
        </button>
    );
}

// ─── Overview ─────────────────────────────────────────────────────────────
export function Overview({ stats, avgRating, feedbackCount }: {
    stats: Stats | null; avgRating: number; feedbackCount: number;
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
                        <Link href="/feedback" className="mt-3 text-xs text-violet-300 hover:text-violet-200 flex items-center gap-1">View all <ChevronRight size={12} /></Link>
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

// ─── Candidates / users table ─────────────────────────────────────────────
export function UsersTable({ title, users, search, setSearch, onCreate, onEdit, onView, onDelete }: {
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
export function InterviewersTable({ rows, search, setSearch, onCreate, onView, onEdit, onDelete }: {
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
export function StudiesTable({ rows, search, setSearch, onDelete }: {
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
export function SessionsTable({ rows }: { rows: AdminSession[] }) {
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
export function FeedbackTable({ rows, avg }: { rows: FeedbackItem[]; avg: number }) {
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
