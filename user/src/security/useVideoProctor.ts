'use client';

// ============================================
// useVideoProctor.ts — Video Interview Proctoring Hook
// Real-time face detection using MediaPipe
// Monitors camera frame, multiple faces, absence
// ============================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { FaceDetection, Results } from '@mediapipe/face_detection';

export type VideoViolationType =
    | 'face_not_visible'
    | 'multiple_faces_detected'
    | 'face_out_of_frame'
    | 'camera_stream_stopped'
    | 'microphone_stream_stopped'
    | 'prolonged_absence'
    | 'camera_disabled';

export interface VideoViolationEvent {
    type: VideoViolationType;
    timestamp: number;
    details?: string;
}

export interface VideoProctorState {
    isActive: boolean;
    isCameraEnabled: boolean;
    isMicrophoneEnabled: boolean;
    faceCount: number;
    isFaceInFrame: boolean;
    absenceStartTime: number | null;
    violationCount: number;
    complianceScore: number;
    violations: VideoViolationEvent[];
    showWarning: boolean;
    warningMessage: string;
    isTerminated: boolean;
    terminatedAt?: string;
    terminatedReason?: string;
}

interface UseVideoProctorOptions {
    sessionId: string | null;
    enabled: boolean;
    strictMode: boolean;
    onViolation?: (violation: VideoViolationEvent) => void;
    onTerminated?: (reason: string) => void;
    videoRef: React.RefObject<HTMLVideoElement>;
}

