'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
    Award,
    Code2,
    MessageCircle,
    Shield,
    TrendingUp,
} from 'lucide-react';

interface BadgeData {
    badgeName: string;
    description: string;
    awardedAt: string | Date;
    isNew: boolean;
}

interface BadgesGridProps {
    badges: BadgeData[] | undefined;
}

/** Badge visual configuration */
interface BadgeVisual {
    icon: React.ReactNode;
    gradient: string;
    glow: string;
}

const BADGE_VISUALS: Record<string, BadgeVisual> = {
    'DSA Master': {
        icon: <Code2 className="w-6 h-6" />,
        gradient: 'from-violet-500 to-purple-600',
        glow: 'shadow-violet-500/25',
    },
    'Communication Pro': {
        icon: <MessageCircle className="w-6 h-6" />,
        gradient: 'from-blue-500 to-cyan-500',
        glow: 'shadow-blue-500/25',
    },
    'Interview Ready': {
        icon: <Shield className="w-6 h-6" />,
        gradient: 'from-emerald-500 to-green-500',
        glow: 'shadow-emerald-500/25',
    },
    'Consistent Performer': {
        icon: <TrendingUp className="w-6 h-6" />,
        gradient: 'from-amber-500 to-orange-500',
        glow: 'shadow-amber-500/25',
    },
};

const DEFAULT_VISUAL: BadgeVisual = {
    icon: <Award className="w-6 h-6" />,
    gradient: 'from-slate-500 to-slate-600',
    glow: 'shadow-slate-500/25',
};

/** All possible badges for locked state display */
const ALL_BADGE_NAMES = ['DSA Master', 'Communication Pro', 'Interview Ready', 'Consistent Performer'];

const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: { staggerChildren: 0.1, delayChildren: 0.3 },
    },
};

const cardVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: { opacity: 1, y: 0 },
};

const BadgesGrid: React.FC<BadgesGridProps> = ({ badges }) => {
    const earnedBadges = badges ?? [];
    const earnedNames = new Set(earnedBadges.map((b) => b.badgeName));

    // Build combined list: earned + locked
    const allBadges = ALL_BADGE_NAMES.map((name) => {
        const earned = earnedBadges.find((b) => b.badgeName === name);
        return {
            name,
            earned: !!earned,
            isNew: earned?.isNew ?? false,
            description: earned?.description ?? getDefaultDescription(name),
        };
    });

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut', delay: 0.25 }}
            className="rounded-2xl bg-slate-900/80 border border-slate-800/60 p-6 backdrop-blur-sm"
        >
            {/* Header */}
            <div className="flex items-center gap-3 mb-1">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-amber-500/10">
                    <Award className="w-4 h-4 text-amber-400" />
                </div>
                <h3 className="text-lg font-serif text-white">Achievements</h3>
            </div>
            <p className="text-xs text-slate-500 mb-5 ml-12">
                Badges earned through interview performance
            </p>

            {/* Grid */}
            <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="grid grid-cols-2 gap-3"
            >
                {allBadges.map((badge) => {
                    const visual = BADGE_VISUALS[badge.name] ?? DEFAULT_VISUAL;

                    return (
                        <motion.div
                            key={badge.name}
                            variants={cardVariants}
                            whileHover={badge.earned ? { scale: 1.03, y: -2 } : {}}
                            className={`
                relative rounded-xl p-4 border transition-all duration-300 cursor-default
                ${badge.earned
                                    ? `bg-slate-800/60 border-slate-700/50 shadow-lg ${visual.glow}`
                                    : 'bg-slate-800/20 border-slate-800/30 grayscale opacity-40'
                                }
              `}
                        >
                            {/* New badge indicator */}
                            {badge.isNew && (
                                <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                                    <span className="text-[8px] font-bold text-white">✦</span>
                                </div>
                            )}

                            {/* Icon */}
                            <div
                                className={`
                  w-10 h-10 rounded-lg flex items-center justify-center mb-3
                  bg-gradient-to-br ${visual.gradient}
                  ${badge.earned ? 'text-white' : 'text-slate-400'}
                `}
                            >
                                {visual.icon}
                            </div>

                            {/* Text */}
                            <h4 className={`text-sm font-semibold mb-0.5 ${badge.earned ? 'text-white' : 'text-slate-500'}`}>
                                {badge.name}
                            </h4>
                            <p className={`text-[11px] leading-relaxed ${badge.earned ? 'text-slate-400' : 'text-slate-600'}`}>
                                {badge.description}
                            </p>
                        </motion.div>
                    );
                })}
            </motion.div>
        </motion.div>
    );
};

function getDefaultDescription(name: string): string {
    switch (name) {
        case 'DSA Master': return 'Achieve technical average ≥ 85';
        case 'Communication Pro': return 'Achieve communication average ≥ 80';
        case 'Interview Ready': return 'Reach readiness score ≥ 85';
        case 'Consistent Performer': return 'Complete 10+ interview sessions';
        default: return 'Keep practicing to unlock';
    }
}

export default React.memo(BadgesGrid);
