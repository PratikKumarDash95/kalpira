'use client';

// ============================================
// VideoProctorGuard.tsx — Video Interview Proctoring Wrapper
// Combines browser security with face detection
// Shows video feed with real-time monitoring
// ============================================

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useVideoProctor, VideoViolationEvent } from './useVideoProctor';
import { ViolationOverlay } from './ViolationOverlay';
import { ProctorBadge } from './ProctorBadge';
import { useProctor } from './useProctor';

interface VideoProctorGuardProps {
    sessionId: string | null;
    strictMode?: boolean;
    children: React.ReactNode;
}

export function VideoProctorGuard({
    sessionId,
    strictMode = true,
    children,
    onFullscreenExit,
    mediaStream,
}: VideoProctorGuardProps & { onFullscreenExit?: () => void; mediaStream?: MediaStream | null }) {
    const [mounted, setMounted] = useState(false);
    const router = useRouter();
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Video proctoring for face detection
    const handleTermination = (reason: string) => {
        console.log('[VideoProctorGuard] Session terminated:', reason);
        if (sessionId) {
            // Mark session as complete/terminated in DB
            fetch(`/api/sessions/${sessionId}/complete`, { method: 'POST', keepalive: true }).catch(() => { });
        }
        router.push(`/interview/terminated?reason=${encodeURIComponent(reason)}`);
    };

    // Video proctoring for face detection
    const videoProctor = useVideoProctor({
        sessionId,
        enabled: mounted && !!sessionId,
        strictMode,
        videoRef,
        mediaStream: mediaStream || null, // Pass shared stream
        onTerminated: handleTermination,
        onViolation: (violation: VideoViolationEvent) => {
            console.log('[VideoProctorGuard] Video violation:', violation);
        },
    });

    // Browser proctoring for tab switching, etc.
    const browserProctor = useProctor({
        sessionId,
        enabled: mounted && !!sessionId,
        strictMode,
        onTerminated: handleTermination,
        onViolation: (violation) => {
            console.log('[VideoProctorGuard] Browser violation:', violation);
        },
    });

    useEffect(() => {
        setMounted(true);
    }, []);

    // Track if we have ever been in fullscreen
    const hasEnteredFullscreen = useRef(false);

    useEffect(() => {
        if (browserProctor.isFullscreen) {
            hasEnteredFullscreen.current = true;
        } else if (hasEnteredFullscreen.current && strictMode && onFullscreenExit) {
            // Check if we just exited fullscreen after having been in it
            onFullscreenExit();
        }
    }, [browserProctor.isFullscreen, strictMode, onFullscreenExit]);

    // Strict Mode: Force Fullscreen before starting
    if (mounted && strictMode && !browserProctor.isFullscreen && !browserProctor.isTerminated) {
        return (
            <div className="fixed inset-0 z-50 bg-slate-950 flex items-center justify-center p-6">
                <div className="max-w-md w-full bg-slate-900 border border-slate-700 rounded-2xl p-8 text-center shadow-2xl">
                    <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                        <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                        </svg>
                    </div>
                    <h2 className="text-2xl font-bold text-white mb-3">Secure Interview Environment</h2>
                    <p className="text-slate-400 mb-8">
                        This interview requires a structured environment. To proceed, please enter fullscreen mode.
                    </p>

                    <button
                        onClick={() => browserProctor.triggerFullscreen()}
                        className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-all shadow-lg shadow-blue-500/20 active:scale-[0.98]"
                    >
                        Enter Fullscreen to Start
                    </button>

                    <p className="mt-4 text-xs text-slate-500">
                        Monitoring will begin immediately after entering fullscreen.
                    </p>
                </div>
            </div>
        );
    }

    // If session is terminated, show locked screen
    if (videoProctor.isTerminated || browserProctor.isTerminated) {
        return (
            <div className="min-h-screen bg-red-900 flex items-center justify-center p-8">
                <div className="max-w-md text-center space-y-6">
                    <div className="w-16 h-16 rounded-full bg-red-800 border border-red-600 flex items-center justify-center mx-auto">
                        <svg className="w-8 h-8 text-red-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                    </div>
                    <div>
                        <h1 className="text-xl font-semibold text-white mb-2">Interview Terminated</h1>
                        <p className="text-red-200 text-sm mb-4">
                            {videoProctor.terminatedReason || browserProctor.terminatedReason || 'Interview session has been terminated due to policy violations.'}
                        </p>
                        <div className="text-red-300 text-xs space-y-1">
                            <p>Video Violations: {videoProctor.violationCount}</p>
                            <p>Browser Violations: {browserProctor.violationCount}</p>
                            <p>Compliance Score: {Math.max(videoProctor.complianceScore, browserProctor.complianceScore).toFixed(1)}%</p>
                        </div>
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

    return (
        <div className="video-proctor-guard relative min-h-screen bg-stone-900">
            {/* Video Monitoring Section */}
            <div className="absolute top-4 right-4 z-50 space-y-4">
                <ProctorBadge
                    complianceScore={Math.max(videoProctor.complianceScore, browserProctor.complianceScore)}
                    violationCount={videoProctor.violationCount + browserProctor.violationCount}
                    faceCount={videoProctor.faceCount}
                    isCameraEnabled={videoProctor.isCameraEnabled}
                    isFaceInFrame={videoProctor.isFaceInFrame}
                    isFullscreen={browserProctor.isFullscreen}
                />
            </div>

            {/* Violation Overlay */}
            {(videoProctor.showWarning || browserProctor.showWarning) && (
                <ViolationOverlay
                    message={videoProctor.showWarning ? videoProctor.warningMessage : browserProctor.warningMessage}
                    violationCount={videoProctor.violationCount + browserProctor.violationCount}
                    complianceScore={Math.max(videoProctor.complianceScore, browserProctor.complianceScore)}
                    type={videoProctor.showWarning ? 'video' : 'browser'}
                />
            )}

            {/* Video Feed with Canvas Overlay */}
            <div className="relative w-full h-full">
                {/* Hidden canvas for face detection drawing */}
                <canvas
                    ref={canvasRef}
                    id="video-canvas"
                    className="absolute top-0 left-0 w-full h-full pointer-events-none z-10"
                    width="640"
                    height="480"
                />

                {/* Interview Content */}
                <div className="relative z-20">
                    {children}
                </div>

                {/* Hidden video element for face detection */}
                <video
                    ref={videoRef}
                    className="hidden"
                    playsInline
                    muted
                />
            </div>

            {/* Camera Status Indicator */}
            <div className="absolute bottom-4 left-4 z-50">
                <div className={`flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium ${videoProctor.isCameraEnabled
                    ? 'bg-green-900/80 text-green-200 border border-green-600'
                    : 'bg-red-900/80 text-red-200 border border-red-600'
                    }`}>
                    <div className={`w-2 h-2 rounded-full ${videoProctor.isCameraEnabled ? 'bg-green-400' : 'bg-red-400'
                        }`} />
                    {videoProctor.isCameraEnabled ? 'Camera Active' : 'Camera Off'}
                </div>
            </div>
        </div>
    );
}
