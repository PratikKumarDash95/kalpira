'use client';

import React from 'react';
import { Briefcase } from 'lucide-react';

interface RoleInputProps {
    value: string;
    onChange: (value: string) => void;
}

const RoleInput: React.FC<RoleInputProps> = ({ value, onChange }) => {
    return (
        <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
                <Briefcase className="w-4 h-4 text-blue-400" />
                Target Role
                <span className="text-red-400">*</span>
            </label>
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="e.g., Backend Developer, Data Scientist, Product Manager"
                className="w-full px-4 py-3 bg-slate-800/60 border border-slate-700/60 rounded-xl text-white placeholder-slate-500 text-sm transition-all duration-200 focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20 hover:border-slate-600"
            />
            <p className="text-xs text-slate-500">
                The AI will tailor questions specifically for this role
            </p>
        </div>
    );
};

export default RoleInput;
