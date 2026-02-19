'use client';

// ============================================
// ViolationOverlay.tsx — Blocking Overlay
// Appears when the user violates proctoring rules
// Blurs interview content and forces return
// ============================================

import React from 'react';
import { ShieldAlert, Maximize, ArrowLeft } from 'lucide-react';

interface ViolationOverlayProps {
    message: string;
    reason?: string;
    violationCount: number;
    complianceScore: number;
    onRequestFullscreen?: () => void;
    type?: 'video' | 'browser';
}

export function ViolationOverlay({
    message,
    reason,
    violationCount,
    complianceScore,
    onRequestFullscreen,
    type,
}: ViolationOverlayProps) {
    const isCritical = complianceScore < 40;
    const displayMessage = message || reason || 'Security violation detected';

    return (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="max-w-lg w-full mx-4">
                <div
                    className={`rounded-2xl border p-8 text-center space-y-6 ${isCritical
                        ? 'bg-red-950/90 border-red-500/50'
                        : 'bg-stone-900/95 border-amber-500/40'
                        }`}
                    style={{
                        animation: 'pulseRing 2s infinite',
                    }}
                >
                    {/* Icon */}
                    <div
                        className={`w-20 h-20 rounded-full mx-auto flex items-center justify-center ${isCritical
                            ? 'bg-red-900/50 border-2 border-red-500'
                            : 'bg-amber-900/50 border-2 border-amber-500'
                            }`}
                    >
                        <ShieldAlert
                            size={40}
                            className={isCritical ? 'text-red-400' : 'text-amber-400'}
                        />
                    </div>

                    {/* Title */}
                    <div>
                        <h2
                            className={`text-2xl font-bold mb-2 ${isCritical ? 'text-red-300' : 'text-amber-300'
                                }`}
                        >
                            {isCritical ? 'Critical Violation' : 'Proctoring Alert'}
                        </h2>
                        <p className="text-stone-300 text-sm">{reason}</p>
                    </div>

                    {/* Stats */}
                    <div className="flex justify-center gap-6 text-sm">
                        <div className="text-center">
                            <div
                                className={`text-2xl font-bold ${complianceScore >= 70
                                    ? 'text-emerald-400'
                                    : complianceScore >= 40
                                        ? 'text-amber-400'
                                        : 'text-red-400'
                                    }`}
                            >
                                {Math.round(complianceScore)}%
                            </div>
                            <div className="text-stone-500 text-xs">Compliance</div>
                        </div>
                        <div className="text-center">
                            <div className="text-2xl font-bold text-red-400">
                                {violationCount}
                            </div>
                            <div className="text-stone-500 text-xs">Violations</div>
                        </div>
                    </div>

                    {/* Warning Text */}
                    {isCritical && (
                        <div className="bg-red-900/40 border border-red-700/30 rounded-lg p-3">
                            <p className="text-red-300 text-xs">
                                ⚠️ Your session has been flagged due to multiple violations.
                                This will be visible to the administrator.
                            </p>
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                        <button
                            onClick={onRequestFullscreen}
                            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl transition-colors"
                        >
                            <Maximize size={18} />
                            Enter Fullscreen
                        </button>
                        <button
                            onClick={() => window.focus()}
                            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-stone-700 hover:bg-stone-600 text-white font-medium rounded-xl transition-colors"
                        >
                            <ArrowLeft size={18} />
                            Return to Interview
                        </button>
                    </div>

                    {/* Footer */}
                    <p className="text-stone-600 text-xs">
                        🛡️ Proctoring is active. All violations are recorded.
                    </p>
                </div>
            </div>
        </div>
    );
}