export function useVideoProctor(options: UseVideoProctorOptions & { mediaStream: MediaStream | null }): VideoProctorState {
    const { sessionId, enabled, strictMode, onViolation, onTerminated, videoRef, mediaStream } = options;

    const [state, setState] = useState<VideoProctorState>({
        isActive: false,
        isCameraEnabled: false,
        isMicrophoneEnabled: false,
        faceCount: 0,
        isFaceInFrame: true,
        absenceStartTime: null,
        violationCount: 0,
        complianceScore: 100,
        violations: [],
        showWarning: false,
        warningMessage: '',
        isTerminated: false,
    });

    const faceDetectionRef = useRef<FaceDetection | null>(null);
    const absenceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lastViolationTimeRef = useRef<number>(0);
    const requestRef = useRef<number>();
    const isProcessingRef = useRef(false);

    // ---- Violation handler ----
    const handleViolation = useCallback(
        async (type: VideoViolationType, details?: string) => {
            if (!enabled || !sessionId) return;

            const now = Date.now();

            // Prevent violation spam (min 2 seconds between same type)
            if (now - lastViolationTimeRef.current < 2000 && type === state.violations[state.violations.length - 1]?.type) {
                return;
            }
            lastViolationTimeRef.current = now;

            const violation: VideoViolationEvent = {
                type,
                timestamp: now,
                details,
            };

            const penalties: Record<VideoViolationType, number> = {
                face_not_visible: 15,
                multiple_faces_detected: 20,
                face_out_of_frame: 12,
                camera_stream_stopped: 25,
                microphone_stream_stopped: 10,
                prolonged_absence: 30,
                camera_disabled: 25,
            };

            const warningMessages: Record<VideoViolationType, string> = {
                face_not_visible: '🚫 No face detected! Please position yourself in camera view.',
                multiple_faces_detected: '🚫 Multiple faces detected! Only one person allowed.',
                face_out_of_frame: '⚠️ Face out of frame! Please center yourself.',
                camera_stream_stopped: '🔴 Camera stopped! Please restart camera.',
                microphone_stream_stopped: '⚠️ Microphone issue detected!',
                prolonged_absence: '🔴 Interview terminated due to prolonged absence.',
                camera_disabled: '🔴 Camera disabled! Please enable camera.',
            };

            setState(prev => ({
                ...prev,
                violationCount: prev.violationCount + 1,
                violations: [...prev.violations, violation],
                showWarning: true,
                warningMessage: warningMessages[type],
            }));

            // Auto-hide warning after 4 seconds
            setTimeout(() => {
                setState(prev => ({ ...prev, showWarning: false }));
            }, 4000);

            // Report to server
            try {
                await fetch('/api/proctor', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, type, details }),
                });
            } catch (error) {
                console.warn('[VideoProctor] Failed to report violation:', error);
            }

            onViolation?.(violation);
        },
        [enabled, sessionId, onViolation, state.violations]
    );

    // ---- Face detection setup ----
    const onResults = useCallback(
        (results: Results) => {
            if (!enabled || !videoRef.current) return;

            const canvasElement = document.getElementById('video-canvas') as HTMLCanvasElement;
            if (!canvasElement) return;

            const canvasCtx = canvasElement.getContext('2d');
            if (!canvasCtx) return;

            canvasCtx.save();
            canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

            // Draw detections
            if (results.detections && results.detections.length > 0) {
                for (const detection of results.detections) {
                    const bbox = detection.boundingBox;
                    if (bbox) {
                        canvasCtx.strokeStyle = '#00FF00';
                        canvasCtx.lineWidth = 3;
                        canvasCtx.strokeRect(
                            bbox.xCenter * canvasElement.width - (bbox.width * canvasElement.width) / 2,
                            bbox.yCenter * canvasElement.height - (bbox.height * canvasElement.height) / 2,
                            bbox.width * canvasElement.width,
                            bbox.height * canvasElement.height
                        );
                    }
                }
            }
            canvasCtx.restore();

            // Process results
            const faceCount = results.detections?.length || 0;
            const isFaceInFrame = faceCount > 0;

            setState(prev => ({
                ...prev,
                faceCount,
                isFaceInFrame,
            }));

            // Handle violations
            if (!isFaceInFrame) {
                if (!state.absenceStartTime) {
                    const startTime = Date.now();
                    setState(prev => ({ ...prev, absenceStartTime: startTime }));

                    absenceTimerRef.current = setTimeout(() => {
                        handleViolation('prolonged_absence', `Absent for 6+ seconds`);
                        if (onTerminated) {
                            onTerminated('Interview terminated due to prolonged absence from camera');
                        }
                    }, 6000);
                }
            } else {
                if (absenceTimerRef.current) {
                    clearTimeout(absenceTimerRef.current);
                    absenceTimerRef.current = null;
                    setState(prev => ({ ...prev, absenceStartTime: null }));
                }
            }

            if (faceCount > 1) {
                handleViolation('multiple_faces_detected', `${faceCount} faces detected`);
                if (onTerminated) {
                    onTerminated('Interview terminated due to multiple faces detected.');
                }
            }
        },
        [enabled, videoRef, state.absenceStartTime, handleViolation, onTerminated]
    );

    // ---- Processing Loop ----
    const processVideo = useCallback(async () => {
        if (!enabled || !videoRef.current || !faceDetectionRef.current || isProcessingRef.current) {
            requestRef.current = requestAnimationFrame(processVideo);
            return;
        }

        try {
            if (videoRef.current.readyState >= 2) {
                isProcessingRef.current = true;
                await faceDetectionRef.current.send({ image: videoRef.current });
                isProcessingRef.current = false;
            }
        } catch (error) {
            console.warn('Face detection frame error:', error);
            isProcessingRef.current = false;
        }

        requestRef.current = requestAnimationFrame(processVideo);
    }, [enabled, videoRef]);

    // ---- Initialize MediaPipe & Stream ----
    useEffect(() => {
        if (!enabled || !videoRef.current || typeof window === 'undefined') return;

        let active = true;

        const initialize = async () => {
            try {
                // Attach shared stream if provided
                if (mediaStream && videoRef.current) {
                    videoRef.current.srcObject = mediaStream;
                    videoRef.current.play().catch(() => {/* ignore play errors */ });
                    setState(prev => ({ ...prev, isCameraEnabled: true, isActive: true }));
                }

                // Initialize Face Detection
                faceDetectionRef.current = new FaceDetection({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`,
                });

                faceDetectionRef.current.setOptions({
                    model: 'short',
                    minDetectionConfidence: 0.5,
                });

                faceDetectionRef.current.onResults(onResults);

                // Start loop
                requestRef.current = requestAnimationFrame(processVideo);

            } catch (error) {
                console.error('[VideoProctor] Failed to initialize:', error);
                if (active) {
                    handleViolation('camera_disabled', error instanceof Error ? error.message : 'Init failed');
                }
            }
        };

        initialize();

        return () => {
            active = false;
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
            if (faceDetectionRef.current) {
                try {
                    faceDetectionRef.current.close();
                } catch { /* ignore close errors */ }
                faceDetectionRef.current = null;
            }
            if (absenceTimerRef.current) {
                clearTimeout(absenceTimerRef.current);
            }
            // Do NOT stop tracks here if using shared mediaStream
            // Just clear the srcObject locally to detach
            if (videoRef.current) {
                videoRef.current.srcObject = null;
            }
        };
    }, [enabled, videoRef, mediaStream, onResults, processVideo, handleViolation]);

    return state;
}
