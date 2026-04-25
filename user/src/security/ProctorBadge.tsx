'use client';

// ============================================
// ProctorBadge.tsx — Floating "Proctor Active" Badge
// Always-visible indicator during proctored interviews
// Shows compliance score and fullscreen status
// ============================================

import React, { useState } from 'react';
import { Shield, ShieldCheck, ShieldAlert, ChevronDown, ChevronUp } from 'lucide-react';

interface ProctorBadgeProps {
    complianceScore: number;
    violationCount: number;
    isFullscreen: boolean;
    faceCount?: number;
    isCameraEnabled?: boolean;
    isFaceInFrame?: boolean;
    type?: 'video' | 'browser';
}

interface ViolationOverlayProps {
    message?: string;
    reason?: string;
    violationCount: number;
    complianceScore: number;
    onRequestFullscreen?: () => void;
    type?: 'video' | 'browser';
}

export function ProctorBadge({
    complianceScore,
    violationCount,
    isFullscreen,
}: ProctorBadgeProps) {
    const [expanded, setExpanded] = useState(false);

    // Determine badge color based on compliance
    const getScoreColor = () => {
        if (complianceScore >= 80) return 'text-emerald-400';
        if (complianceScore >= 50) return 'text-amber-400';
        return 'text-red-400';
    };

    const getBorderColor = () => {
        if (complianceScore >= 80) return 'border-emerald-500/30';
        if (complianceScore >= 50) return 'border-amber-500/30';
        return 'border-red-500/30';
    };

    const getBgColor = () => {
        if (complianceScore >= 80) return 'bg-emerald-950/80';
        if (complianceScore >= 50) return 'bg-amber-950/80';
        return 'bg-red-950/80';
    };

    const ShieldIcon =
        complianceScore >= 80
            ? ShieldCheck
            : complianceScore >= 50
                ? Shield
                : ShieldAlert;

    return (
        <div
            className={`fixed top-4 right-4 z-[10000] transition-all duration-300`}
        >
            {/* Collapsed Badge */}
            <button
                onClick={() => setExpanded(!expanded)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border backdrop-blur-md shadow-lg transition-all hover:scale-105 ${getBgColor()} ${getBorderColor()}`}
            >
                <ShieldIcon size={16} className={getScoreColor()} />
                <span className={`text-xs font-bold ${getScoreColor()}`}>
                    {Math.round(complianceScore)}%
                </span>
                <div
                    className={`w-2 h-2 rounded-full ${complianceScore >= 80
                        ? 'bg-emerald-400 animate-pulse'
                        : complianceScore >= 50
                            ? 'bg-amber-400 animate-pulse'
                            : 'bg-red-400 animate-pulse'
                        }`}
                />
                {expanded ? (
                    <ChevronUp size={12} className="text-stone-500" />
                ) : (
                    <ChevronDown size={12} className="text-stone-500" />
                )}
            </button>

            {/* Expanded Details */}
            {expanded && (
                <div
                    className={`mt-2 rounded-xl border p-4 backdrop-blur-md shadow-xl ${getBgColor()} ${getBorderColor()}`}
                    style={{ minWidth: 220 }}
                >
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-xs text-stone-400">
                            <ShieldIcon size={14} className={getScoreColor()} />
                            <span className="font-semibold text-stone-300">
                                Proctor Active
                            </span>
                        </div>

                        {/* Compliance Bar */}
                        <div>
                            <div className="flex justify-between text-xs mb-1">
                                <span className="text-stone-500">Compliance</span>
                                <span className={`font-bold ${getScoreColor()}`}>
                                    {Math.round(complianceScore)}%
                                </span>
                            </div>
                            <div className="w-full h-1.5 bg-stone-800 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all duration-500 ${complianceScore >= 80
                                        ? 'bg-emerald-500'
                                        : complianceScore >= 50
                                            ? 'bg-amber-500'
                                            : 'bg-red-500'
                                        }`}
                                    style={{ width: `${Math.max(0, complianceScore)}%` }}
                                />
                            </div>
                        </div>

                        {/* Stats Grid */}
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="bg-stone-800/50 rounded-lg p-2 text-center">
                                <div className="text-red-400 font-bold">{violationCount}</div>
                                <div className="text-stone-600">Violations</div>
                            </div>
                            <div className="bg-stone-800/50 rounded-lg p-2 text-center">
                                <div
                                    className={`font-bold ${isFullscreen ? 'text-emerald-400' : 'text-red-400'
                                        }`}
                                >
                                    {isFullscreen ? 'ON' : 'OFF'}
                                </div>
                                <div className="text-stone-600">Fullscreen</div>
                            </div>
                        </div>

                        {/* Rules */}
                        <div className="text-[10px] text-stone-600 space-y-0.5">
                            <p>• Tab switching is monitored</p>
                            <p>• Copy/Paste is disabled</p>
                            <p>• Fullscreen is required</p>
                            <p>• All events are logged</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
