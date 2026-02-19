'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Gauge } from 'lucide-react';

type Difficulty = 'easy' | 'medium' | 'hard';

interface DifficultyToggleProps {
    value: Difficulty;
    onChange: (value: Difficulty) => void;
}

const options: { value: Difficulty; label: string; color: string }[] = [
    { value: 'easy', label: 'Easy', color: 'text-emerald-400' },
    { value: 'medium', label: 'Medium', color: 'text-blue-400' },
    { value: 'hard', label: 'Hard', color: 'text-orange-400' },
];

const DifficultyToggle: React.FC<DifficultyToggleProps> = ({ value, onChange }) => {
    return (
        <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
                <Gauge className="w-4 h-4 text-blue-400" />
                Difficulty Level
            </label>
            <div className="flex bg-slate-800/60 border border-slate-700/60 rounded-xl p-1 gap-1">
                {options.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => onChange(option.value)}
                        className="relative flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors duration-200 z-10"
                    >
                        {value === option.value && (
                            <motion.div
                                layoutId="difficulty-indicator"
                                className="absolute inset-0 bg-slate-700/80 border border-slate-600/50 rounded-lg"
                                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                            />
                        )}
                        <span className={`relative z-10 ${value === option.value ? option.color : 'text-slate-500'}`}>
                            {option.label}
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
};

export default DifficultyToggle;
