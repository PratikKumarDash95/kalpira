'use client';

// ============================================
// ProctorGuard.tsx — Strict Interview Proctoring Wrapper
// Wraps interview content with anti-cheat monitoring
// Shows violation overlays and proctor badge
// ============================================

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useProctor } from './useProctor';
import { ViolationOverlay } from './ViolationOverlay';
import { ProctorBadge } from './ProctorBadge';

interface ProctorGuardProps {
    sessionId: string | null;
    strictMode?: boolean;
    children: React.ReactNode;
}

export function ProctorGuard({
    sessionId,
    strictMode = true,
    children,
}: ProctorGuardProps) {
    const [mounted, setMounted] = useState(false);
    const router = useRouter();

    const proctor = useProctor({
        sessionId,
        enabled: mounted && !!sessionId,
        strictMode,
        onTerminated: (reason: string) => {
            console.log('[ProctorGuard] Session terminated:', reason);
            // Redirect to a termination page or show locked UI
            router.push(`/interview/terminated?reason=${encodeURIComponent(reason)}`);
        },
    });

    useEffect(() => {
        setMounted(true);
    }, []);

    // If session is terminated, show locked screen
    if (proctor.isTerminated) {
        return (
            <div className="min-h-screen bg-red-900 flex items-center justify-center p-8">
                <div className="max-w-md text-center space-y-6">
                    <div className="w-16 h-16 rounded-full bg-red-800 border border-red-600 flex items-center justify-center mx-auto">
                        <svg className="w-8 h-8 text-red-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                    </div>
                    <div>
                        <h1 className="text-xl font-semibold text-white mb-2">Session Terminated</h1>
                        <p className="text-red-200 text-sm mb-4">
                            {proctor.terminatedReason || 'Interview session has been terminated due to policy violations.'}
                        </p>
                        <p className="text-red-300 text-xs">
                            Violations: {proctor.violationCount} | Compliance Score: {proctor.complianceScore.toFixed(1)}%
                        </p>
                    </div>
                    <button
                        onClick={() => router.push('/dashboard')}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-red-700 hover:bg-red-600 text-white font-medium rounded-xl transition-colors"
                    >
                        Return to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    // Determine if we should block the screen
    const shouldBlock =
        proctor.isActive &&
        strictMode &&
        (!proctor.isFocused || (!proctor.isFullscreen && mounted));

    return (
        <div
            className="proctor-guard relative w-full h-full"
            style={{ userSelect: 'none' }}
            onDragStart={(e) => e.preventDefault()}
        >
            {/* Proctor Active Badge */}
            {proctor.isActive && (
                <ProctorBadge
                    complianceScore={proctor.complianceScore}
                    violationCount={proctor.violationCount}
                    isFullscreen={proctor.isFullscreen}
                />
            )}

            {/* Warning Toast */}
            {proctor.showWarning && (
                <div
                    className="fixed top-4 left-1/2 -translate-x-1/2 z-[10002] animate-slideDown"
                    style={{
                        animation: 'slideDown 0.3s ease-out',
                    }}
                >
                    <div className="bg-red-900/95 border border-red-500/50 text-red-100 px-6 py-3 rounded-xl shadow-2xl backdrop-blur-sm flex items-center gap-3 max-w-md">
                        <span className="text-lg">🛡️</span>
                        <span className="text-sm font-medium">{proctor.warningMessage}</span>
                    </div>
                </div>
            )}

            {/* Violation Overlay (blocks content when not compliant) */}
            {shouldBlock && (
                <ViolationOverlay
                    message={
                        !proctor.isFocused
                            ? 'Please return to the interview window.'
                            : 'Please re-enter fullscreen mode to continue.'
                    }
                    violationCount={proctor.violationCount}
                    complianceScore={proctor.complianceScore}
                    onRequestFullscreen={async () => {
                        try {
                            await document.documentElement.requestFullscreen();
                        } catch {
                            // denied
                        }
                    }}
                />
            )}

            {/* Interview Content */}
            <div
                className={`transition-all duration-300 ${shouldBlock ? 'blur-xl pointer-events-none select-none' : ''
                    }`}
            >
                {children}
            </div>

            {/* Inline keyframe styles */}
            <style jsx global>{`
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }

        @keyframes pulseRing {
          0% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4);
          }
          70% {
            box-shadow: 0 0 0 10px rgba(239, 68, 68, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
          }
        }

        .proctor-guard * {
          -webkit-user-drag: none !important;
        }
      `}</style>
        </div>
    );
}
