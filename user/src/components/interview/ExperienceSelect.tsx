'use client';

import React from 'react';
import { GraduationCap, ChevronDown } from 'lucide-react';

interface ExperienceSelectProps {
    value: string;
    onChange: (value: string) => void;
}

const experienceLevels = [
    { value: 'fresher', label: 'Fresher', description: 'No prior experience' },
    { value: '1-3', label: '1–3 Years', description: 'Early career' },
    { value: '3-5', label: '3–5 Years', description: 'Mid-level' },
    { value: '5+', label: '5+ Years', description: 'Senior level' },
];

const ExperienceSelect: React.FC<ExperienceSelectProps> = ({ value, onChange }) => {
    return (
        <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
                <GraduationCap className="w-4 h-4 text-blue-400" />
                Experience Level
                <span className="text-red-400">*</span>
            </label>
            <div className="relative">
                <select
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-800/60 border border-slate-700/60 rounded-xl text-white text-sm appearance-none cursor-pointer transition-all duration-200 focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20 hover:border-slate-600"
                >
                    <option value="" disabled className="bg-slate-900 text-slate-500">
                        Select experience level
                    </option>
                    {experienceLevels.map((level) => (
                        <option
                            key={level.value}
                            value={level.value}
                            className="bg-slate-900 text-white"
                        >
                            {level.label} — {level.description}
                        </option>
                    ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            </div>
        </div>
    );
};

export default ExperienceSelect;
