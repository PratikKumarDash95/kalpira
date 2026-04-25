'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { BrainCircuit } from 'lucide-react';

interface AdaptiveSwitchProps {
    value: boolean;
    onChange: (value: boolean) => void;
}

const AdaptiveSwitch: React.FC<AdaptiveSwitchProps> = ({ value, onChange }) => {
    return (
        <div className="flex items-center justify-between p-4 bg-slate-800/30 border border-slate-700/40 rounded-xl">
            <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg transition-colors duration-200 ${value ? 'bg-blue-500/15' : 'bg-slate-800/60'
                    }`}>
                    <BrainCircuit className={`w-5 h-5 transition-colors duration-200 ${value ? 'text-blue-400' : 'text-slate-500'
                        }`} />
                </div>
                <div>
                    <p className="text-sm font-medium text-slate-200">Adaptive Mode</p>
                    <p className="text-xs text-slate-500">
                        AI adjusts difficulty based on your performance
                    </p>
                </div>
            </div>

            <button
                type="button"
                onClick={() => onChange(!value)}
                className={`
          relative w-12 h-7 rounded-full transition-colors duration-300 focus:outline-none
          focus:ring-2 focus:ring-blue-500/30 focus:ring-offset-2 focus:ring-offset-slate-900
          ${value ? 'bg-blue-500' : 'bg-slate-700'}
        `}
                role="switch"
                aria-checked={value}
            >
                <motion.div
                    className="absolute top-1 w-5 h-5 bg-white rounded-full shadow-md"
                    animate={{ left: value ? 24 : 4 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
            </button>
        </div>
    );
};

export default AdaptiveSwitch;
