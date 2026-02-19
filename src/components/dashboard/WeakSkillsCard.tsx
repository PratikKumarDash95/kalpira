'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

interface WeakSkillsCardProps {
    weakSkills: string[] | undefined;
}

/** Maps index position to a severity color from light red → dark red */
function getSeverityColor(index: number, total: number): string {
    if (total <= 1) return 'bg-red-500/20 text-red-300 border-red-500/30';
    const ratio = index / (total - 1);
    if (ratio < 0.33) return 'bg-red-400/15 text-red-300 border-red-400/25';
    if (ratio < 0.66) return 'bg-red-500/20 text-red-400 border-red-500/30';
    return 'bg-red-600/25 text-red-300 border-red-600/35';
}

const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: { staggerChildren: 0.06 },
    },
};

const tagVariants = {
    hidden: { opacity: 0, scale: 0.8 },
    visible: { opacity: 1, scale: 1 },
};

const WeakSkillsCard: React.FC<WeakSkillsCardProps> = ({ weakSkills }) => {
    const skills = weakSkills ?? [];
    const isEmpty = skills.length === 0;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut', delay: 0.2 }}
            className="rounded-2xl bg-slate-900/80 border border-slate-800/60 p-6 backdrop-blur-sm"
        >
            {/* Header */}
            <div className="flex items-center gap-3 mb-1">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-red-500/10">
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                </div>
                <h3 className="text-lg font-serif text-white">Focus Areas</h3>
            </div>
            <p className="text-xs text-slate-500 mb-5 ml-12">
                Identified across interview sessions
            </p>

            {/* Content */}
            {isEmpty ? (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="flex items-center gap-3 py-6 px-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10"
                >
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                    <p className="text-sm text-emerald-300/90">
                        Great! No persistent weaknesses detected.
                    </p>
                </motion.div>
            ) : (
                <motion.div
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                    className="flex flex-wrap gap-2.5"
                >
                    {skills.map((skill, index) => (
                        <motion.span
                            key={skill}
                            variants={tagVariants}
                            whileHover={{
                                y: -2,
                                boxShadow: '0 4px 20px rgba(239, 68, 68, 0.15)',
                            }}
                            className={`
                inline-flex items-center px-3.5 py-1.5 rounded-full text-sm font-medium
                border cursor-default transition-colors duration-200
                ${getSeverityColor(index, skills.length)}
              `}
                        >
                            {skill}
                        </motion.span>
                    ))}
                </motion.div>
            )}
        </motion.div>
    );
};

export default React.memo(WeakSkillsCard);
