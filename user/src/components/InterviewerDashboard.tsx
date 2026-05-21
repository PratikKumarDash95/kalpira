'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import JSZip from 'jszip';
import {
    Briefcase, Plus, Users, BarChart2, Clock, ChevronRight,
    LogOut, Loader2, AlertTriangle, Copy, Check, ExternalLink,
    TrendingUp, FileText, Zap, Send, X, User, Mail, UserCircle,
    FileSpreadsheet, Trash2, UserPlus
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

interface AssignmentCandidate {
    id: string;
    name: string;
    email: string;
    source: 'manual' | 'file';
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const createCandidate = (source: AssignmentCandidate['source'] = 'manual'): AssignmentCandidate => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: '',
    email: '',
    source,
});

const normalizeCell = (value: string) => value.replace(/\s+/g, ' ').trim();

const parseXml = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');

const columnIndexFromRef = (cellRef: string) => {
    const letters = cellRef.replace(/[0-9]/g, '').toUpperCase();
    return letters.split('').reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
};

const parseCsvRows = (text: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = text[index + 1];

        if (char === '"' && quoted && next === '"') {
            cell += '"';
            index += 1;
        } else if (char === '"') {
            quoted = !quoted;
        } else if (char === ',' && !quoted) {
            row.push(normalizeCell(cell));
            cell = '';
        } else if ((char === '\n' || char === '\r') && !quoted) {
            if (char === '\r' && next === '\n') index += 1;
            row.push(normalizeCell(cell));
            if (row.some(Boolean)) rows.push(row);
            row = [];
            cell = '';
        } else {
            cell += char;
        }
    }

    row.push(normalizeCell(cell));
    if (row.some(Boolean)) rows.push(row);
    return rows;
};

const parseXlsxRows = async (file: File): Promise<string[][]> => {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('string');
    const sharedStrings = sharedXml
        ? Array.from(parseXml(sharedXml).getElementsByTagName('si')).map(item =>
            normalizeCell(Array.from(item.getElementsByTagName('t')).map(node => node.textContent || '').join(''))
        )
        : [];

    const sheetPath = zip.file('xl/worksheets/sheet1.xml')
        ? 'xl/worksheets/sheet1.xml'
        : Object.keys(zip.files).find(path => /^xl\/worksheets\/sheet\d+\.xml$/.test(path));

    if (!sheetPath) return [];

    const sheetXml = await zip.file(sheetPath)?.async('string');
    if (!sheetXml) return [];

    const sheet = parseXml(sheetXml);
    return Array.from(sheet.getElementsByTagName('row')).map(rowNode => {
        const row: string[] = [];

        Array.from(rowNode.getElementsByTagName('c')).forEach(cellNode => {
            const ref = cellNode.getAttribute('r') || '';
            const type = cellNode.getAttribute('t');
            const index = ref ? columnIndexFromRef(ref) : row.length;
            const valueNode = cellNode.getElementsByTagName('v')[0];
            const inlineNode = cellNode.getElementsByTagName('t')[0];
            const rawValue = valueNode?.textContent || inlineNode?.textContent || '';
            const value = type === 's' ? sharedStrings[Number(rawValue)] || '' : rawValue;
            row[index] = normalizeCell(value);
        });

        return row.map(cell => cell || '');
    }).filter(row => row.some(Boolean));
};

