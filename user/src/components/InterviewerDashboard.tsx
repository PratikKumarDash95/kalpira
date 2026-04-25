'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Briefcase, Plus, Users, BarChart2, Clock, ChevronRight,
    LogOut, Loader2, AlertTriangle, Copy, Check, ExternalLink,
    TrendingUp, FileText, Zap
} from 'lucide-react';

interface StudySummary {
    id: string;
    config: { name: string; researchQuestion: string; aiBehavior: string };
    candidateCount: number;
    completedCount: number;
    averageScore: number;
    createdAt: string;
}

interface InterviewerInfo {
    id: string;
    name: string;
    email: string;
}

const InterviewerDashboard: React.FC = () => {
    const router = useRouter();
    const [interviewer, setInterviewer] = useState<InterviewerInfo | null>(null);
    const [studies, setStudies] = useState<StudySummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [generatingLink, setGeneratingLink] = useState<string | null>(null);
    const [studyLinks, setStudyLinks] = useState<Record<string, string>>({});

    useEffect(() => {
        const load = async () => {
            try {
                const [meRes, studiesRes] = await Promise.all([
                    fetch('/api/interviewer/me'),
                    fetch('/api/interviewer/studies'),
                ]);

                if (!meRes.ok) { router.push('/interviewer/login'); return; }

                const meData = await meRes.json();
                setInterviewer(meData.user);

                if (studiesRes.ok) {
                    const studiesData = await studiesRes.json();
                    setStudies(studiesData.studies || []);
                }
            } catch {
                setError('Failed to load dashboard.');
            } finally {
                setIsLoading(false);
            }
        };
        load();
    }, [router]);

    const handleLogout = async () => {
        await fetch('/api/auth', { method: 'DELETE' });
        router.push('/interviewer/login');
    };

    const handleGenerateLink = async (study: StudySummary) => {
        if (studyLinks[study.id]) {
            // Already generated — just copy
            navigator.clipboard.writeText(studyLinks[study.id]);
            setCopiedId(study.id);
            setTimeout(() => setCopiedId(null), 2000);
            return;
        }
        setGeneratingLink(study.id);
        try {
            const res = await fetch('/api/generate-link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studyConfig: { ...study.config, id: study.id } }),
            });
            if (res.ok) {
                const data = await res.json();
                setStudyLinks(prev => ({ ...prev, [study.id]: data.url }));
                navigator.clipboard.writeText(data.url);
                setCopiedId(study.id);
                setTimeout(() => setCopiedId(null), 2000);
            }
        } catch { /* silent */ }
        finally { setGeneratingLink(null); }
    };

    const scoreColor = (score: number) => {
        if (score >= 75) return 'text-emerald-400';
        if (score >= 50) return 'text-amber-400';
        return 'text-red-400';
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <Loader2 size={40} className="animate-spin text-violet-400" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-950 text-white">
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute inset-0 bg-gradient-to-br from-violet-950/20 via-slate-950 to-indigo-950/10" />
                <div className="absolute top-0 right-1/4 w-96 h-96 bg-violet-600/5 rounded-full blur-3xl" />
            </div>

            <div className="relative max-w-5xl mx-auto px-4 py-8">
                {/* ── Top Bar ── */}
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center">
                            <Briefcase size={18} className="text-white" />
                        </div>
                        <div>
                            <p className="text-xs text-slate-500 uppercase tracking-wider">Interviewer Portal</p>
                            <p className="text-sm font-semibold text-slate-200">{interviewer?.name}</p>
                        </div>
                    </div>
                    <button onClick={handleLogout}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-sm transition-colors border border-slate-700">
                        <LogOut size={15} /> Sign out
                    </button>
                </div>

                {/* ── Stats Row ── */}
                <div className="grid grid-cols-3 gap-4 mb-8">
                    {[
                        { label: 'Total Interviews', value: studies.length, icon: FileText, color: 'text-violet-400' },
                        { label: 'Total Candidates', value: studies.reduce((s, st) => s + st.candidateCount, 0), icon: Users, color: 'text-blue-400' },
                        {
                            label: 'Avg Score',
                            value: studies.length > 0
                                ? `${Math.round(studies.reduce((s, st) => s + st.averageScore, 0) / studies.filter(st => st.averageScore > 0).length || 0)}%`
                                : '—',
                            icon: TrendingUp,
                            color: 'text-emerald-400'
                        },
                    ].map(stat => (
                        <div key={stat.label} className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
                            <div className="flex items-center gap-2 mb-2">
                                <stat.icon size={16} className={stat.color} />
                                <span className="text-xs text-slate-500">{stat.label}</span>
                            </div>
                            <p className="text-2xl font-bold text-white">{stat.value}</p>
                        </div>
                    ))}
                </div>

                {/* ── Error ── */}
                {error && (
                    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3">
                        <AlertTriangle size={18} className="text-red-400" />
                        <p className="text-sm text-red-400">{error}</p>
                    </div>
                )}

                {/* ── Studies Header ── */}
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-white">Your Interviews</h2>
                    <button
                        onClick={() => router.push('/interviewer/setup')}
                        className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-500 text-white font-medium rounded-xl transition-all text-sm shadow-lg shadow-violet-900/30">
                        <Plus size={16} /> Create Interview
                    </button>
                </div>

                {/* ── Studies List ── */}
                <AnimatePresence>
                    {studies.length === 0 ? (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                            className="bg-slate-900/40 border border-slate-800 border-dashed rounded-2xl p-12 text-center">
                            <Briefcase size={40} className="text-slate-700 mx-auto mb-4" />
                            <h3 className="text-slate-400 font-medium mb-2">No interviews yet</h3>
                            <p className="text-slate-600 text-sm mb-6">Create your first interview and share the link with candidates</p>
                            <button onClick={() => router.push('/interviewer/setup')}
                                className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm transition-all">
                                <Zap size={16} /> Create First Interview
                            </button>
                        </motion.div>
                    ) : (
                        <div className="space-y-4">
                            {studies.map((study, i) => (
                                <motion.div key={study.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: i * 0.05 }}
                                    className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-colors">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <h3 className="font-semibold text-white truncate">{study.config.name}</h3>
                                                <span className="px-2 py-0.5 text-xs bg-slate-800 text-slate-400 rounded-full capitalize flex-shrink-0">
                                                    {study.config.aiBehavior}
                                                </span>
                                            </div>
                                            <p className="text-sm text-slate-500 truncate">{study.config.researchQuestion}</p>

                                            <div className="flex items-center gap-4 mt-3">
                                                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                                    <Users size={13} />
                                                    <span>{study.candidateCount} candidate{study.candidateCount !== 1 ? 's' : ''}</span>
                                                </div>
                                                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                                    <BarChart2 size={13} />
                                                    <span className={study.averageScore > 0 ? scoreColor(study.averageScore) : 'text-slate-600'}>
                                                        {study.averageScore > 0 ? `${study.averageScore}% avg` : 'No scores yet'}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                                    <Clock size={13} />
                                                    <span>{new Date(study.createdAt).toLocaleDateString()}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            {/* Copy link */}
                                            <button
                                                onClick={() => handleGenerateLink(study)}
                                                disabled={generatingLink === study.id}
                                                className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-xl text-xs transition-colors disabled:opacity-50">
                                                {generatingLink === study.id ? (
                                                    <Loader2 size={13} className="animate-spin" />
                                                ) : copiedId === study.id ? (
                                                    <Check size={13} className="text-emerald-400" />
                                                ) : (
                                                    <Copy size={13} />
                                                )}
                                                {copiedId === study.id ? 'Copied!' : 'Copy Link'}
                                            </button>

                                            {/* View candidates */}
                                            <button
                                                onClick={() => router.push(`/interviewer/studies/${study.id}`)}
                                                className="flex items-center gap-1.5 px-3 py-2 bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 text-violet-300 rounded-xl text-xs transition-colors">
                                                <ExternalLink size={13} /> Results
                                                <ChevronRight size={13} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Link preview */}
                                    {studyLinks[study.id] && (
                                        <div className="mt-3 pt-3 border-t border-slate-800">
                                            <p className="text-xs text-slate-600 font-mono truncate">{studyLinks[study.id]}</p>
                                        </div>
                                    )}
                                </motion.div>
                            ))}
                        </div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default InterviewerDashboard;
