'use client';
import { apiFetch, apiUrl, clearSessionDrafts } from '@/lib/apiClient';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useSessionState } from '@/hooks/useSessionState';
import { PLAN_LABELS, PlanKey } from '@/lib/plans';
import {
    AssignmentCandidate,
    candidatesFromRows,
    createCandidate,
    emailPattern,
    parseCsvRows,
    parseXlsxRows,
} from '@/lib/candidateImport';
import {
    Briefcase, Plus, Users, BarChart2, Clock,
    LogOut, Loader2, AlertTriangle, Copy, Check, ExternalLink,
    TrendingUp, FileText, Zap, Send, X, User, Mail, UserCircle,
    FileSpreadsheet, Trash2, UserPlus, CreditCard
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
    plan?: PlanKey;
    planExpiresAt?: string | null;
    planActive?: boolean;
}

const isPlanLimitError = (data: { code?: string } | null | undefined) => data?.code === 'PLAN_LIMIT';

const InterviewerDashboard: React.FC = () => {
    const router = useRouter();
    const pathname = usePathname();
    const isStandalonePortal = process.env.NEXT_PUBLIC_PORTAL === 'interviewer' || !pathname?.startsWith('/interviewer');
    const portalPath = (path: string) => isStandalonePortal ? path : `/interviewer${path}`;
    const [interviewer, setInterviewer] = useState<InterviewerInfo | null>(null);
    const [studies, setStudies] = useState<StudySummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [generatingLink, setGeneratingLink] = useState<string | null>(null);
    const [studyLinks, setStudyLinks] = useState<Record<string, { url: string; createdAt: number }>>({});
    const [assigningStudyId, setAssigningStudyId] = useState<string | null>(null);
    const [assignmentStudy, setAssignmentStudy] = useState<StudySummary | null>(null);
    const [assignmentCandidates, setAssignmentCandidates, clearAssignmentCandidatesDraft] = useSessionState<AssignmentCandidate[]>('kalpira:interviewer-dashboard:assignment-candidates', [createCandidate()]);
    const [importFileName, setImportFileName, clearImportFileNameDraft] = useSessionState('kalpira:interviewer-dashboard:import-file-name', '');
    const [assignmentMessage, setAssignmentMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        const load = async () => {
            try {
                const [meRes, studiesRes] = await Promise.all([
                    apiFetch('/api/interviewer/me'),
                    apiFetch('/api/interviewer/studies'),
                ]);

                if (!meRes.ok) { router.push(portalPath('/login')); return; }

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router, isStandalonePortal]);

    const handleLogout = async () => {
        try {
            const res = await apiFetch('/api/auth', { method: 'DELETE' });
            if (!res.ok) {
                setError('Logout failed. Please try again.');
                return;
            }
        } catch {
            setError('Logout failed. Please try again.');
            return;
        }
        clearSessionDrafts();
        router.push(portalPath('/login'));
    };

    const handleGenerateLink = async (study: StudySummary) => {
        // Cached links go stale; re-issue if older than 10 minutes
        const LINK_TTL_MS = 10 * 60 * 1000;
        const cached = studyLinks[study.id];
        if (cached && Date.now() - cached.createdAt < LINK_TTL_MS) {
            navigator.clipboard.writeText(cached.url);
            setCopiedId(study.id);
            setTimeout(() => setCopiedId(null), 2000);
            return;
        }
        setGeneratingLink(study.id);
        try {
            const res = await apiFetch('/api/generate-link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studyConfig: { ...study.config, id: study.id } }),
            });
            if (res.ok) {
                const data = await res.json();
                setStudyLinks(prev => ({ ...prev, [study.id]: { url: data.url, createdAt: Date.now() } }));
                navigator.clipboard.writeText(data.url);
                setCopiedId(study.id);
                setTimeout(() => setCopiedId(null), 2000);
            }
        } catch { /* silent */ }
        finally { setGeneratingLink(null); }
    };

    const openAssignmentModal = (study: StudySummary) => {
        setAssignmentStudy(study);
        setAssignmentCandidates([createCandidate()]);
        setImportFileName('');
        setAssignmentMessage(null);
    };

    const closeAssignmentModal = () => {
        if (assigningStudyId) return;
        setAssignmentStudy(null);
        setAssignmentMessage(null);
    };

    const updateCandidate = (id: string, field: 'name' | 'email', value: string) => {
        setAssignmentCandidates(prev => prev.map(candidate =>
            candidate.id === id ? { ...candidate, [field]: value } : candidate
        ));
    };

    const addManualCandidate = () => {
        setAssignmentCandidates(prev => [...prev, createCandidate()]);
    };

    const removeCandidate = (id: string) => {
        setAssignmentCandidates(prev => prev.length > 1 ? prev.filter(candidate => candidate.id !== id) : prev);
    };

    const handleImportCandidates = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        setAssignmentMessage(null);
        setImportFileName(file.name);

        try {
            const extension = file.name.split('.').pop()?.toLowerCase();
            const rows = extension === 'csv'
                ? parseCsvRows(await file.text())
                : await parseXlsxRows(file);
            const imported = candidatesFromRows(rows);
            // Dedup imported rows by email (skip ones without an email)
            const importedByEmail = new Map<string, AssignmentCandidate>();
            for (const candidate of imported) {
                if (candidate.email) importedByEmail.set(candidate.email, candidate);
            }
            const unique = Array.from(importedByEmail.values());

            if (!unique.length) {
                setAssignmentCandidates([createCandidate('file')]);
                setAssignmentMessage({ type: 'error', text: 'No valid candidate names and emails found in the sheet.' });
                return;
            }

            setAssignmentCandidates(prev => {
                const hasManualData = prev.some(candidate => candidate.name.trim() || candidate.email.trim());
                const nextCandidates = hasManualData ? [...prev, ...unique] : unique;
                // Dedup: candidates with email collapse to one entry per email;
                // candidates without email are kept distinct via id
                const seen = new Map<string, AssignmentCandidate>();
                for (const candidate of nextCandidates) {
                    const key = candidate.email ? `email:${candidate.email}` : `id:${candidate.id}`;
                    seen.set(key, candidate);
                }
                return Array.from(seen.values());
            });
            setAssignmentMessage({ type: 'success', text: `Imported ${unique.length} candidate${unique.length !== 1 ? 's' : ''}.` });
        } catch {
            setAssignmentMessage({ type: 'error', text: 'Could not read that file. Upload an .xlsx or .csv with name and email columns.' });
        }
    };

    const handleAssignCandidate = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!assignmentStudy) return;

        const preparedCandidates = assignmentCandidates
            .map(candidate => ({
                candidateName: candidate.name.trim(),
                candidateEmail: candidate.email.trim().toLowerCase(),
            }))
            .filter(candidate => candidate.candidateName || candidate.candidateEmail);

        const invalidCandidate = preparedCandidates.find(candidate =>
            !candidate.candidateName || !emailPattern.test(candidate.candidateEmail)
        );

        if (!preparedCandidates.length || invalidCandidate) {
            setAssignmentMessage({ type: 'error', text: 'Add candidate names and valid emails before assigning.' });
            return;
        }

        setAssigningStudyId(assignmentStudy.id);
        setAssignmentMessage(null);
        try {
            const res = await apiFetch(`/api/interviewer/studies/${assignmentStudy.id}/assignments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ candidates: preparedCandidates }),
            });

            const data = await res.json();
            if (!res.ok) {
                setAssignmentMessage({
                    type: 'error',
                    text: isPlanLimitError(data) ? (data.error || 'Upgrade your plan to assign more candidates.') : (data.error || 'Failed to assign interview.'),
                });
                return;
            }

            const createdCount = data.createdCount ?? (data.reused ? 0 : 1);
            const reusedCount = data.reusedCount ?? (data.reused ? 1 : 0);
            const emailSentCount = data.emailSentCount ?? 0;
            const emailFailedCount = data.emailFailedCount ?? 0;

            if (createdCount > 0) {
                setStudies(prev => prev.map(study =>
                    study.id === assignmentStudy.id
                        ? { ...study, candidateCount: study.candidateCount + createdCount }
                        : study
                ));
            }

            setAssignmentMessage({
                type: emailFailedCount > 0 ? 'error' : 'success',
                text: `${createdCount} assigned${reusedCount ? `, ${reusedCount} already existed` : ''}${emailSentCount ? `, ${emailSentCount} email${emailSentCount !== 1 ? 's' : ''} sent` : ''}${emailFailedCount ? `, ${emailFailedCount} email${emailFailedCount !== 1 ? 's' : ''} failed` : ''}.`,
            });
            clearAssignmentCandidatesDraft();
            clearImportFileNameDraft();
        } catch {
            setAssignmentMessage({ type: 'error', text: 'Failed to assign interview.' });
        } finally {
            setAssigningStudyId(null);
        }
    };

    const scoreColor = (score: number) => {
        if (score >= 75) return 'text-emerald-400';
        if (score >= 50) return 'text-amber-400';
        return 'text-red-400';
    };

    if (isLoading) {
        return (
            <div className="app-shell min-h-screen flex items-center justify-center">
                <Loader2 size={40} className="animate-spin text-brand-500" />
            </div>
        );
    }

    const planKey = interviewer?.plan || 'free';
    const planLabel = PLAN_LABELS[planKey] || PLAN_LABELS.free;
    const planMeta = planKey === 'free'
        ? 'Trial limits'
        : interviewer?.planExpiresAt
            ? `Renews ${new Date(interviewer.planExpiresAt).toLocaleDateString()}`
            : 'Active plan';
    const assignmentNeedsUpgrade = assignmentMessage?.type === 'error' && assignmentMessage.text.toLowerCase().includes('upgrade');

    return (
        <div className="app-shell min-h-screen">

            <div className="relative max-w-7xl mx-auto px-4 py-8">
                {/* ── Top Bar ── */}
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-brand-500 flex items-center justify-center">
                            <Briefcase size={18} className="text-white" />
                        </div>
                        <div>
                            <p className="text-xs text-slate-500 uppercase tracking-wider">Interviewer Portal</p>
                            <p className="text-sm font-semibold text-slate-200">{interviewer?.name}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => router.push(portalPath('/billing'))}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-sm transition-colors border border-slate-700"
                        >
                            <CreditCard size={15} />
                            <span>{planLabel}</span>
                        </button>
                        <button
                            onClick={() => router.push(portalPath('/profile'))}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-sm transition-colors border border-slate-700"
                        >
                            <UserCircle size={15} /> Profile
                        </button>
                        <button onClick={handleLogout}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-sm transition-colors border border-slate-700">
                            <LogOut size={15} /> Sign out
                        </button>
                    </div>
                </div>

                {/* ── Stats Row ── */}
                <div className="grid grid-cols-2 gap-4 mb-8 lg:grid-cols-4">
                    {[
                        { label: 'Plan', value: planLabel, detail: planMeta, icon: CreditCard, color: 'text-amber-400' },
                        { label: 'Total Interviews', value: studies.length, icon: FileText, color: 'text-violet-400' },
                        { label: 'Total Candidates', value: studies.reduce((s, st) => s + st.candidateCount, 0), icon: Users, color: 'text-blue-400' },
                        {
                            label: 'Avg Score',
                            value: (() => {
                                const scored = studies.filter(st => st.averageScore > 0);
                                if (!scored.length) return '—';
                                const sum = scored.reduce((s, st) => s + st.averageScore, 0);
                                return `${Math.round(sum / scored.length)}%`;
                            })(),
                            icon: TrendingUp,
                            color: 'text-emerald-400'
                        },
                    ].map(stat => (
                        <div key={stat.label} className="surface p-5">
                            <div className="flex items-center gap-2 mb-2">
                                <stat.icon size={16} className={stat.color} />
                                <span className="text-xs text-slate-500">{stat.label}</span>
                            </div>
                            <p className="text-2xl font-bold text-white">{stat.value}</p>
                            {'detail' in stat && stat.detail && (
                                <p className="mt-1 text-xs text-slate-500">{stat.detail}</p>
                            )}
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
                        onClick={() => router.push(portalPath('/setup'))}
                        className="btn-primary px-4 py-2.5 text-sm">
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
                            <button onClick={() => router.push(portalPath('/setup'))}
                                className="btn-primary inline-flex px-5 py-2.5 text-sm">
                                <Zap size={16} /> Create First Interview
                            </button>
                        </motion.div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            {studies.map((study, i) => (
                                <motion.div key={study.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: i * 0.05 }}
                                    className="flex min-h-[250px] flex-col surface p-4 hover:border-brand-300 transition-colors">
                                    <div className="flex-1 min-w-0">
                                        <div className="mb-2 flex items-start justify-between gap-2">
                                            <h3 className="min-w-0 text-sm font-semibold leading-5 text-white line-clamp-2" title={study.config.name}>
                                                {study.config.name}
                                            </h3>
                                            <span className="px-2 py-0.5 text-xs bg-slate-800 text-slate-400 rounded-full capitalize flex-shrink-0">
                                                {study.config.aiBehavior}
                                            </span>
                                        </div>
                                        <p className="min-h-[2rem] text-xs leading-4 text-slate-500 line-clamp-2" title={study.config.researchQuestion}>
                                            {study.config.researchQuestion}
                                        </p>

                                        <div className="mt-4 grid gap-2">
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

                                    <div className="mt-4 grid grid-cols-3 gap-2">
                                        <button
                                            onClick={() => openAssignmentModal(study)}
                                            disabled={assigningStudyId === study.id}
                                            className="flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-2 py-2 text-xs text-slate-300 transition-colors hover:bg-slate-700 disabled:opacity-50"
                                        >
                                            {assigningStudyId === study.id ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                                            <span className="truncate">Assign</span>
                                        </button>

                                        {/* Copy link */}
                                        <button
                                            onClick={() => handleGenerateLink(study)}
                                            disabled={generatingLink === study.id}
                                            className="flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-2 py-2 text-xs text-slate-300 transition-colors hover:bg-slate-700 disabled:opacity-50">
                                            {generatingLink === study.id ? (
                                                <Loader2 size={13} className="animate-spin" />
                                            ) : copiedId === study.id ? (
                                                <Check size={13} className="text-emerald-400" />
                                            ) : (
                                                <Copy size={13} />
                                            )}
                                            <span className="truncate">{copiedId === study.id ? 'Copied!' : 'Copy'}</span>
                                        </button>

                                        {/* View candidates */}
                                        <button
                                            onClick={() => router.push(portalPath(`/studies/${study.id}`))}
                                            className="flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-[color:var(--line-strong)] bg-[color:var(--brand-soft)] px-2 py-2 text-xs text-[color:var(--brand-strong)] transition-colors hover:bg-[color:var(--brand-soft)]">
                                            <ExternalLink size={13} />
                                            <span className="truncate">Results</span>
                                        </button>
                                    </div>

                                    {/* Link preview */}
                                    {studyLinks[study.id] && (
                                        <div className="mt-3 pt-3 border-t border-slate-800">
                                            <p className="text-xs text-slate-600 font-mono truncate">{studyLinks[study.id].url}</p>
                                        </div>
                                    )}
                                </motion.div>
                            ))}
                        </div>
                    )}
                </AnimatePresence>
            </div>

            <AnimatePresence>
                {assignmentStudy && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--text)]/40 px-4"
                    >
                        <motion.form
                            initial={{ opacity: 0, y: 12, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 12, scale: 0.98 }}
                            onSubmit={handleAssignCandidate}
                            className="w-full max-w-3xl surface p-5 shadow-2xl shadow-black/40"
                        >
                            <div className="flex items-start justify-between gap-4 mb-5">
                                <div className="min-w-0">
                                    <p className="text-xs text-slate-500 uppercase tracking-wider">Assign Candidate</p>
                                    <h3 className="text-base font-semibold text-white truncate">{assignmentStudy.config.name}</h3>
                                </div>
                                <button
                                    type="button"
                                    onClick={closeAssignmentModal}
                                    disabled={!!assigningStudyId}
                                    className="p-2 rounded-xl text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50"
                                    aria-label="Close assignment form"
                                >
                                    <X size={16} />
                                </button>
                            </div>

                            <div className="mb-4 flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={addManualCandidate}
                                    disabled={!!assigningStudyId}
                                    className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
                                >
                                    <UserPlus size={14} /> Add candidate
                                </button>
                                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800">
                                    <FileSpreadsheet size={14} />
                                    {importFileName || 'Import sheet'}
                                    <input
                                        type="file"
                                        accept=".xlsx,.csv"
                                        onChange={handleImportCandidates}
                                        disabled={!!assigningStudyId}
                                        className="hidden"
                                    />
                                </label>
                            </div>

                            <div className="max-h-[42vh] overflow-y-auto pr-1">
                                <div className="space-y-3">
                                    {assignmentCandidates.map((candidate, index) => (
                                        <div key={candidate.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                                            <label className="block min-w-0">
                                                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-1.5">
                                                    <User size={13} /> Name
                                                </span>
                                                <input
                                                    type="text"
                                                    value={candidate.name}
                                                    onChange={event => updateCandidate(candidate.id, 'name', event.target.value)}
                                                    className="w-full px-4 py-3 rounded-xl bg-slate-800/70 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500 transition-colors text-sm"
                                                    placeholder={`Candidate ${index + 1}`}
                                                    autoFocus={index === 0}
                                                />
                                            </label>

                                            <label className="block min-w-0">
                                                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-1.5">
                                                    <Mail size={13} /> Email
                                                </span>
                                                <input
                                                    type="email"
                                                    value={candidate.email}
                                                    onChange={event => updateCandidate(candidate.id, 'email', event.target.value)}
                                                    className="w-full px-4 py-3 rounded-xl bg-slate-800/70 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500 transition-colors text-sm"
                                                    placeholder="candidate@example.com"
                                                />
                                            </label>

                                            <button
                                                type="button"
                                                onClick={() => removeCandidate(candidate.id)}
                                                disabled={!!assigningStudyId || assignmentCandidates.length === 1}
                                                className="h-[46px] w-full rounded-xl border border-slate-700 bg-slate-800/70 text-slate-500 transition-colors hover:bg-slate-800 hover:text-red-300 disabled:opacity-40 sm:mt-6 sm:w-[46px]"
                                                aria-label="Remove candidate"
                                            >
                                                <Trash2 size={16} className="mx-auto" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {assignmentMessage && (
                                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                                    <p className={`text-xs ${assignmentMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {assignmentMessage.text}
                                    </p>
                                    {assignmentNeedsUpgrade && (
                                        <button
                                            type="button"
                                            onClick={() => router.push(portalPath('/billing'))}
                                            className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--line-strong)] bg-[color:var(--brand-soft)] px-3 py-1.5 text-xs font-medium text-[color:var(--brand-strong)] hover:bg-[color:var(--brand-soft)]"
                                        >
                                            <CreditCard size={13} /> Upgrade
                                        </button>
                                    )}
                                </div>
                            )}

                            <div className="flex gap-3 mt-5">
                                <button
                                    type="button"
                                    onClick={closeAssignmentModal}
                                    disabled={!!assigningStudyId}
                                    className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm font-medium transition-colors disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={!!assigningStudyId}
                                    className="btn-primary flex-1 py-3 text-sm disabled:opacity-50"
                                >
                                    {assigningStudyId ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                    Assign{assignmentCandidates.filter(candidate => candidate.name.trim() && emailPattern.test(candidate.email.trim().toLowerCase())).length ? ` ${assignmentCandidates.filter(candidate => candidate.name.trim() && emailPattern.test(candidate.email.trim().toLowerCase())).length}` : ''}
                                </button>
                            </div>
                        </motion.form>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default InterviewerDashboard;
