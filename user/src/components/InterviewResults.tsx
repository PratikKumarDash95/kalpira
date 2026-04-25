'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Trophy, Star, ChevronDown, ChevronUp, ArrowRight,
    RefreshCw, Home, CheckCircle, AlertCircle, Lightbulb,
    Target, TrendingUp, Brain, Zap, MessageSquare, Clock,
    BarChart2, Award, BookOpen, Code, Users, Layers
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface ScoreBreakdown {
    technical: number;
    communication: number;
    confidence: number;
    logic: number;
    depth: number;
}

interface QAItem {
    question: string;
    category: string;
    difficulty: string;
    answer: string;
    scores: ScoreBreakdown;
    feedback: string;
    idealAnswer: string;
    improvementTip: string;
}

interface ResultsData {
    sessionId: string;
    role: string;
    difficulty: string;
    mode: string;
    startedAt: string;
    completedAt: string | null;
    overallScore: number;
    scoreBreakdown: ScoreBreakdown | null;
    qaItems: QAItem[];
}

// ─── Animated Score Ring ───────────────────────────────────────────────────────
const ScoreRing: React.FC<{ score: number; size?: number }> = ({ score, size = 160 }) => {
    const [displayed, setDisplayed] = useState(0);
    const radius = (size - 20) / 2;
    const circumference = 2 * Math.PI * radius;
    const pct = Math.min(Math.max(score, 0), 100);
    const offset = circumference - (pct / 100) * circumference;

    useEffect(() => {
        let start = 0;
        const step = () => {
            start += 1.5;
            setDisplayed(Math.min(start, pct));
            if (start < pct) requestAnimationFrame(step);
        };
        const t = setTimeout(() => requestAnimationFrame(step), 400);
        return () => clearTimeout(t);
    }, [pct]);

    const color = pct >= 80 ? '#10b981' : pct >= 60 ? '#3b82f6' : pct >= 40 ? '#f59e0b' : '#ef4444';
    const label = pct >= 80 ? 'Excellent' : pct >= 60 ? 'Good' : pct >= 40 ? 'Fair' : 'Needs Work';

    return (
        <div className="flex flex-col items-center gap-2 w-full max-w-[160px]">
            <div className="relative w-full aspect-square">
                <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90 w-full h-full">
                    <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1e293b" strokeWidth={12} />
                    <motion.circle
                        cx={size / 2} cy={size / 2} r={radius}
                        fill="none" stroke={color} strokeWidth={12}
                        strokeLinecap="round" strokeDasharray={circumference}
                        initial={{ strokeDashoffset: circumference }}
                        animate={{ strokeDashoffset: offset }}
                        transition={{ duration: 1.5, ease: 'easeOut', delay: 0.4 }}
                    />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl sm:text-4xl font-bold text-white">{Math.round(displayed)}</span>
                    <span className="text-xs text-slate-400">/ 100</span>
                </div>
            </div>
            <span className="text-sm font-medium" style={{ color }}>{label}</span>
        </div>
    );
};

