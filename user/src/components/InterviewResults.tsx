'use client';
import { apiFetch, apiUrl } from '@/lib/apiClient';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Trophy, Star, ChevronDown, ChevronUp, ArrowRight,
    RefreshCw, Home, CheckCircle, AlertCircle, Lightbulb,
    Target, TrendingUp, Brain, Zap, MessageSquare, Clock,
    BarChart2, Award, BookOpen, Code, Users, Layers, Activity, FileSearch
} from 'lucide-react';
import { Skeleton, SkeletonList, SkeletonStatRow } from '@/components/ui/Skeleton';
import PageShell from '@/components/layout/PageShell';
import EmptyState from '@/components/layout/EmptyState';
import ScoreProvenance from '@/components/ScoreProvenance';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface ScoreBreakdown {
    technical: number;
    communication: number;
    confidence: number;
    logic: number;
    depth: number;
}

/**
 * A dimension score, or null when it was never measured.
 *
 * Feature 4: the API reports null rather than 0 for an answer the model did not score.
 * `null` is not a low score — it is the absence of one — and every reader here has to keep
 * those apart, because "this candidate scored 0 on depth" and "nobody scored this answer
 * on depth" are different statements about a person.
 */
interface NullableScoreBreakdown {
    technical: number | null;
    communication: number | null;
    confidence: number | null;
    logic: number | null;
    depth: number | null;
}

interface QAItem {
    /** The stored answer's id, used to join this question to the decision that scored it. */
    responseId?: string | null;
    question: string;
    category: string;
    difficulty: string;
    answer: string;
    /** Null for any dimension that was not measured. */
    scores: NullableScoreBreakdown;
    /** True when these scores trace to a recorded model decision. */
    measured?: boolean;
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
    /** Null when nothing in this session was measured. Never 0 as a stand-in. */
    overallScore: number | null;
    scoreBreakdown: NullableScoreBreakdown | null;
    /** Whether a breakdown exists at all. */
    assessed?: boolean;
    qaItems: QAItem[];
}

