'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
    Brain,
    Sparkles,
    ArrowLeft,
    LogOut,
    RefreshCw,
} from 'lucide-react';
import ReadinessGauge from './ReadinessGauge';
import WeakSkillsCard from './WeakSkillsCard';
import RoadmapTimeline from './RoadmapTimeline';
import BadgesGrid from './BadgesGrid';
import ProgressChart from './ProgressChart';

// ============================================
// Type Definitions
// ============================================

interface WeekTask {
    topic: string;
    action: string;
    frequency: string;
    priority: 'high' | 'medium' | 'low';
}

interface Roadmap {
    week1: WeekTask[];
    week2: WeekTask[];
    week3: WeekTask[];
    week4: WeekTask[];
}

interface BadgeData {
    badgeName: string;
    description: string;
    awardedAt: string | Date;
    isNew: boolean;
}

interface SessionDataPoint {
    session: number;
    score: number;
}

interface CoachDashboardData {
    readinessScore: number;
    weakSkills: string[];
    roadmap: Roadmap | null;
    badges: BadgeData[];
    progressData: SessionDataPoint[];
    difficulty: string;
    totalSessions: number;
}

// ============================================
// API Helpers
// ============================================

async function fetchDashboardData(): Promise<CoachDashboardData> {
    const response = await fetch('/api/coach/dashboard');
    if (!response.ok) {
        throw new Error(`Dashboard API returned ${response.status}`);
    }
    return response.json();
}

// ============================================
// Component
// ============================================

const CoachDashboard: React.FC = () => {
    const router = useRouter();
    const [data, setData] = useState<CoachDashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await fetchDashboardData();
            setData(result);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to load dashboard data';
            setError(msg);
            console.error('[CoachDashboard] Load failed:', msg);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleLogout = useCallback(async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
            router.push('/login');
        } catch {
            router.push('/login');
        }
    }, [router]);

    // Error state
    if (error && !data) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center max-w-md"
                >
                    <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                        <Sparkles className="w-6 h-6 text-red-400" />
                    </div>
                    <h2 className="text-xl font-serif text-white mb-2">Unable to Load Dashboard</h2>
                    <p className="text-sm text-slate-400 mb-6">{error}</p>
                    <button
                        onClick={loadData}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 transition-colors"
                    >
                        <RefreshCw className="w-4 h-4" /> Retry
                    </button>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-950">
            {/* ── Header ── */}
            <header className="sticky top-0 z-40 backdrop-blur-xl bg-slate-950/80 border-b border-slate-800/50">
                <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => router.push('/dashboard')}
                            className="p-2 rounded-xl hover:bg-slate-800/60 transition-colors"
                            title="Back to main dashboard"
                        >
                            <ArrowLeft className="w-4 h-4 text-slate-400" />
                        </button>
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                                <Brain className="w-4 h-4 text-white" />
                            </div>
                            <div>
                                <h1 className="text-base font-semibold text-white tracking-tight leading-none">
                                    Interview Coach
                                </h1>
                                <p className="text-[10px] text-slate-500 tracking-wider uppercase mt-0.5">
                                    AI-Powered Intelligence
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={loadData}
                            disabled={loading}
                            className="p-2 rounded-xl hover:bg-slate-800/60 transition-colors disabled:opacity-40"
                            title="Refresh data"
                        >
                            <RefreshCw className={`w-4 h-4 text-slate-400 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                            onClick={handleLogout}
                            className="p-2 rounded-xl hover:bg-slate-800/60 transition-colors"
                            title="Log out"
                        >
                            <LogOut className="w-4 h-4 text-slate-400" />
                        </button>
                    </div>
                </div>
            </header>

            {/* ── Main Content ── */}
            <main className="max-w-6xl mx-auto px-6 py-10">
                {/* ── Hero: Readiness Gauge ── */}
                <section className="flex justify-center mb-14">
                    <div className="w-full max-w-lg rounded-3xl bg-gradient-to-b from-slate-900/80 to-slate-900/40 border border-slate-800/50 p-10 backdrop-blur-sm">
                        <ReadinessGauge score={data?.readinessScore} />

                        {/* Quick stats strip */}
                        {data && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 0.8 }}
                                className="mt-8 flex items-center justify-center gap-8"
                            >
                                <QuickStat label="Sessions" value={data.totalSessions} />
                                <div className="w-px h-8 bg-slate-700/50" />
                                <QuickStat label="Difficulty" value={capitalize(data.difficulty)} />
                                <div className="w-px h-8 bg-slate-700/50" />
                                <QuickStat label="Weak Areas" value={data.weakSkills.length} />
                            </motion.div>
                        )}
                    </div>
                </section>

                {/* ── Two Column Grid: Left (Weak Skills + Badges) | Right (Roadmap) ── */}
                <section className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-10">
                    {/* Left column: 2/5 width */}
                    <div className="lg:col-span-2 space-y-6">
                        <WeakSkillsCard weakSkills={data?.weakSkills} />
                        <BadgesGrid badges={data?.badges} />
                    </div>

                    {/* Right column: 3/5 width */}
                    <div className="lg:col-span-3">
                        <RoadmapTimeline roadmap={data?.roadmap} />
                    </div>
                </section>

                {/* ── Bottom: Progress Chart ── */}
                <section className="mb-10">
                    <ProgressChart data={data?.progressData} />
                </section>

                {/* ── Footer tag ── */}
                <footer className="text-center pb-8">
                    <p className="text-xs text-slate-600">
                        Adaptive Interview Intelligence Platform • Powered by AI
                    </p>
                </footer>
            </main>
        </div>
    );
};

// ============================================
// Sub-component: Quick stat pill
// ============================================

interface QuickStatProps {
    label: string;
    value: string | number;
}

const QuickStat: React.FC<QuickStatProps> = ({ label, value }) => (
    <div className="text-center">
        <p className="text-lg font-semibold text-white leading-none">{value}</p>
        <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-1">{label}</p>
    </div>
);

function capitalize(str: string): string {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export default CoachDashboard;
