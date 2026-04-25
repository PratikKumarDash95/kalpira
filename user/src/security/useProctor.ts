'use client';

// ============================================
// useProctor.ts — Browser Proctoring Hook
// Monitors tab switches, focus loss, fullscreen exit,
// copy/paste/right-click, and DevTools detection
// ============================================

import { useEffect, useRef, useCallback, useState } from 'react';

export type ViolationType =
    | 'tab_switch'
    | 'focus_lost'
    | 'fullscreen_exit'
    | 'copy_attempt'
    | 'paste_attempt'
    | 'right_click'
    | 'devtools_open'
    | 'resize_suspicious'
    | 'prolonged_absence_browser';

export interface ViolationEvent {
    type: ViolationType;
    timestamp: number;
    details?: string;
}

export interface ProctorState {
    isActive: boolean;
    isFullscreen: boolean;
    isFocused: boolean;
    violationCount: number;
    complianceScore: number;
    violations: ViolationEvent[];
    showWarning: boolean;
    warningMessage: string;
    isTerminated: boolean;
    terminatedAt?: string;
    terminatedReason?: string;
    triggerFullscreen: () => Promise<void>;
    absenceStartTime: number | null;
}

interface UseProctorOptions {
    sessionId: string | null;
    enabled: boolean;
    strictMode: boolean;
    onViolation?: (violation: ViolationEvent) => void;
    onTerminated?: (reason: string) => void;
}

/**
 * Reports a violation to the server API.
 */
async function reportViolationToServer(
    sessionId: string,
    type: ViolationType,
    details?: string
): Promise<void> {
    try {
        await fetch('/api/proctor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, type, details }),
        });
    } catch {
        console.warn('[Proctor] Failed to report violation to server');
    }
}