// ─── Radar Chart (pure SVG) ────────────────────────────────────────────────────
const RadarChart: React.FC<{ scores: ScoreBreakdown }> = ({ scores }) => {
    const dims = ['technical', 'communication', 'confidence', 'logic', 'depth'] as const;
    const labels = ['Technical', 'Communication', 'Confidence', 'Logic', 'Depth'];
    const icons = [Code, MessageSquare, Zap, Brain, Layers];
    const size = 220;
    const cx = size / 2, cy = size / 2, r = 80;
    const [animated, setAnimated] = useState(false);

    useEffect(() => { setTimeout(() => setAnimated(true), 600); }, []);

    const angleStep = (2 * Math.PI) / dims.length;
    const getPoint = (i: number, val: number) => {
        const angle = i * angleStep - Math.PI / 2;
        const dist = (val / 100) * r;
        return { x: cx + dist * Math.cos(angle), y: cy + dist * Math.sin(angle) };
    };
    const getLabelPoint = (i: number) => {
        const angle = i * angleStep - Math.PI / 2;
        return { x: cx + (r + 28) * Math.cos(angle), y: cy + (r + 28) * Math.sin(angle) };
    };

    const gridLevels = [0.25, 0.5, 0.75, 1];
    const dataPoints = dims.map((d, i) => getPoint(i, animated ? scores[d] : 0));
    const polyPoints = dataPoints.map(p => `${p.x},${p.y}`).join(' ');

    return (
        <div className="relative flex items-center justify-center w-full max-w-[300px] aspect-square">
            <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full">
                {/* Grid */}
                {gridLevels.map(level => {
                    const pts = dims.map((_, i) => {
                        const angle = i * angleStep - Math.PI / 2;
                        return `${cx + r * level * Math.cos(angle)},${cy + r * level * Math.sin(angle)}`;
                    }).join(' ');
                    return <polygon key={level} points={pts} fill="none" stroke="#1e293b" strokeWidth={1} />;
                })}
                {/* Axes */}
                {dims.map((_, i) => {
                    const angle = i * angleStep - Math.PI / 2;
                    return <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(angle)} y2={cy + r * Math.sin(angle)} stroke="#1e293b" strokeWidth={1} />;
                })}
                {/* Data polygon */}
                <motion.polygon
                    points={polyPoints}
                    fill="rgba(139,92,246,0.15)"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.8, delay: 0.6 }}
                />
                {/* Data points */}
                {dataPoints.map((p, i) => (
                    <motion.circle key={i} cx={p.x} cy={p.y} r={4} fill="#8b5cf6" initial={{ r: 0 }} animate={{ r: 4 }} transition={{ delay: 0.8 + i * 0.1 }} />
                ))}
                {/* Labels */}
                {dims.map((d, i) => {
                    const lp = getLabelPoint(i);
                    return (
                        <text key={i} x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#94a3b8" fontWeight={500}>
                            {labels[i]}
                        </text>
                    );
                })}
            </svg>
        </div>
    );
};

// ─── Score Bar ─────────────────────────────────────────────────────────────────
const ScoreBar: React.FC<{ label: string; value: number; color: string; icon: React.ReactNode }> = ({ label, value, color, icon }) => (
    <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-slate-300">
                <span className="text-slate-500">{icon}</span>
                {label}
            </div>
            <span className="font-semibold text-white">{Math.round(value)}%</span>
        </div>
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: color }}
                initial={{ width: 0 }}
                animate={{ width: `${value}%` }}
                transition={{ duration: 1, ease: 'easeOut', delay: 0.5 }}
            />
        </div>
    </div>
);

import { generateRoadmap, Roadmap, WeekTask } from '@/lib/roadmap/roadmapGenerator';

// ─── Roadmap Renderer Helpers ──────────────────────────────────────────────────
const RoadmapWeek: React.FC<{ week: WeekTask[], title: string, color: string, index: number }> = ({ week, title, color, index }) => (
    <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.1 }}
        className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden"
    >
        <div className={`bg-gradient-to-r ${color} p-4`}>
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">Week {index + 1}</span>
                <span className="text-xs font-bold text-white bg-white/20 px-2 py-0.5 rounded-full">{title}</span>
            </div>
        </div>
        <div className="p-4 space-y-2.5">
            {week.map((task, ti) => (
                <div key={ti} className="flex items-start gap-2.5">
                    <div className="w-5 h-5 rounded-full border border-slate-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs text-slate-500">{ti + 1}</span>
                    </div>
                    <div>
                        <p className="text-sm font-medium text-slate-200">{task.topic}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{task.action}</p>
                    </div>
                </div>
            ))}
        </div>
    </motion.div>
);