// ─── Animated Score Ring ───────────────────────────────────────────────────────
const ScoreRing: React.FC<{ score: number | null; size?: number }> = ({ score, size = 160 }) => {
    const [displayed, setDisplayed] = useState(0);
    const radius = (size - 20) / 2;
    const circumference = 2 * Math.PI * radius;
    // A null score draws an EMPTY ring and reads "Not measured". It does not draw a ring at
    // zero, and it does not animate: a sweep from 0 to 0 is a statement that the candidate
    // scored nothing, which is precisely what the absence of a score does not mean.
    const measured = typeof score === "number" && Number.isFinite(score);
    const pct = measured ? Math.min(Math.max(score as number, 0), 100) : 0;
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

    const color = !measured ? '#64748b' : pct >= 80 ? '#0ca30c' : pct >= 60 ? '#fab219' : pct >= 40 ? '#ec835a' : '#d03b3b';
    const label = !measured ? 'Not measured' : pct >= 80 ? 'Excellent' : pct >= 60 ? 'Good' : pct >= 40 ? 'Fair' : 'Needs Work';

    return (
        <div className="flex flex-col items-center gap-2 w-full max-w-[160px]">
            <div className="relative w-full aspect-square">
                <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90 w-full h-full">
                    <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f2ecda" strokeWidth={12} />
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
                    <span className="text-3xl sm:text-4xl font-bold text-white">
                        {measured ? Math.round(displayed) : '-'}
                    </span>
                    <span className="text-xs text-slate-400">{measured ? '/ 100' : 'no score'}</span>
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
                    return <polygon key={level} points={pts} fill="none" stroke="#efead5" strokeWidth={1} />;
                })}
                {/* Axes */}
                {dims.map((_, i) => {
                    const angle = i * angleStep - Math.PI / 2;
                    return <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(angle)} y2={cy + r * Math.sin(angle)} stroke="#efead5" strokeWidth={1} />;
                })}
                {/* Data polygon */}
                <motion.polygon
                    points={polyPoints}
                    fill="rgba(237,161,0,0.16)"
                    stroke="#a16207"
                    strokeWidth={2}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.8, delay: 0.6 }}
                />
                {/* Data points */}
                {dataPoints.map((p, i) => (
                    <motion.circle key={i} cx={p.x} cy={p.y} r={4} fill="#eda100" initial={{ r: 0 }} animate={{ r: 4 }} transition={{ delay: 0.8 + i * 0.1 }} />
                ))}
                {/* Labels */}
                {dims.map((d, i) => {
                    const lp = getLabelPoint(i);
                    return (
                        <text key={i} x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#78716c" fontWeight={500}>
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
                                                className="h-full rounded-full bg-brand-500"
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
    const [activeTab, setActiveTab] = useState<'overview' | 'questions' | 'roadmap' | 'decided'>('overview');
    const [roadmap, setRoadmap] = useState<Roadmap | null>(null);

    useEffect(() => {
        const fetchResults = async () => {
            try {
                const res = await apiFetch(`/api/sessions/${sessionId}/results`);
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
                        // Feature 4: NOT `|| 72`, and not a made-up breakdown. If the
                        // results could not be loaded, this page says so; it does not
                        // invent a score. The old fallback showed the candidate 72 with
                        // {70, 75, 68, 72, 65} — numbers no model produced, presented as
                        // their interview result, and indistinguishable from real ones.
                        // A page that cannot load a measurement must not manufacture one.
                        overallScore: fallbackData.overallScore ?? null,
                        scoreBreakdown: fallbackData.scoreBreakdown ?? null,
                        assessed: false,
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
                        // Same rule as above, for the network-failure path.
                        overallScore: fallbackData.overallScore ?? null,
                        scoreBreakdown: fallbackData.scoreBreakdown ?? null,
                        assessed: false,
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

        // Feature 4: a roadmap is advice, and advice built from a fabricated zero sends
        // someone to study something the interview never assessed. All three inputs must be
        // real, or there is no roadmap.
        const { technical, communication, logic } = results.scoreBreakdown;
        if (typeof technical !== 'number' || typeof communication !== 'number' || typeof logic !== 'number') {
            return;
        }

        // Extract weak skills from QA items (questions with score < 60).
        //
        // Feature 4: only MEASURED items are considered, and an item counts only when all
        // five dimensions are present. Object.values over a nullable scores object coerces
        // null to 0, so a single unmeasured answer used to read as a 0/100 and nominate its
        // topic as a weakness — the roadmap would then tell the candidate to go and study
        // something the interview never actually assessed.
        const weakSkills: string[] = [];
        results.qaItems.forEach(item => {
            const values = Object.values(item.scores);
            if (values.length !== 5 || values.some(value => typeof value !== 'number')) return;

            const avg = (values as number[]).reduce((a, b) => a + b, 0) / 5;
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
            technicalAverage: technical,
            communicationAverage: communication,
            logicAverage: logic,
        });
        setRoadmap(generated);
    };

    if (loading) {
        // Scoring can take a while, so show the results layout (hero ring, score
        // tiles, panels) rather than a spinner — the page reads as nearly there.
        return (
            <PageShell width="full" padded={false} showFooter={false}>
                <div role="status">
                    <span className="sr-only">Analyzing your performance…</span>
                    <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-10 pb-8">
                        <div className="flex items-center justify-between mb-8">
                            <Skeleton className="h-4 w-40" />
                            <div className="flex gap-2">
                                <Skeleton className="h-8 w-28" />
                                <Skeleton className="h-8 w-32" />
                            </div>
                        </div>
                        <div className="flex flex-col sm:flex-row items-center gap-8 w-full justify-center sm:justify-start">
                            <Skeleton className="w-32 h-32 sm:w-40 sm:h-40 flex-shrink-0 rounded-full" />
                            <div className="space-y-3 w-full">
                                <Skeleton className="h-9 w-64" />
                                <Skeleton className="h-4 w-48" />
                            </div>
                        </div>
                    </div>
                    <div className="max-w-4xl mx-auto px-4 sm:px-6 pb-10">
                        <SkeletonStatRow count={3} className="mb-6" />
                        <SkeletonList rows={3} />
                    </div>
                </div>
            </PageShell>
        );
    }

    if (!data) {
        return (
            <PageShell width="narrow">
                <EmptyState
                    icon={<AlertCircle size={32} />}
                    title="Results not available"
                    description="This session may still be processing, or the report has been removed."
                    action={
                        <button onClick={() => router.push('/dashboard')} className="btn-primary sheen px-5 py-2.5">
                            Go to Dashboard
                        </button>
                    }
                />
            </PageShell>
        );
    }

    // `null`, not 0. Every comparison below has to know which it has, because a null that
    // fell through the old `>= 80 ? ... : ...` chain landed on the LAST branch — so an
    // unscored interview was labelled "💪 Room to Grow", i.e. the page told the candidate
    // they had performed poorly on the strength of having no measurement at all.
    const score = data.overallScore;
    const assessed = score !== null;
    const stored = data.scoreBreakdown ?? null;
    // Every chart below needs five real numbers. All five or nothing: the server writes the
    // breakdown all-or-none, so a partial one means something is wrong, and drawing bars for
    // it would put a fabricated 0 in whatever gap there was.
    const breakdown = stored !== null
        && Object.values(stored).length === 5
        && Object.values(stored).every((value) => typeof value === "number")
        ? (stored as unknown as ScoreBreakdown)
        : null;
    // Dimensions ordered weakest-first, for the roadmap line. Empty when nothing was
    // measured, so the sentence degrades to a dash rather than to an invented topic.
    const weakestSkills = breakdown === null
        ? []
        : Object.entries(breakdown).sort(([, a], [, b]) => a - b).map(([key]) => key);
    const scoreColor = score === null ? '#64748b' : score >= 80 ? '#0ca30c' : score >= 60 ? '#fab219' : score >= 40 ? '#ec835a' : '#d03b3b';
    const scoreLabel = score === null
        ? 'Not measured'
        : score >= 80 ? '🏆 Excellent Performance' : score >= 60 ? '👍 Good Performance' : score >= 40 ? '📈 Keep Practicing' : '💪 Room to Grow';

    const tabs = [
        { id: 'overview', label: 'Overview', icon: <BarChart2 size={14} /> },
        { id: 'questions', label: `Q&A (${data.qaItems.length})`, icon: <MessageSquare size={14} /> },
        { id: 'roadmap', label: 'Roadmap', icon: <Target size={14} /> },
        // Feature 4: "How your score was decided". A tab rather than a link out, because it
        // is part of the same answer to the same question — the candidate should not have to
        // go looking for the record behind their own score.
        { id: 'decided', label: 'How it was decided', icon: <FileSearch size={14} /> },
    ] as const;

    return (
        <PageShell width="full" padded={false} showFooter={false}>
            {/* ── Hero Header ── */}
            <div className="relative overflow-hidden">
                {/* Background gradient */}
                <div className="absolute inset-0 bg-gradient-to-br from-brand-950/50 via-slate-950 to-brand-950/30" />
                <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, rgba(250,204,21,0.10) 0%, transparent 60%), radial-gradient(circle at 70% 50%, rgba(234,179,8,0.08) 0%, transparent 60%)' }} />

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
                            {/* Feature 2: the delivery report for this session. Shown
                                unconditionally — an interview taken by typing has a
                                report that says so, which is more use than a button
                                that appears and disappears with no explanation. */}
                            <button onClick={() => router.push(`/delivery/${sessionId}`)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition-colors border border-slate-700">
                                <Activity size={14} /> How you delivered it
                            </button>
                            <button onClick={() => router.push('/')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm transition-colors">
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
                                {/* Feature 4: each of these badges is a claim ABOUT the
                                    candidate, so none may appear without a measurement.
                                    The comparisons are already null-safe - `null >= 70` is
                                    false - but gating on the value states the intent
                                    instead of depending on a JavaScript coercion. */}
                                {score !== null && score >= 70 && (
                                    <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs border border-emerald-500/20">
                                        <Award size={12} /> Strong Candidate
                                    </span>
                                )}
                                {breakdown?.communication != null && breakdown.communication >= 70 && (
                                    <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 text-xs border border-blue-500/20">
                                        <MessageSquare size={12} /> Great Communicator
                                    </span>
                                )}
                                {breakdown?.technical != null && breakdown.technical >= 70 && (
                                    <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-500/10 text-brand-700 text-xs border border-brand-500/20">
                                        <Code size={12} /> Technical Strength
                                    </span>
                                )}
                            </div>
                        </motion.div>
                    </div>
                </div>
            </div>

            {/* ── Tabs ── */}
            {/* top-16 clears the sticky navbar (h-16) so the tabs stick below it
                rather than sliding underneath. */}
            <div className="sticky top-16 z-10 bg-slate-950/90 backdrop-blur-md border-b border-slate-800">
                <div className="max-w-4xl mx-auto px-4 sm:px-6">
                    <div className="flex gap-1">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id ? 'border-brand-500 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
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
                                {breakdown === null ? (
                                    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 sm:col-span-2">
                                        <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
                                            <TrendingUp size={16} className="text-brand-700" /> Scores
                                        </h3>
                                        <p className="text-sm text-slate-400">
                                            None of your answers in this interview carry a score. A score is only
                                            recorded when it can be traced back to the AI interviewer&apos;s
                                            evaluation of that specific answer, and nothing here could be - so
                                            rather than showing you zeroes, this page shows you nothing.
                                        </p>
                                    </div>
                                ) : (
                                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
                                    <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
                                        <TrendingUp size={16} className="text-brand-700" /> Skill Radar
                                    </h3>
                                    <div className="flex justify-center">
                                        <RadarChart scores={breakdown} />
                                    </div>
                                </div>
                                )}

                                {/* Score Bars */}
                                {breakdown !== null && (
                                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
                                    <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
                                        <BarChart2 size={16} className="text-brand-700" /> Score Breakdown
                                    </h3>
                                    <div className="space-y-4">
                                        <ScoreBar label="Technical" value={breakdown.technical} color="#eda100" icon={<Code size={14} />} />
                                        <ScoreBar label="Communication" value={breakdown.communication} color="#eda100" icon={<MessageSquare size={14} />} />
                                        <ScoreBar label="Confidence" value={breakdown.confidence} color="#eda100" icon={<Zap size={14} />} />
                                        <ScoreBar label="Logic" value={breakdown.logic} color="#eda100" icon={<Brain size={14} />} />
                                        <ScoreBar label="Depth" value={breakdown.depth} color="#eda100" icon={<Layers size={14} />} />
                                    </div>
                                </div>
                                )}
                            </div>

                            {/* Quick stats */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                {/* Feature 4: "Not measured" rather than "NaN%", and the two
                                    best/weakest tiles are blank when there is no breakdown -
                                    Object.entries(null) throws, which took the whole page
                                    down rather than degrading. */}
                                {[
                                    { label: 'Overall Score', value: score === null ? 'Not measured' : `${Math.round(score)}%`, icon: <Trophy size={18} className="text-amber-400" />, color: 'text-amber-400' },
                                    { label: 'Questions', value: data.qaItems.length, icon: <MessageSquare size={18} className="text-blue-400" />, color: 'text-blue-400' },
                                    { label: 'Best Skill', value: breakdown === null ? '-' : Object.entries(breakdown).sort(([, a], [, b]) => (b as number) - (a as number))[0]?.[0] || 'N/A', icon: <Star size={18} className="text-brand-700" />, color: 'text-brand-700' },
                                    { label: 'Needs Work', value: breakdown === null ? '-' : Object.entries(breakdown).sort(([, a], [, b]) => (a as number) - (b as number))[0]?.[0] || 'N/A', icon: <Target size={18} className="text-brand-700" />, color: 'text-brand-700' },
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
                                        Based on your performance, focus on: <span className="text-brand-700 capitalize">{weakestSkills[0] ?? '-'}</span> and <span className="text-brand-700 capitalize">{weakestSkills[1] ?? '-'}</span>
                                    </p>
                                </div>
                            </div>

                            <div className="grid sm:grid-cols-2 gap-4">
                                {roadmap ? (
                                    <>
                                        <RoadmapWeek week={roadmap.week1} title="Foundation" color="from-blue-600 to-cyan-600" index={0} />
                                        <RoadmapWeek week={roadmap.week2} title="Deep Dive" color="from-brand-600 to-brand-600" index={1} />
                                        <RoadmapWeek week={roadmap.week3} title="Practice" color="from-emerald-600 to-teal-600" index={2} />
                                        <RoadmapWeek week={roadmap.week4} title="Polish" color="from-amber-600 to-orange-600" index={3} />
                                    </>
                                ) : (
                                    <div className="col-span-2 text-center py-10 text-slate-500">
                                        <div className="animate-spin w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full mx-auto mb-2" />
                                        Generating your personal roadmap...
                                    </div>
                                )}
                            </div>

                            {/* CTA */}
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mt-6 p-6 bg-gradient-to-r from-brand-900/30 to-brand-900/30 border border-brand-500/20 rounded-2xl text-center">
                                <Trophy size={32} className="text-amber-400 mx-auto mb-3" />
                                <h3 className="text-lg font-bold text-white mb-1">Ready for the next round?</h3>
                                <p className="text-slate-400 text-sm mb-4">Practice makes perfect. Start another interview to track your progress.</p>
                                <button onClick={() => router.push('/')} className="inline-flex items-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-500 text-white font-semibold rounded-xl transition-colors">
                                    Start New Interview <ArrowRight size={16} />
                                </button>
                            </motion.div>
                        </motion.div>
                    )}

                    {/* How It Was Decided Tab — Feature 4 */}
                    {/* The whole provenance view is one child component, including its own
                        fetch and its own error state. It fails on its own without taking the
                        results page down with it: a candidate whose provenance record cannot
                        be read should still see their Q&A and their roadmap. */}
                    {activeTab === 'decided' && (
                        <div key="decided">
                            <ScoreProvenance sessionId={sessionId} qaItems={data.qaItems} />
                        </div>
                    )}
                </AnimatePresence>
            </div>
        </PageShell>
    );
};

export default InterviewResults;
