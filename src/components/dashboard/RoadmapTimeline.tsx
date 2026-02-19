'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, CalendarDays, Target, Dumbbell } from 'lucide-react';

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

interface RoadmapTimelineProps {
    roadmap: Roadmap | undefined | null;
}

const WEEK_META: { key: keyof Roadmap; title: string; subtitle: string; accent: string; border: string }[] = [
    {
        key: 'week1',
        title: 'Week 1',
        subtitle: 'Fundamentals',
        accent: 'bg-blue-500',
        border: 'border-l-blue-500',
    },
    {
        key: 'week2',
        title: 'Week 2',
        subtitle: 'Intermediate Practice',
        accent: 'bg-violet-500',
        border: 'border-l-violet-500',
    },
    {
        key: 'week3',
        title: 'Week 3',
        subtitle: 'Mock Interviews',
        accent: 'bg-amber-500',
        border: 'border-l-amber-500',
    },
    {
        key: 'week4',
        title: 'Week 4',
        subtitle: 'Stress Simulation',
        accent: 'bg-emerald-500',
        border: 'border-l-emerald-500',
    },
];

const PRIORITY_BADGE: Record<string, string> = {
    high: 'bg-red-500/15 text-red-400 border-red-500/20',
    medium: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    low: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
};

const RoadmapTimeline: React.FC<RoadmapTimelineProps> = ({ roadmap }) => {
    const [openWeek, setOpenWeek] = useState<number>(0);

    if (!roadmap) {
        return (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: 'easeOut', delay: 0.3 }}
                className="rounded-2xl bg-slate-900/80 border border-slate-800/60 p-6 backdrop-blur-sm"
            >
                <div className="flex items-center gap-3 mb-4">
                    <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-blue-500/10">
                        <CalendarDays className="w-4 h-4 text-blue-400" />
                    </div>
                    <h3 className="text-lg font-serif text-white">30-Day Roadmap</h3>
                </div>
                <div className="flex items-center justify-center py-12 rounded-xl bg-slate-800/30 border border-slate-700/30">
                    <p className="text-sm text-slate-500">No plan generated yet.</p>
                </div>
            </motion.div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut', delay: 0.3 }}
            className="rounded-2xl bg-slate-900/80 border border-slate-800/60 p-6 backdrop-blur-sm"
        >
            {/* Header */}
            <div className="flex items-center gap-3 mb-1">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-blue-500/10">
                    <CalendarDays className="w-4 h-4 text-blue-400" />
                </div>
                <h3 className="text-lg font-serif text-white">30-Day Roadmap</h3>
            </div>
            <p className="text-xs text-slate-500 mb-5 ml-12">
                Personalized improvement plan based on your performance
            </p>

            {/* Accordion panels */}
            <div className="space-y-3">
                {WEEK_META.map((meta, index) => {
                    const tasks = roadmap[meta.key];
                    const isOpen = openWeek === index;

                    return (
                        <motion.div
                            key={meta.key}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.4, delay: 0.1 * index + 0.3 }}
                            className={`rounded-xl border-l-[3px] ${meta.border} bg-slate-800/40 border border-slate-700/30 overflow-hidden`}
                        >
                            {/* Week header */}
                            <button
                                onClick={() => setOpenWeek(isOpen ? -1 : index)}
                                className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-800/60 transition-colors"
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`w-2 h-2 rounded-full ${meta.accent}`} />
                                    <span className="text-sm font-semibold text-white">{meta.title}</span>
                                    <span className="text-xs text-slate-500">— {meta.subtitle}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-slate-500">{tasks.length} tasks</span>
                                    <motion.div
                                        animate={{ rotate: isOpen ? 180 : 0 }}
                                        transition={{ duration: 0.2 }}
                                    >
                                        <ChevronDown className="w-4 h-4 text-slate-500" />
                                    </motion.div>
                                </div>
                            </button>

                            {/* Week tasks */}
                            <AnimatePresence>
                                {isOpen && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.25 }}
                                        className="overflow-hidden"
                                    >
                                        <div className="px-4 pb-4 space-y-3">
                                            {tasks.map((task, taskIndex) => (
                                                <div
                                                    key={taskIndex}
                                                    className="p-3 rounded-lg bg-slate-900/60 border border-slate-700/20"
                                                >
                                                    <div className="flex items-center justify-between mb-1.5">
                                                        <div className="flex items-center gap-2">
                                                            <Target className="w-3.5 h-3.5 text-slate-400" />
                                                            <span className="text-sm font-medium text-slate-200">
                                                                {task.topic}
                                                            </span>
                                                        </div>
                                                        <span
                                                            className={`text-[10px] px-2 py-0.5 rounded-full border font-medium uppercase tracking-wider ${PRIORITY_BADGE[task.priority] ?? PRIORITY_BADGE.low}`}
                                                        >
                                                            {task.priority}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-slate-400 mb-2 leading-relaxed">
                                                        {task.action}
                                                    </p>
                                                    <div className="flex items-center gap-1.5">
                                                        <Dumbbell className="w-3 h-3 text-slate-500" />
                                                        <span className="text-[11px] text-slate-500">{task.frequency}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.div>
                    );
                })}
            </div>
        </motion.div>
    );
};

export default React.memo(RoadmapTimeline);
