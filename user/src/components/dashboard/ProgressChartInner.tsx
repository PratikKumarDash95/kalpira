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
        <div className="rounded-xl border border-[color:var(--line-strong)] bg-[color:var(--surface)] px-3 py-2 shadow-card">
            <p className="mb-0.5 text-xs text-[color:var(--muted)]">Session {label}</p>
            <p className="text-sm font-bold text-[color:var(--text)]">{payload[0].value.toFixed(1)}%</p>
        </div>
    );
};

const ProgressChartInner: React.FC<ProgressChartInnerProps> = ({ data }) => {
    return (
        <div className="h-[240px] -ml-2">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                    <defs>
                        {/* Brand amber ramp. The stroke lands on the dark amber
                            step so a 2.5px line stays legible on white; the
                            bright brand yellow carries the area fill. */}
                        <linearGradient id="scoreGradient" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#a16207" />
                            <stop offset="100%" stopColor="#eda100" />
                        </linearGradient>
                        <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#eda100" stopOpacity={0.18} />
                            <stop offset="100%" stopColor="#eda100" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#efead5"
                        vertical={false}
                    />
                    <XAxis
                        dataKey="session"
                        tick={{ fontSize: 11, fill: '#78716c' }}
                        tickLine={false}
                        axisLine={{ stroke: '#e6dcc2' }}
                        label={{ value: 'Session', position: 'insideBottomRight', offset: -4, fontSize: 10, fill: '#78716c' }}
                    />
                    <YAxis
                        domain={[0, 100]}
                        tick={{ fontSize: 11, fill: '#78716c' }}
                        tickLine={false}
                        axisLine={false}
                        width={35}
                    />
                    <Tooltip
                        content={<CustomTooltip />}
                        cursor={{ stroke: 'rgba(120, 113, 108, 0.25)' }}
                    />
                    <Line
                        type="monotone"
                        dataKey="score"
                        stroke="url(#scoreGradient)"
                        strokeWidth={2.5}
                        dot={{ r: 4, fill: '#eda100', stroke: '#ffffff', strokeWidth: 2 }}
                        activeDot={{ r: 6, fill: '#a16207', stroke: '#ffffff', strokeWidth: 2 }}
                        animationDuration={1200}
                        animationEasing="ease-out"
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
};

export default ProgressChartInner;