// ─── Q&A Card ─────────────────────────────────────────────────────────────────
const QACard: React.FC<{ item: QAItem; index: number }> = ({ item, index }) => {
    const [expanded, setExpanded] = useState(index === 0);
    const avg = Object.values(item.scores).reduce((a, b) => a + b, 0) / 5;
    const scoreColor = avg >= 70 ? 'text-emerald-400' : avg >= 50 ? 'text-amber-400' : 'text-red-400';
    const scoreBg = avg >= 70 ? 'bg-emerald-500/10 border-emerald-500/20' : avg >= 50 ? 'bg-amber-500/10 border-amber-500/20' : 'bg-red-500/10 border-red-500/20';

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08 }}
            className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden"
        >
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-start gap-3 p-4 text-left hover:bg-slate-800/30 transition-colors"
            >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 border ${scoreBg} ${scoreColor}`}>
                    {index + 1}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 line-clamp-2">{item.question}</p>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-slate-500 capitalize">{item.category}</span>
                        <span className="text-slate-700">·</span>
                        <span className={`text-xs font-semibold ${scoreColor}`}>{Math.round(avg)}%</span>
                    </div>
                </div>
                <div className="flex-shrink-0 text-slate-500 mt-0.5">
                    {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
            </button>

            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="px-4 pb-4 space-y-4 border-t border-slate-800 pt-4">
                            {/* Your answer */}
                            {item.answer && (
                                <div>
                                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">Your Answer</p>
                                    <p className="text-sm text-slate-300 bg-slate-800/50 rounded-xl p-3 leading-relaxed">{item.answer}</p>
                                </div>
                            )}

                            {/* Score bars */}
                            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                                {Object.entries(item.scores).map(([key, val]) => (
                                    <div key={key} className="space-y-1">
                                        <div className="flex justify-between text-xs">
                                            <span className="text-slate-500 capitalize">{key}</span>
                                            <span className="text-slate-300 font-medium">{Math.round(val)}%</span>
                                        </div>
                                        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                            <motion.div
                                                className="h-full rounded-full bg-violet-500"
                                                initial={{ width: 0 }}
                                                animate={{ width: `${val}%` }}
                                                transition={{ duration: 0.8 }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Feedback */}
                            {item.feedback && (
                                <div className="flex gap-2 p-3 bg-blue-500/5 border border-blue-500/10 rounded-xl">
                                    <CheckCircle size={14} className="text-blue-400 flex-shrink-0 mt-0.5" />
                                    <p className="text-xs text-slate-300">{item.feedback}</p>
                                </div>
                            )}

                            {/* Improvement tip */}
                            {item.improvementTip && (
                                <div className="flex gap-2 p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl">
                                    <Lightbulb size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                                    <p className="text-xs text-slate-300">{item.improvementTip}</p>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};
interface InterviewResultsProps {
    sessionId: string;
    /** Fallback data if DB is unavailable (passed from client state) */
    fallbackData?: Partial<ResultsData>;
}

const InterviewResults: React.FC<InterviewResultsProps> = ({ sessionId, fallbackData }) => {
    const router = useRouter();
    const [data, setData] = useState<ResultsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'overview' | 'questions' | 'roadmap'>('overview');
    const [roadmap, setRoadmap] = useState<Roadmap | null>(null);

    useEffect(() => {
        const fetchResults = async () => {
            try {
                const res = await fetch(`/api/sessions/${sessionId}/results`);
                if (res.ok) {
                    const json = await res.json();
                    setData(json);
                    generateDynamicRoadmap(json);
                } else if (fallbackData) {
                    // Use fallback data from store if DB unavailable
                    const fallback = {
                        sessionId,
                        role: fallbackData.role || 'Interview',
                        difficulty: fallbackData.difficulty || 'medium',
                        mode: fallbackData.mode || 'video',
                        startedAt: fallbackData.startedAt || new Date().toISOString(),
                        completedAt: new Date().toISOString(),
                        overallScore: fallbackData.overallScore || 72,
                        scoreBreakdown: fallbackData.scoreBreakdown || {
                            technical: 70, communication: 75, confidence: 68, logic: 72, depth: 65,
                        },
                        qaItems: fallbackData.qaItems || [],
                    } as ResultsData;
                    setData(fallback);
                    generateDynamicRoadmap(fallback);
                }
            } catch {
                if (fallbackData) {
                    const fallback = {
                        sessionId,
                        role: fallbackData.role || 'Interview',
                        difficulty: 'medium',
                        mode: 'video',
                        startedAt: new Date().toISOString(),
                        completedAt: new Date().toISOString(),
                        overallScore: fallbackData.overallScore || 72,
                        scoreBreakdown: fallbackData.scoreBreakdown || {
                            technical: 70, communication: 75, confidence: 68, logic: 72, depth: 65,
                        },
                        qaItems: [],
                    } as ResultsData;
                    setData(fallback);
                    generateDynamicRoadmap(fallback);
                }
            } finally {
                setLoading(false);
            }
        };
        fetchResults();
    }, [sessionId]);

    const generateDynamicRoadmap = (results: ResultsData) => {
        if (!results.scoreBreakdown) return;

        // Extract weak skills from QA items (questions with score < 60)
        const weakSkills: string[] = [];
        results.qaItems.forEach(item => {
            const avg = Object.values(item.scores).reduce((a, b) => a + b, 0) / 5;
            if (avg < 70) {
                // Use question category or keywords as skill
                weakSkills.push(item.category || 'General Knowledge');
            }
        });

        // Dedup and limit
        const uniqueWeakSkills = Array.from(new Set(weakSkills));

        const rawDifficulty = (results.difficulty || 'medium').toLowerCase();
        const difficulty = ['easy', 'medium', 'hard'].includes(rawDifficulty)
            ? rawDifficulty as any
            : 'medium';

        const generated = generateRoadmap({
            weakSkills: uniqueWeakSkills.length > 0 ? uniqueWeakSkills : ['General Fundamentals'],
            difficulty,
            technicalAverage: results.scoreBreakdown.technical,
            communicationAverage: results.scoreBreakdown.communication,
            logicAverage: results.scoreBreakdown.logic,
        });
        setRoadmap(generated);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}>
                    <BarChart2 size={40} className="text-violet-500" />
                </motion.div>
                <p className="text-slate-400 text-sm">Analyzing your performance...</p>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <div className="text-center space-y-4">
                    <AlertCircle size={48} className="text-slate-600 mx-auto" />
                    <p className="text-slate-400">Results not available</p>
                    <button onClick={() => router.push('/dashboard')} className="px-4 py-2 bg-violet-600 text-white rounded-xl text-sm">
                        Go to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    const score = data.overallScore;
    const breakdown = data.scoreBreakdown || { technical: 0, communication: 0, confidence: 0, logic: 0, depth: 0 };
    const scoreColor = score >= 80 ? '#10b981' : score >= 60 ? '#3b82f6' : score >= 40 ? '#f59e0b' : '#ef4444';
    const scoreLabel = score >= 80 ? '🏆 Excellent Performance' : score >= 60 ? '👍 Good Performance' : score >= 40 ? '📈 Keep Practicing' : '💪 Room to Grow';

    const tabs = [
        { id: 'overview', label: 'Overview', icon: <BarChart2 size={14} /> },
        { id: 'questions', label: `Q&A (${data.qaItems.length})`, icon: <MessageSquare size={14} /> },
        { id: 'roadmap', label: 'Roadmap', icon: <Target size={14} /> },
    ] as const;

    return (
        <div className="min-h-screen bg-slate-950 text-white">
            {/* ── Hero Header ── */}
            <div className="relative overflow-hidden">
                {/* Background gradient */}
                <div className="absolute inset-0 bg-gradient-to-br from-violet-950/50 via-slate-950 to-indigo-950/30" />
                <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, rgba(139,92,246,0.08) 0%, transparent 60%), radial-gradient(circle at 70% 50%, rgba(99,102,241,0.06) 0%, transparent 60%)' }} />

                <div className="relative max-w-4xl mx-auto px-4 sm:px-6 pt-10 pb-8">
                    {/* Top row */}
                    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-2 text-slate-400 text-sm">
                            <CheckCircle size={16} className="text-emerald-400" />
                            Interview Complete
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => router.push('/dashboard')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition-colors border border-slate-700">
                                <Home size={14} /> Dashboard
                            </button>
                            <button onClick={() => router.push('/')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm transition-colors">
                                <RefreshCw size={14} /> New Interview
                            </button>
                        </div>
                    </motion.div>

                    {/* Score hero */}
                    <div className="flex flex-col sm:flex-row items-center gap-8 w-full justify-center sm:justify-start">
                        {/* Ring */}
                        <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }} className="relative flex-shrink-0 w-32 h-32 sm:w-40 sm:h-40">
                            <ScoreRing score={score} size={160} />
                        </motion.div>

                        {/* Info */}
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }} className="text-center sm:text-left">
                            <p className="text-2xl sm:text-3xl font-bold mb-1">{scoreLabel}</p>
                            <p className="text-slate-400 mb-4 text-sm sm:text-base">
                                {data.role} · {data.difficulty} difficulty · {data.qaItems.length} questions answered
                            </p>
                            <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                                {score >= 70 && (
                                    <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs border border-emerald-500/20">
                                        <Award size={12} /> Strong Candidate
                                    </span>
                                )}
                                {breakdown.communication >= 70 && (
                                    <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 text-xs border border-blue-500/20">
                                        <MessageSquare size={12} /> Great Communicator
                                    </span>
                                )}
                                {breakdown.technical >= 70 && (
                                    <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-500/10 text-violet-400 text-xs border border-violet-500/20">
                                        <Code size={12} /> Technical Strength
                                    </span>
                                )}
                            </div>
                        </motion.div>
                    </div>
                </div>
            </div>

            {/* ── Tabs ── */}
            <div className="sticky top-0 z-10 bg-slate-950/90 backdrop-blur-md border-b border-slate-800">
                <div className="max-w-4xl mx-auto px-4 sm:px-6">
                    <div className="flex gap-1">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id ? 'border-violet-500 text-violet-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                            >
                                {tab.icon} {tab.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Tab Content ── */}
            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
                <AnimatePresence mode="wait">
                    {/* Overview Tab */}
                    {activeTab === 'overview' && (
                        <motion.div key="overview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
                            <div className="grid sm:grid-cols-2 gap-6">
                                {/* Radar Chart */}
                                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
                                    <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
                                        <TrendingUp size={16} className="text-violet-400" /> Skill Radar
                                    </h3>
                                    <div className="flex justify-center">
                                        <RadarChart scores={breakdown} />
                                    </div>
                                </div>

                                {/* Score Bars */}
                                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
                                    <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
                                        <BarChart2 size={16} className="text-violet-400" /> Score Breakdown
                                    </h3>
                                    <div className="space-y-4">
                                        <ScoreBar label="Technical" value={breakdown.technical} color="#8b5cf6" icon={<Code size={14} />} />
                                        <ScoreBar label="Communication" value={breakdown.communication} color="#3b82f6" icon={<MessageSquare size={14} />} />
                                        <ScoreBar label="Confidence" value={breakdown.confidence} color="#10b981" icon={<Zap size={14} />} />
                                        <ScoreBar label="Logic" value={breakdown.logic} color="#f59e0b" icon={<Brain size={14} />} />
                                        <ScoreBar label="Depth" value={breakdown.depth} color="#ec4899" icon={<Layers size={14} />} />
                                    </div>
                                </div>
                            </div>

                            {/* Quick stats */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                {[
                                    { label: 'Overall Score', value: `${Math.round(score)}%`, icon: <Trophy size={18} className="text-amber-400" />, color: 'text-amber-400' },
                                    { label: 'Questions', value: data.qaItems.length, icon: <MessageSquare size={18} className="text-blue-400" />, color: 'text-blue-400' },
                                    { label: 'Best Skill', value: Object.entries(breakdown).sort(([, a], [, b]) => b - a)[0]?.[0] || 'N/A', icon: <Star size={18} className="text-violet-400" />, color: 'text-violet-400' },
                                    { label: 'Needs Work', value: Object.entries(breakdown).sort(([, a], [, b]) => a - b)[0]?.[0] || 'N/A', icon: <Target size={18} className="text-rose-400" />, color: 'text-rose-400' },
                                ].map((stat, i) => (
                                    <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 text-center">
                                        <div className="flex justify-center mb-2">{stat.icon}</div>
                                        <p className={`text-lg font-bold capitalize ${stat.color}`}>{stat.value}</p>
                                        <p className="text-xs text-slate-500 mt-0.5">{stat.label}</p>
                                    </motion.div>
                                ))}
                            </div>
                        </motion.div>
                    )}

                    {/* Q&A Tab */}
                    {activeTab === 'questions' && (
                        <motion.div key="questions" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
                            {data.qaItems.length === 0 ? (
                                <div className="text-center py-16 text-slate-500">
                                    <MessageSquare size={40} className="mx-auto mb-3 opacity-30" />
                                    <p>No Q&A data available for this session.</p>
                                    <p className="text-sm mt-1 text-slate-600">This happens when the DB is not connected.</p>
                                </div>
                            ) : (
                                data.qaItems.map((item, i) => <QACard key={i} item={item} index={i} />)
                            )}
                        </motion.div>
                    )}

                    {/* Roadmap Tab */}
                    {activeTab === 'roadmap' && (
                        <motion.div key="roadmap" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex items-start gap-3 mb-6">
                                <Lightbulb size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-sm font-medium text-slate-200">Your 4-Week Interview Prep Roadmap</p>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        Based on your performance, focus on: <span className="text-violet-400 capitalize">{Object.entries(breakdown).sort(([, a], [, b]) => a - b)[0]?.[0]}</span> and <span className="text-violet-400 capitalize">{Object.entries(breakdown).sort(([, a], [, b]) => a - b)[1]?.[0]}</span>
                                    </p>
                                </div>
                            </div>

                            <div className="grid sm:grid-cols-2 gap-4">
                                {roadmap ? (
                                    <>
                                        <RoadmapWeek week={roadmap.week1} title="Foundation" color="from-blue-600 to-cyan-600" index={0} />
                                        <RoadmapWeek week={roadmap.week2} title="Deep Dive" color="from-violet-600 to-purple-600" index={1} />
                                        <RoadmapWeek week={roadmap.week3} title="Practice" color="from-emerald-600 to-teal-600" index={2} />
                                        <RoadmapWeek week={roadmap.week4} title="Polish" color="from-amber-600 to-orange-600" index={3} />
                                    </>
                                ) : (
                                    <div className="col-span-2 text-center py-10 text-slate-500">
                                        <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full mx-auto mb-2" />
                                        Generating your personal roadmap...
                                    </div>
                                )}
                            </div>

                            {/* CTA */}
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mt-6 p-6 bg-gradient-to-r from-violet-900/30 to-indigo-900/30 border border-violet-500/20 rounded-2xl text-center">
                                <Trophy size={32} className="text-amber-400 mx-auto mb-3" />
                                <h3 className="text-lg font-bold text-white mb-1">Ready for the next round?</h3>
                                <p className="text-slate-400 text-sm mb-4">Practice makes perfect. Start another interview to track your progress.</p>
                                <button onClick={() => router.push('/')} className="inline-flex items-center gap-2 px-6 py-3 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-xl transition-colors">
                                    Start New Interview <ArrowRight size={16} />
                                </button>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default InterviewResults;
