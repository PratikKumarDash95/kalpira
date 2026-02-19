'use client';

import React from 'react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    CartesianGrid,
} from 'recharts';

interface SessionDataPoint {
    session: number;
    score: number;
}

interface ProgressChartInnerProps {
    data: SessionDataPoint[];
}

interface CustomTooltipProps {
    active?: boolean;
    payload?: Array<{ value: number }>;
    label?: string | number;
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload, label }) => {
    if (!active || !payload || payload.length === 0) return null;
    return (
        <div className="bg-slate-800 border border-slate-700/60 rounded-lg px-3 py-2 shadow-xl">
            <p className="text-xs text-slate-400 mb-0.5">Session {label}</p>
            <p className="text-sm font-semibold text-white">{payload[0].value.toFixed(1)}%</p>
        </div>
    );
};

const ProgressChartInner: React.FC<ProgressChartInnerProps> = ({ data }) => {
    return (
        <div className="h-[240px] -ml-2">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                    <defs>
                        <linearGradient id="scoreGradient" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#6366f1" />
                            <stop offset="100%" stopColor="#3b82f6" />
                        </linearGradient>
                        <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.15} />
                            <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="rgba(148, 163, 184, 0.06)"
                        vertical={false}
                    />
                    <XAxis
                        dataKey="session"
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        tickLine={false}
                        axisLine={{ stroke: 'rgba(148, 163, 184, 0.1)' }}
                        label={{ value: 'Session', position: 'insideBottomRight', offset: -4, fontSize: 10, fill: '#475569' }}
                    />
                    <YAxis
                        domain={[0, 100]}
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        tickLine={false}
                        axisLine={false}
                        width={35}
                    />
                    <Tooltip
                        content={<CustomTooltip />}
                        cursor={{ stroke: 'rgba(148, 163, 184, 0.15)' }}
                    />
                    <Line
                        type="monotone"
                        dataKey="score"
                        stroke="url(#scoreGradient)"
                        strokeWidth={2.5}
                        dot={{ r: 4, fill: '#6366f1', stroke: '#1e1b4b', strokeWidth: 2 }}
                        activeDot={{ r: 6, fill: '#818cf8', stroke: '#1e1b4b', strokeWidth: 2 }}
                        animationDuration={1200}
                        animationEasing="ease-out"
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
};

export default ProgressChartInner;
