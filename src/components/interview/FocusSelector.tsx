'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Target, Check } from 'lucide-react';

interface FocusSelectorProps {
    value: string[];
    onChange: (value: string[]) => void;
}

const focusOptions = [
    { id: 'dsa', label: 'Data Structures & Algorithms', emoji: '🧮' },
    { id: 'system-design', label: 'System Design', emoji: '🏗️' },
    { id: 'core-cs', label: 'Core Computer Science', emoji: '💻' },
    { id: 'behavioral', label: 'Behavioral', emoji: '🤝' },
    { id: 'communication', label: 'Communication', emoji: '🗣️' },
    { id: 'mixed', label: 'Mixed Mode', emoji: '🔀' },
];

const FocusSelector: React.FC<FocusSelectorProps> = ({ value, onChange }) => {
    const toggleFocus = (id: string) => {
        if (value.includes(id)) {
            onChange(value.filter((v) => v !== id));
        } else {
            onChange([...value, id]);
        }
    };

    return (
        <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
                <Target className="w-4 h-4 text-blue-400" />
                Interview Focus
                <span className="text-red-400">*</span>
            </label>
            <p className="text-xs text-slate-500 -mt-1">
                Select one or more areas to focus on
            </p>
            <div className="flex flex-wrap gap-2">
                {focusOptions.map((option) => {
                    const isSelected = value.includes(option.id);
                    return (
                        <motion.button
                            key={option.id}
                            type="button"
                            onClick={() => toggleFocus(option.id)}
                            whileTap={{ scale: 0.95 }}
                            className={`
                relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                transition-all duration-200 border
                ${isSelected
                                    ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                                    : 'bg-slate-800/40 border-slate-700/40 text-slate-400 hover:border-slate-600 hover:text-slate-300'
                                }
              `}
                        >
                            {isSelected && (
                                <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    className="flex items-center justify-center"
                                >
                                    <Check className="w-3.5 h-3.5 text-blue-400" />
                                </motion.div>
                            )}
                            <span>{option.emoji}</span>
                            <span>{option.label}</span>
                        </motion.button>
                    );
                })}
            </div>
        </div>
    );
};

export default FocusSelector;
