'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { User, Briefcase, Clock } from 'lucide-react';

interface CandidateDetails {
    candidateName: string;
    currentRole: string;
    yearsExperience: string;
}

interface CandidateDetailsCardProps {
    value: CandidateDetails;
    onChange: (value: CandidateDetails) => void;
}

const CandidateDetailsCard: React.FC<CandidateDetailsCardProps> = ({ value, onChange }) => {
    const updateField = (field: keyof CandidateDetails, fieldValue: string) => {
        onChange({ ...value, [field]: fieldValue });
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut', delay: 0.3 }}
            className="rounded-2xl bg-slate-900/80 border border-slate-800/60 p-6 backdrop-blur-sm"
        >
            {/* Card Header */}
            <div className="flex items-center gap-3 mb-1">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-500/10">
                    <User className="w-4 h-4 text-emerald-400" />
                </div>
                <h2 className="text-lg font-serif text-white">Candidate Details</h2>
                <span className="ml-auto px-2.5 py-0.5 text-xs font-medium text-slate-500 bg-slate-800/60 border border-slate-700/40 rounded-full">
                    Optional
                </span>
            </div>
            <p className="text-xs text-slate-500 mb-6 ml-12">
                Personalize your session for more relevant questions
            </p>

            {/* Fields */}
            <div className="space-y-4">
                {/* Candidate Name */}
                <div className="space-y-1.5">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-400">
                        <User className="w-3.5 h-3.5" />
                        Name
                    </label>
                    <input
                        type="text"
                        value={value.candidateName}
                        onChange={(e) => updateField('candidateName', e.target.value)}
                        placeholder="Your name"
                        className="w-full px-4 py-2.5 bg-slate-800/40 border border-slate-700/40 rounded-xl text-white placeholder-slate-600 text-sm transition-all duration-200 focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/15 hover:border-slate-600"
                    />
                </div>

                {/* Current Role */}
                <div className="space-y-1.5">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-400">
                        <Briefcase className="w-3.5 h-3.5" />
                        Current Role
                    </label>
                    <input
                        type="text"
                        value={value.currentRole}
                        onChange={(e) => updateField('currentRole', e.target.value)}
                        placeholder="e.g., Junior Developer at Acme Corp"
                        className="w-full px-4 py-2.5 bg-slate-800/40 border border-slate-700/40 rounded-xl text-white placeholder-slate-600 text-sm transition-all duration-200 focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/15 hover:border-slate-600"
                    />
                </div>

                {/* Years of Experience */}
                <div className="space-y-1.5">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-400">
                        <Clock className="w-3.5 h-3.5" />
                        Years of Experience
                    </label>
                    <input
                        type="text"
                        value={value.yearsExperience}
                        onChange={(e) => updateField('yearsExperience', e.target.value)}
                        placeholder="e.g., 2 years"
                        className="w-full px-4 py-2.5 bg-slate-800/40 border border-slate-700/40 rounded-xl text-white placeholder-slate-600 text-sm transition-all duration-200 focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/15 hover:border-slate-600"
                    />
                </div>
            </div>
        </motion.div>
    );
};

export default CandidateDetailsCard;