export function useProctor(options: UseProctorOptions): ProctorState {
    const { sessionId, enabled, strictMode, onViolation, onTerminated } = options;

    const [state, setState] = useState<ProctorState>({
        isActive: false,
        isFullscreen: false,
        isFocused: true,
        violationCount: 0,
        complianceScore: 100,
        violations: [],
        showWarning: false,
        warningMessage: '',
        isTerminated: false,
        triggerFullscreen: async () => { }, // Initial dummy function
        absenceStartTime: null,
    });

    const warningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const absenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastWidthRef = useRef(window.innerWidth);
    const lastHeightRef = useRef(window.innerHeight);

    // ---- Server state rehydration ----
    const rehydrateFromServer = useCallback(async () => {
        if (!sessionId) return;

        try {
            const response = await fetch(`/api/proctor?sessionId=${sessionId}`);
            if (response.ok) {
                const serverStatus = await response.json();

                setState(prev => ({
                    ...prev,
                    complianceScore: serverStatus.complianceScore,
                    violationCount: serverStatus.violationCount,
                    violations: serverStatus.violations,
                    isTerminated: serverStatus.status === 'TERMINATED',
                    terminatedAt: serverStatus.terminatedAt,
                    terminatedReason: serverStatus.terminatedReason,
                }));

                // If terminated, call callback
                if (serverStatus.status === 'TERMINATED' && onTerminated) {
                    onTerminated(serverStatus.terminatedReason || 'Session terminated');
                }
            }
        } catch (error) {
            console.warn('[Proctor] Failed to rehydrate state from server:', error);
        }
    }, [sessionId, onTerminated]);

    // Rehydrate on mount and sessionId change
    useEffect(() => {
        if (enabled && sessionId) {
            rehydrateFromServer();
        }
    }, [enabled, sessionId, rehydrateFromServer]);

    // ---- Violation handler ----
    const handleViolation = useCallback(
        async (type: ViolationType, details?: string) => {
            if (!enabled || !sessionId) return;

            const violation: ViolationEvent = {
                type,
                timestamp: Date.now(),
                details,
            };

            // Penalty per type
            const penalties: Record<ViolationType, number> = {
                tab_switch: 8,
                focus_lost: 5,
                fullscreen_exit: 10,
                copy_attempt: 6,
                paste_attempt: 12,
                right_click: 3,
                devtools_open: 15,
                resize_suspicious: 4,
                prolonged_absence_browser: 30, // New violation type
            };

            const warningMessages: Record<ViolationType, string> = {
                tab_switch: '⚠️ Tab switch detected! Return immediately or interview will terminate in 10s.',
                focus_lost: '⚠️ Window focus lost! Return immediately or interview will terminate in 10s.',
                fullscreen_exit: '🔴 Fullscreen exited! Please re-enter fullscreen.',
                copy_attempt: '🚫 Copy is disabled during the interview.',
                paste_attempt: '🚫 Paste is disabled during the interview.',
                right_click: '🚫 Right-click is disabled.',
                devtools_open: '🔴 DevTools detected! Close them immediately.',
                resize_suspicious: '⚠️ Suspicious window resize detected.',
                prolonged_absence_browser: '🔴 Interview terminated due to prolonged tab switching/inactivity.',
            };

            // Report to server and get updated status
            try {
                const response = await fetch('/api/proctor', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, type, details }),
                });

                if (response.ok) {
                    const serverStatus = await response.json();

                    setState(prev => ({
                        ...prev,
                        violationCount: serverStatus.violationCount,
                        complianceScore: serverStatus.complianceScore,
                        violations: serverStatus.violations,
                        isTerminated: serverStatus.status === 'TERMINATED',
                        terminatedAt: serverStatus.terminatedAt,
                        terminatedReason: serverStatus.terminatedReason,
                        showWarning: true,
                        warningMessage: warningMessages[type],
                    }));

                    // If terminated, call callback
                    if (serverStatus.status === 'TERMINATED' && onTerminated) {
                        onTerminated(serverStatus.terminatedReason || 'Session terminated');
                    }
                } else {
                    // Fallback to local state if server fails
                    setState((prev) => {
                        const newScore = Math.max(0, prev.complianceScore - penalties[type]);
                        return {
                            ...prev,
                            violationCount: prev.violationCount + 1,
                            complianceScore: newScore,
                            violations: [...prev.violations, violation],
                            showWarning: true,
                            warningMessage: warningMessages[type],
                        };
                    });
                }
            } catch (error) {
                console.warn('[Proctor] Failed to report violation to server:', error);
                // Fallback to local state
                setState((prev) => {
                    const newScore = Math.max(0, prev.complianceScore - penalties[type]);
                    return {
                        ...prev,
                        violationCount: prev.violationCount + 1,
                        complianceScore: newScore,
                        violations: [...prev.violations, violation],
                        showWarning: true,
                        warningMessage: warningMessages[type],
                    };
                });
            }

            // Auto-hide warning after 4 seconds
            if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
            warningTimeoutRef.current = setTimeout(() => {
                setState((prev) => ({ ...prev, showWarning: false }));
            }, 4000);

            // Callback
            onViolation?.(violation);
        },
        [enabled, sessionId, onViolation, onTerminated]
    );

    // ---- Fullscreen helpers ----
    const requestFullscreen = useCallback(async () => {
        if (!strictMode) return;
        try {
            await document.documentElement.requestFullscreen();
            setState((prev) => ({ ...prev, isFullscreen: true }));
        } catch {
            console.warn('[Proctor] Fullscreen request denied');
        }
    }, [strictMode]);

    // Update state with the function
    useEffect(() => {
        setState(prev => ({ ...prev, triggerFullscreen: requestFullscreen }));
    }, [requestFullscreen]);

    // ---- Attach event listeners ----
    useEffect(() => {
        if (!enabled) return;

        setState((prev) => ({ ...prev, isActive: true }));

        setState((prev) => ({ ...prev, isFocused: true }));

        // 1. Visibility change (tab switch)
        const onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                handleViolation('tab_switch');
                setState((prev) => ({ ...prev, isFocused: false, absenceStartTime: Date.now() }));

                // Start strict 10s timer
                if (strictMode && !absenceTimeoutRef.current) {
                    absenceTimeoutRef.current = setTimeout(() => {
                        handleViolation('prolonged_absence_browser');
                        if (onTerminated) onTerminated('Interview terminated due to prolonged tab switching (10s+).');
                    }, 10000);
                }
            } else {
                setState((prev) => ({ ...prev, isFocused: true, absenceStartTime: null }));
                // Clear timer if back in time
                if (absenceTimeoutRef.current) {
                    clearTimeout(absenceTimeoutRef.current);
                    absenceTimeoutRef.current = null;
                }
            }
        };

        // 2. Window blur (focus loss)
        const onBlur = () => {
            handleViolation('focus_lost');
            setState((prev) => ({ ...prev, isFocused: false, absenceStartTime: Date.now() }));

            // Start strict 10s timer
            if (strictMode && !absenceTimeoutRef.current) {
                absenceTimeoutRef.current = setTimeout(() => {
                    handleViolation('prolonged_absence_browser');
                    if (onTerminated) onTerminated('Interview terminated due to prolonged window backgrounding (10s+).');
                }, 10000);
            }
        };

        const onFocus = () => {
            setState((prev) => ({ ...prev, isFocused: true, absenceStartTime: null }));
            if (absenceTimeoutRef.current) {
                clearTimeout(absenceTimeoutRef.current);
                absenceTimeoutRef.current = null;
            }
        };

        // 3. Fullscreen change
        const onFullscreenChange = () => {
            const isFs = !!document.fullscreenElement;
            setState((prev) => ({ ...prev, isFullscreen: isFs }));
            if (!isFs && strictMode) {
                handleViolation('fullscreen_exit');
            }
        };

        // 4. Copy/Cut/Paste
        const onCopy = (e: ClipboardEvent) => {
            e.preventDefault();
            handleViolation('copy_attempt');
        };
        const onCut = (e: ClipboardEvent) => {
            e.preventDefault();
            handleViolation('copy_attempt', 'cut');
        };
        const onPaste = (e: ClipboardEvent) => {
            e.preventDefault();
            handleViolation('paste_attempt');
        };

        // 5. Right-click
        const onContextMenu = (e: MouseEvent) => {
            e.preventDefault();
            handleViolation('right_click');
        };

        // 6. Resize detection (possible DevTools)
        const onResize = () => {
            const widthDiff = Math.abs(window.innerWidth - lastWidthRef.current);
            const heightDiff = Math.abs(window.innerHeight - lastHeightRef.current);

            // If resize is very large and not from fullscreen, flag it
            if ((widthDiff > 200 || heightDiff > 200) && !document.fullscreenElement) {
                handleViolation('resize_suspicious', `ΔW=${widthDiff} ΔH=${heightDiff}`);
            }

            lastWidthRef.current = window.innerWidth;
            lastHeightRef.current = window.innerHeight;
        };

        // 7. Keyboard shortcuts (F12, Ctrl+Shift+I, Ctrl+U)
        const onKeyDown = (e: KeyboardEvent) => {
            // F12
            if (e.key === 'F12') {
                e.preventDefault();
                handleViolation('devtools_open', 'F12 pressed');
            }
            // Ctrl+Shift+I (DevTools)
            if (e.ctrlKey && e.shiftKey && e.key === 'I') {
                e.preventDefault();
                handleViolation('devtools_open', 'Ctrl+Shift+I');
            }
            // Ctrl+U (View Source)
            if (e.ctrlKey && e.key === 'u') {
                e.preventDefault();
                handleViolation('devtools_open', 'Ctrl+U');
            }
            // Ctrl+Shift+J (Console)
            if (e.ctrlKey && e.shiftKey && e.key === 'J') {
                e.preventDefault();
                handleViolation('devtools_open', 'Ctrl+Shift+J');
            }
            // Ctrl+C (copy)
            if (e.ctrlKey && e.key === 'c') {
                e.preventDefault();
                handleViolation('copy_attempt', 'Ctrl+C');
            }
            // Ctrl+V (paste)
            if (e.ctrlKey && e.key === 'v') {
                e.preventDefault();
                handleViolation('paste_attempt', 'Ctrl+V');
            }
        };

        // Bind all
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('blur', onBlur);
        window.addEventListener('focus', onFocus);
        document.addEventListener('fullscreenchange', onFullscreenChange);
        document.addEventListener('copy', onCopy);
        document.addEventListener('cut', onCut);
        document.addEventListener('paste', onPaste);
        document.addEventListener('contextmenu', onContextMenu);
        window.addEventListener('resize', onResize);
        document.addEventListener('keydown', onKeyDown);


        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('blur', onBlur);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('fullscreenchange', onFullscreenChange);
            document.removeEventListener('copy', onCopy);
            document.removeEventListener('cut', onCut);
            document.removeEventListener('paste', onPaste);
            document.removeEventListener('contextmenu', onContextMenu);
            window.removeEventListener('resize', onResize);
            document.removeEventListener('keydown', onKeyDown);

            if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
            if (absenceTimeoutRef.current) clearTimeout(absenceTimeoutRef.current);
        };
    }, [enabled, strictMode, handleViolation, requestFullscreen]);

    return state;
}
