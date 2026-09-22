'use client';
import { apiFetch, apiUrl, clearSessionDrafts } from '@/lib/apiClient';

import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
    Brain,
    Sparkles,
    LogOut,
    RefreshCw,
} from 'lucide-react';
import ReadinessGauge from './ReadinessGauge';
import WeakSkillsCard from './WeakSkillsCard';
import RoadmapTimeline from './RoadmapTimeline';
import BadgesGrid from './BadgesGrid';
import ProgressChart from './ProgressChart';
import PageShell from '@/components/layout/PageShell';
import PageHeader from '@/components/layout/PageHeader';
import EmptyState from '@/components/layout/EmptyState';

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
    const response = await apiFetch('/api/coach/dashboard');
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
            await apiFetch('/api/auth/logout', { method: 'POST' });
            clearSessionDrafts();
            router.push('/login');
        } catch {
            clearSessionDrafts();
            router.push('/login');
        }
    }, [router]);

    // Error state
    if (error && !data) {
        return (
            <PageShell showFooter={false}>
                <EmptyState
                    icon={<Sparkles size={30} />}
                    title="Unable to Load Dashboard"
                    description={error}
                    action={
                        <button onClick={loadData} className="btn-primary sheen px-5 py-2.5">
                            <RefreshCw className="w-4 h-4" /> Retry
                        </button>
                    }
                />
            </PageShell>
        );
    }

    return (
        <PageShell showFooter={false}>
            <PageHeader
                back="/dashboard"
                icon={<Brain size={20} />}
                title="Interview Coach"
                subtitle="AI-Powered Intelligence"
                actions={
                    <>
                        <button
                            onClick={loadData}
                            disabled={loading}
                            className="btn-secondary p-2 disabled:opacity-40"
                            title="Refresh data"
                            aria-label="Refresh data"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                            onClick={handleLogout}
                            className="btn-ghost p-2"
                            title="Log out"
                            aria-label="Log out"
                        >
                            <LogOut className="w-4 h-4" />
                        </button>
                    </>
                }
            />

            {/* ── Main Content ── */}
            <div>
                {/* ── Hero: Readiness Gauge ── */}
                <section className="flex justify-center mb-14">
                    <div className="w-full max-w-lg rounded-3xl surface p-10">
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
            </div>
        </PageShell>
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