const candidatesFromRows = (rows: string[][]): AssignmentCandidate[] => {
    if (!rows.length) return [];

    const header = rows[0].map(cell => cell.toLowerCase());
    const headerHasLabels = header.some(cell => cell.includes('name') || cell.includes('email') || cell.includes('mail'));
    const nameIndex = header.findIndex(cell => cell.includes('name') || cell.includes('candidate'));
    const emailIndex = header.findIndex(cell => cell.includes('email') || cell.includes('mail'));
    const dataRows = headerHasLabels ? rows.slice(1) : rows;

    return dataRows.flatMap(row => {
        const detectedEmailIndex = emailIndex >= 0 ? emailIndex : row.findIndex(cell => emailPattern.test(cell.toLowerCase()));
        if (detectedEmailIndex < 0) return [];

        const detectedNameIndex = nameIndex >= 0
            ? nameIndex
            : row.findIndex((cell, index) => index !== detectedEmailIndex && cell && !emailPattern.test(cell.toLowerCase()));

        const name = normalizeCell(row[detectedNameIndex] || '');
        const email = normalizeCell(row[detectedEmailIndex] || '').toLowerCase();

        if (!name || !emailPattern.test(email)) return [];
        return [{ ...createCandidate('file'), name, email }];
    });
};

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
    const [studyLinks, setStudyLinks] = useState<Record<string, string>>({});
    const [assigningStudyId, setAssigningStudyId] = useState<string | null>(null);
    const [assignmentStudy, setAssignmentStudy] = useState<StudySummary | null>(null);
    const [assignmentCandidates, setAssignmentCandidates] = useState<AssignmentCandidate[]>([createCandidate()]);
    const [importFileName, setImportFileName] = useState('');
    const [assignmentMessage, setAssignmentMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        const load = async () => {
            try {
                const [meRes, studiesRes] = await Promise.all([
                    fetch('/api/interviewer/me'),
                    fetch('/api/interviewer/studies'),
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
    }, [router]);

    const handleLogout = async () => {
        await fetch('/api/auth', { method: 'DELETE' });
        router.push(portalPath('/login'));
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
            const unique = Array.from(new Map(imported.map(candidate => [candidate.email, candidate])).values());

            if (!unique.length) {
                setAssignmentCandidates([createCandidate('file')]);
                setAssignmentMessage({ type: 'error', text: 'No valid candidate names and emails found in the sheet.' });
                return;
            }

            setAssignmentCandidates(prev => {
                const hasManualData = prev.some(candidate => candidate.name.trim() || candidate.email.trim());
                const nextCandidates = hasManualData ? [...prev, ...unique] : unique;
                return Array.from(new Map(nextCandidates.map(candidate => [candidate.email || candidate.id, candidate])).values());
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
            const res = await fetch(`/api/interviewer/studies/${assignmentStudy.id}/assignments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ candidates: preparedCandidates }),
            });

            const data = await res.json();
            if (!res.ok) {
                setAssignmentMessage({ type: 'error', text: data.error || 'Failed to assign interview.' });
                return;
            }

            const createdCount = data.createdCount ?? (data.reused ? 0 : 1);
            const reusedCount = data.reusedCount ?? (data.reused ? 1 : 0);

            if (createdCount > 0) {
                setStudies(prev => prev.map(study =>
                    study.id === assignmentStudy.id
                        ? { ...study, candidateCount: study.candidateCount + createdCount }
                        : study
                ));
            }

            setAssignmentMessage({
                type: 'success',
                text: `${createdCount} assigned${reusedCount ? `, ${reusedCount} already existed` : ''}.`,
            });
            setAssignmentCandidates([createCandidate()]);
            setImportFileName('');
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
                    <div className="flex items-center gap-2">
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
                        onClick={() => router.push(portalPath('/setup'))}
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
                            <button onClick={() => router.push(portalPath('/setup'))}
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
                                            <button
                                                onClick={() => openAssignmentModal(study)}
                                                disabled={assigningStudyId === study.id}
                                                className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-xl text-xs transition-colors disabled:opacity-50"
                                            >
                                                {assigningStudyId === study.id ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                                                Assign
                                            </button>

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
                                                onClick={() => router.push(portalPath(`/studies/${study.id}`))}
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

            <AnimatePresence>
                {assignmentStudy && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4"
                    >
                        <motion.form
                            initial={{ opacity: 0, y: 12, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 12, scale: 0.98 }}
                            onSubmit={handleAssignCandidate}
                            className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-black/40"
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
                                <p className={`mt-3 text-xs ${assignmentMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {assignmentMessage.text}
                                </p>
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
                                    className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
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
