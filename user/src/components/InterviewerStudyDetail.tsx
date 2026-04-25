'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeft, Users, BarChart2, ChevronDown, ChevronUp,
    Loader2, AlertTriangle, Mail, Clock, CheckCircle, XCircle,
    TrendingUp, MessageSquare, Brain, Zap, Target, BookOpen
} from 'lucide-react';

interface ScoreBreakdown {
    overallScore: number;
    technicalAverage: number;
    communicationAverage: number;
    confidenceAverage: number;
    logicAverage: number;
    depthAverage: number;
}

interface QAItem {
    question: string;
    answer: string;
    feedback: string;
    scores: { technical: number; communication: number; confidence: number; logic: number; depth: number };
}

interface Candidate {
    sessionId: string;
    candidateName: string;
    candidateEmail: string;
    startedAt: string;
    completedAt: string | null;
    averageScore: number;
    scoreBreakdown: ScoreBreakdown | null;
    questionCount: number;
    qaItems: QAItem[];
}

interface StudyInfo {
    id: string;
    config: { name: string; researchQuestion: string };
}

const ScoreBar: React.FC<{ label: string; value: number; icon: React.ReactNode }> = ({ label, value, icon }) => {
    const color = value >= 75 ? 'bg-emerald-500' : value >= 50 ? 'bg-amber-500' : 'bg-red-500';
    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 text-xs text-slate-400">{icon}{label}</div>
                <span className="text-xs font-semibold text-slate-300">{Math.round(value)}%</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${value}%` }} transition={{ duration: 0.6, ease: 'easeOut' }}
                    className={`h-full rounded-full ${color}`} />
            </div>
        </div>
    );
};

const InterviewerStudyDetail: React.FC = () => {
    const router = useRouter();
    const params = useParams();
    const studyId = params.id as string;

    const [study, setStudy] = useState<StudyInfo | null>(null);
    const [candidates, setCandidates] = useState<Candidate[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch(`/api/interviewer/studies/${studyId}/candidates`);
                if (!res.ok) {
                    if (res.status === 401) { router.push('/interviewer/login'); return; }
                    setError('Failed to load candidates.');
                    return;
                }
                const data = await res.json();
                setStudy(data.study);
                setCandidates(data.candidates || []);
            } catch {
                setError('Network error. Please try again.');
            } finally {
                setIsLoading(false);
            }
        };
        load();
    }, [studyId, router]);

    const scoreColor = (score: number) => {
        if (score >= 75) return 'text-emerald-400';
        if (score >= 50) return 'text-amber-400';
        return 'text-red-400';
    };

    const scoreBg = (score: number) => {
        if (score >= 75) return 'bg-emerald-500/10 border-emerald-500/20';
        if (score >= 50) return 'bg-amber-500/10 border-amber-500/20';
        return 'bg-red-500/10 border-red-500/20';
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <Loader2 size={40} className="animate-spin text-violet-400" />
            </div>
        );
    }

    const completed = candidates.filter(c => c.completedAt);
    const avgScore = completed.length > 0
        ? Math.round(completed.reduce((s, c) => s + c.averageScore, 0) / completed.length)
        : 0;

    return (
        <div className="min-h-screen bg-slate-950 text-white">
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute inset-0 bg-gradient-to-br from-violet-950/20 via-slate-950 to-indigo-950/10" />
            </div>

            <div className="relative max-w-4xl mx-auto px-4 py-8">
                {/* Header */}
                <div className="flex items-center gap-3 mb-6">
                    <button onClick={() => router.push('/interviewer/dashboard')}
                        className="flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors text-sm">
                        <ArrowLeft size={16} /> Dashboard
                    </button>
                </div>

                {study && (
                    <div className="mb-6">
                        <h1 className="text-2xl font-bold text-white mb-1">{study.config.name}</h1>
                        <p className="text-slate-400 text-sm">{study.config.researchQuestion}</p>
                    </div>
                )}

                {/* Stats */}
                <div className="grid grid-cols-3 gap-4 mb-8">
                    {[
                        { label: 'Total Candidates', value: candidates.length, icon: Users, color: 'text-violet-400' },
                        { label: 'Completed', value: completed.length, icon: CheckCircle, color: 'text-emerald-400' },
                        { label: 'Avg Score', value: avgScore > 0 ? `${avgScore}%` : '—', icon: TrendingUp, color: 'text-blue-400' },
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

                {error && (
                    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3">
                        <AlertTriangle size={18} className="text-red-400" />
                        <p className="text-sm text-red-400">{error}</p>
                    </div>
                )}

                {/* Candidates */}
                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Users size={14} /> Candidates
                </h2>

                {candidates.length === 0 ? (
                    <div className="bg-slate-900/40 border border-slate-800 border-dashed rounded-2xl p-12 text-center">
                        <Users size={40} className="text-slate-700 mx-auto mb-4" />
                        <h3 className="text-slate-400 font-medium mb-2">No candidates yet</h3>
                        <p className="text-slate-600 text-sm">Share the interview link to start receiving candidates</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {candidates.map((candidate, i) => (
                            <motion.div key={candidate.sessionId}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.04 }}
                                className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">

                                {/* Candidate Row */}
                                <button
                                    className="w-full p-5 flex items-center justify-between gap-4 hover:bg-slate-800/30 transition-colors text-left"
                                    onClick={() => setExpandedId(expandedId === candidate.sessionId ? null : candidate.sessionId)}>
                                    <div className="flex items-center gap-4 flex-1 min-w-0">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center flex-shrink-0 text-sm font-bold">
                                            {candidate.candidateName.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="font-semibold text-white">{candidate.candidateName}</p>
                                            {candidate.candidateEmail && (
                                                <div className="flex items-center gap-1 text-xs text-slate-500">
                                                    <Mail size={11} />{candidate.candidateEmail}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4 flex-shrink-0">
                                        {/* Status */}
                                        {candidate.completedAt ? (
                                            <span className="flex items-center gap-1 text-xs text-emerald-400">
                                                <CheckCircle size={13} /> Done
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1 text-xs text-amber-400">
                                                <XCircle size={13} /> Incomplete
                                            </span>
                                        )}

                                        {/* Score */}
                                        {candidate.averageScore > 0 && (
                                            <div className={`px-3 py-1 rounded-xl border text-sm font-bold ${scoreBg(candidate.averageScore)} ${scoreColor(candidate.averageScore)}`}>
                                                {Math.round(candidate.averageScore)}%
                                            </div>
                                        )}

                                        <div className="flex items-center gap-1 text-xs text-slate-500">
                                            <Clock size={12} />
                                            {new Date(candidate.startedAt).toLocaleDateString()}
                                        </div>

                                        {expandedId === candidate.sessionId ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
                                    </div>
                                </button>

                                {/* Expanded Detail */}
                                <AnimatePresence>
                                    {expandedId === candidate.sessionId && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="overflow-hidden">
                                            <div className="px-5 pb-5 border-t border-slate-800 pt-4 space-y-5">

                                                {/* Score Breakdown */}
                                                {candidate.scoreBreakdown && (
                                                    <div>
                                                        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                                            <BarChart2 size={13} /> Score Breakdown
                                                        </h4>
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                            <ScoreBar label="Technical" value={candidate.scoreBreakdown.technicalAverage} icon={<Brain size={12} />} />
                                                            <ScoreBar label="Communication" value={candidate.scoreBreakdown.communicationAverage} icon={<MessageSquare size={12} />} />
                                                            <ScoreBar label="Confidence" value={candidate.scoreBreakdown.confidenceAverage} icon={<Zap size={12} />} />
                                                            <ScoreBar label="Logic" value={candidate.scoreBreakdown.logicAverage} icon={<Target size={12} />} />
                                                            <ScoreBar label="Depth" value={candidate.scoreBreakdown.depthAverage} icon={<BookOpen size={12} />} />
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Q&A */}
                                                {candidate.qaItems.length > 0 && (
                                                    <div>
                                                        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                                            <MessageSquare size={13} /> Interview Q&A
                                                        </h4>
                                                        <div className="space-y-3">
                                                            {candidate.qaItems.map((qa, qi) => (
                                                                <div key={qi} className="bg-slate-800/50 rounded-xl p-4 space-y-2">
                                                                    <p className="text-sm font-medium text-slate-200">Q{qi + 1}: {qa.question}</p>
                                                                    {qa.answer && (
                                                                        <p className="text-sm text-slate-400 leading-relaxed">{qa.answer}</p>
                                                                    )}
                                                                    {qa.feedback && (
                                                                        <div className="pt-2 border-t border-slate-700">
                                                                            <p className="text-xs text-violet-400 font-medium mb-1">AI Feedback</p>
                                                                            <p className="text-xs text-slate-500">{qa.feedback}</p>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {!candidate.scoreBreakdown && candidate.qaItems.length === 0 && (
                                                    <p className="text-sm text-slate-600 text-center py-4">No detailed results available yet.</p>
                                                )}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </motion.div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default InterviewerStudyDetail;
