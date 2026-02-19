'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { BarChart3 } from 'lucide-react';
import dynamic from 'next/dynamic';

// Dynamic import to avoid SSR issues with Recharts
const RechartsLineChart = dynamic(
    () => import('./ProgressChartInner'),
    { ssr: false, loading: () => <ChartSkeleton /> }
);

interface SessionDataPoint {
    session: number;
    score: number;
}

interface ProgressChartProps {
    data: SessionDataPoint[] | undefined;
}

function ChartSkeleton() {
    return (
        <div className="flex items-center justify-center h-[240px] rounded-xl bg-slate-800/30 border border-slate-700/20">
            <div className="text-sm text-slate-600 animate-pulse">Loading chart...</div>
        </div>
    );
}

const ProgressChart: React.FC<ProgressChartProps> = ({ data }) => {
    const chartData = useMemo(() => data ?? [], [data]);
    const hasData = chartData.length > 0;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut', delay: 0.4 }}
            className="rounded-2xl bg-slate-900/80 border border-slate-800/60 p-6 backdrop-blur-sm"
        >
            {/* Header */}
            <div className="flex items-center gap-3 mb-1">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-indigo-500/10">
                    <BarChart3 className="w-4 h-4 text-indigo-400" />
                </div>
                <h3 className="text-lg font-serif text-white">Progress Trend</h3>
            </div>
            <p className="text-xs text-slate-500 mb-5 ml-12">
                Overall score improvement across sessions
            </p>

            {/* Chart */}
            {!hasData ? (
                <div className="flex items-center justify-center h-[240px] rounded-xl bg-slate-800/30 border border-slate-700/20">
                    <p className="text-sm text-slate-500">
                        Complete interview sessions to see your progress.
                    </p>
                </div>
            ) : (
                <RechartsLineChart data={chartData} />
            )}
        </motion.div>
    );
};

export default React.memo(ProgressChart);
