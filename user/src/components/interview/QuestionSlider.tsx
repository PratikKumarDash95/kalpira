'use client';

import React from 'react';
import { Hash, Minus, Plus } from 'lucide-react';

interface QuestionSliderProps {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
}

const QuestionSlider: React.FC<QuestionSliderProps> = ({
    value,
    onChange,
    min = 3,
    max = 15,
}) => {
    const percentage = ((value - min) / (max - min)) * 100;

    const decrement = () => {
        if (value > min) onChange(value - 1);
    };

    const increment = () => {
        if (value < max) onChange(value + 1);
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
                    <Hash className="w-4 h-4 text-blue-400" />
                    Number of Questions
                </label>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={decrement}
                        disabled={value <= min}
                        className="p-1 rounded-lg bg-slate-800/60 border border-slate-700/60 text-slate-400 hover:text-white hover:border-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    >
                        <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-8 text-center text-lg font-semibold text-white tabular-nums">
                        {value}
                    </span>
                    <button
                        type="button"
                        onClick={increment}
                        disabled={value >= max}
                        className="p-1 rounded-lg bg-slate-800/60 border border-slate-700/60 text-slate-400 hover:text-white hover:border-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    >
                        <Plus className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            <div className="relative">
                <input
                    type="range"
                    min={min}
                    max={max}
                    value={value}
                    onChange={(e) => onChange(Number(e.target.value))}
                    className="w-full h-2 bg-slate-800 rounded-full appearance-none cursor-pointer slider-input"
                    style={{
                        background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${percentage}%, #1e293b ${percentage}%, #1e293b 100%)`,
                    }}
                />
            </div>

            <div className="flex justify-between text-xs text-slate-600">
                <span>Quick ({min})</span>
                <span>Standard (8)</span>
                <span>Deep ({max})</span>
            </div>
        </div>
    );
};

export default QuestionSlider;
