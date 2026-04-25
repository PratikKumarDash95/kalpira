'use client';

import React, { useEffect, useMemo } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';

interface ReadinessGaugeProps {
    score: number | undefined;
}

const SIZE = 220;
const STROKE_WIDTH = 12;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function getColorScheme(score: number): {
    ring: string;
    glow: string;
    text: string;
    bg: string;
    label: string;
} {
    if (score >= 85) {
        return {
            ring: '#10b981',
            glow: 'rgba(16, 185, 129, 0.25)',
            text: 'text-emerald-400',
            bg: 'from-emerald-500/10 to-emerald-500/5',
            label: 'Excellent',
        };
    }
    if (score >= 60) {
        return {
            ring: '#3b82f6',
            glow: 'rgba(59, 130, 246, 0.25)',
            text: 'text-blue-400',
            bg: 'from-blue-500/10 to-blue-500/5',
            label: 'Good Progress',
        };
    }
    return {
        ring: '#f97316',
        glow: 'rgba(249, 115, 22, 0.25)',
        text: 'text-orange-400',
        bg: 'from-orange-500/10 to-orange-500/5',
        label: 'Needs Work',
    };
}

const ReadinessGauge: React.FC<ReadinessGaugeProps> = ({ score }) => {
    const safeScore = typeof score === 'number' ? Math.min(100, Math.max(0, score)) : 0;
    const isLoading = typeof score !== 'number';
    const colors = useMemo(() => getColorScheme(safeScore), [safeScore]);

    // Animated counter
    const motionVal = useMotionValue(0);
    const displayVal = useTransform(motionVal, (v) => Math.round(v));

    // Animated stroke offset
    const strokeMotion = useMotionValue(CIRCUMFERENCE);

    useEffect(() => {
        if (isLoading) return;
        const targetOffset = CIRCUMFERENCE - (safeScore / 100) * CIRCUMFERENCE;
        const controls1 = animate(motionVal, safeScore, {
            duration: 1.4,
            ease: 'easeOut',
        });
        const controls2 = animate(strokeMotion, targetOffset, {
            duration: 1.4,
            ease: 'easeOut',
        });
        return () => {
            controls1.stop();
            controls2.stop();
        };
    }, [safeScore, isLoading, motionVal, strokeMotion]);

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-12">
                <div className="w-[220px] h-[220px] rounded-full bg-slate-800/50 animate-pulse" />
                <div className="mt-6 h-5 w-40 bg-slate-800/50 rounded animate-pulse" />
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="flex flex-col items-center"
        >
            {/* Glow container */}
            <div
                className="relative flex items-center justify-center"
                style={{
                    filter: `drop-shadow(0 0 30px ${colors.glow})`,
                }}
            >
                <svg
                    width={SIZE}
                    height={SIZE}
                    className="-rotate-90"
                >
                    {/* Background track */}
                    <circle
                        cx={SIZE / 2}
                        cy={SIZE / 2}
                        r={RADIUS}
                        fill="none"
                        stroke="rgba(148, 163, 184, 0.1)"
                        strokeWidth={STROKE_WIDTH}
                    />
                    {/* Animated ring */}
                    <motion.circle
                        cx={SIZE / 2}
                        cy={SIZE / 2}
                        r={RADIUS}
                        fill="none"
                        stroke={colors.ring}
                        strokeWidth={STROKE_WIDTH}
                        strokeLinecap="round"
                        strokeDasharray={CIRCUMFERENCE}
                        style={{ strokeDashoffset: strokeMotion }}
                    />
                </svg>
                {/* Center text */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div className="flex items-baseline gap-0.5">
                        <motion.span
                            className={`text-5xl font-bold tracking-tight ${colors.text}`}
                        >
                            {displayVal}
                        </motion.span>
                        <span className={`text-2xl font-semibold ${colors.text} opacity-70`}>%</span>
                    </div>
                    <span className="text-xs text-slate-400 mt-1 tracking-widest uppercase">
                        {colors.label}
                    </span>
                </div>
            </div>
            {/* Title and description */}
            <h2 className="mt-6 text-2xl font-serif text-white tracking-tight">
                Interview Readiness
            </h2>
            <p className="mt-2 text-sm text-slate-400 text-center max-w-xs leading-relaxed">
                Calculated using performance, difficulty progression, and consistency.
            </p>
        </motion.div>
    );
};

export default React.memo(ReadinessGauge);
