'use client';

// Video interview proctoring hook.
// Monitors camera health, face presence, multiple faces, and critical violations.

import { useEffect, useRef, useState, useCallback } from 'react';
import { FaceDetection, Results } from '@mediapipe/face_detection';

export type VideoViolationType =
    | 'face_not_visible'
    | 'multiple_faces_detected'
    | 'face_out_of_frame'
    | 'camera_stream_stopped'
    | 'microphone_stream_stopped'
    | 'prolonged_absence'
    | 'camera_disabled'
    | 'mobile_phone_detected';

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
    const { sessionId, enabled, onViolation, onTerminated, videoRef, mediaStream } = options;

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

    const stateRef = useRef(state);
    const faceDetectionRef = useRef<FaceDetection | null>(null);
    const absenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const objectDetectionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const objectModelRef = useRef<any>(null);
    const objectDetectionLoadingRef = useRef(false);
    const lastViolationTimeRef = useRef<number>(0);
    const requestRef = useRef<number>();
    const isProcessingRef = useRef(false);

    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    const terminateSession = useCallback((reason: string) => {
        const terminatedAt = new Date().toISOString();
        setState(prev => ({
            ...prev,
            isTerminated: true,
            terminatedAt,
            terminatedReason: reason,
            showWarning: true,
            warningMessage: reason,
        }));
        onTerminated?.(reason);
    }, [onTerminated]);

    const handleViolation = useCallback(async (type: VideoViolationType, details?: string) => {
        if (!enabled || !sessionId || stateRef.current.isTerminated) return;

        const now = Date.now();
        const lastViolation = stateRef.current.violations[stateRef.current.violations.length - 1];
        if (now - lastViolationTimeRef.current < 2000 && type === lastViolation?.type) return;
        lastViolationTimeRef.current = now;

        const violation: VideoViolationEvent = { type, timestamp: now, details };
        const penalties: Record<VideoViolationType, number> = {
            face_not_visible: 15,
            multiple_faces_detected: 20,
            face_out_of_frame: 12,
            camera_stream_stopped: 25,
            microphone_stream_stopped: 10,
            prolonged_absence: 30,
            camera_disabled: 25,
            mobile_phone_detected: 100,
        };
        const warningMessages: Record<VideoViolationType, string> = {
            face_not_visible: 'No face detected. Please position yourself in camera view.',
            multiple_faces_detected: 'Multiple faces detected. Interview terminated.',
            face_out_of_frame: 'Face out of frame. Please center yourself.',
            camera_stream_stopped: 'Camera stopped. Interview terminated.',
            microphone_stream_stopped: 'Microphone issue detected.',
            prolonged_absence: 'Interview terminated due to prolonged absence.',
            camera_disabled: 'Camera disabled. Interview terminated.',
            mobile_phone_detected: 'Mobile phone detected. Interview terminated and marked as cheating.',
        };
        const criticalReason =
            type === 'mobile_phone_detected'
                ? 'Interview terminated: mobile phone detected. Candidate marked with cheating tag.'
                : type === 'multiple_faces_detected'
                    ? 'Interview terminated: multiple faces detected.'
                    : type === 'prolonged_absence'
                        ? 'Interview terminated: prolonged absence from camera.'
                        : type === 'camera_stream_stopped' || type === 'camera_disabled'
                            ? 'Interview terminated: camera was disabled or stopped.'
                            : null;

        setState(prev => ({
            ...prev,
            violationCount: prev.violationCount + 1,
            violations: [...prev.violations, violation],
            complianceScore: Math.max(0, prev.complianceScore - penalties[type]),
            showWarning: true,
            warningMessage: warningMessages[type],
        }));

        if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
        warningTimerRef.current = setTimeout(() => {
            setState(prev => prev.isTerminated ? prev : { ...prev, showWarning: false });
        }, 4000);

        try {
            await fetch('/api/proctor', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId,
                    type,
                    details,
                    severity: criticalReason ? 'critical' : 'warning',
                    status: criticalReason ? 'TERMINATED' : 'ACTIVE',
                    tag: criticalReason ? 'cheating' : undefined,
                    terminatedReason: criticalReason,
                }),
            });
        } catch (error) {
            console.warn('[VideoProctor] Failed to report violation:', error);
        }

        onViolation?.(violation);
        if (criticalReason) terminateSession(criticalReason);
    }, [enabled, sessionId, onViolation, terminateSession]);

    const onResults = useCallback((results: Results) => {
        if (!enabled || !videoRef.current || stateRef.current.isTerminated) return;

        const canvasElement = document.getElementById('video-canvas') as HTMLCanvasElement;
        const canvasCtx = canvasElement?.getContext('2d');
        if (canvasElement && canvasCtx) {
            canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
            for (const detection of results.detections || []) {
                const bbox = detection.boundingBox;
                if (!bbox) continue;
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

        const faceCount = results.detections?.length || 0;
        const isFaceInFrame = faceCount > 0;
        setState(prev => ({ ...prev, faceCount, isFaceInFrame }));

        if (!isFaceInFrame) {
            if (!stateRef.current.absenceStartTime) {
                const startTime = Date.now();
                setState(prev => ({ ...prev, absenceStartTime: startTime }));
                absenceTimerRef.current = setTimeout(() => {
                    handleViolation('prolonged_absence', 'Absent for 6+ seconds');
                }, 6000);
            }
        } else if (absenceTimerRef.current) {
            clearTimeout(absenceTimerRef.current);
            absenceTimerRef.current = null;
            setState(prev => ({ ...prev, absenceStartTime: null }));
        }

        if (faceCount > 1) {
            handleViolation('multiple_faces_detected', `${faceCount} faces detected`);
        }
    }, [enabled, videoRef, handleViolation]);

    const processVideo = useCallback(async () => {
        if (!enabled || !videoRef.current || !faceDetectionRef.current || isProcessingRef.current || stateRef.current.isTerminated) {
            if (!stateRef.current.isTerminated) requestRef.current = requestAnimationFrame(processVideo);
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

    useEffect(() => {
        if (!enabled || !videoRef.current || typeof window === 'undefined') return;

        let cancelled = false;
        const loadScript = (src: string) => new Promise<void>((resolve, reject) => {
            const existing = document.querySelector(`script[src="${src}"]`);
            if (existing) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(script);
        });

        const startObjectDetection = async () => {
            if (objectDetectionLoadingRef.current || objectModelRef.current) return;
            objectDetectionLoadingRef.current = true;
            try {
                await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
                await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js');
                if (cancelled) return;
                const cocoSsd = (window as any).cocoSsd;
                if (!cocoSsd?.load) return;
                objectModelRef.current = await cocoSsd.load();
                if (cancelled) return;
                objectDetectionTimerRef.current = setInterval(async () => {
                    if (!videoRef.current || stateRef.current.isTerminated || videoRef.current.readyState < 2) return;
                    try {
                        const predictions = await objectModelRef.current.detect(videoRef.current);
                        const phone = predictions.find((prediction: { class: string; score: number }) =>
                            prediction.class === 'cell phone' && prediction.score >= 0.5
                        );
                        if (phone) {
                            handleViolation('mobile_phone_detected', `Detected with ${(phone.score * 100).toFixed(0)}% confidence`);
                        }
                    } catch (error) {
                        console.warn('[VideoProctor] Object detection frame error:', error);
                    }
                }, 1500);
            } catch (error) {
                console.warn('[VideoProctor] Object detection unavailable:', error);
            } finally {
                objectDetectionLoadingRef.current = false;
            }
        };

        startObjectDetection();

        return () => {
            cancelled = true;
            if (objectDetectionTimerRef.current) {
                clearInterval(objectDetectionTimerRef.current);
                objectDetectionTimerRef.current = null;
            }
        };
    }, [enabled, videoRef, handleViolation]);

    useEffect(() => {
        if (!enabled || !videoRef.current || typeof window === 'undefined') return;

        let active = true;
        const initialize = async () => {
            try {
                if (mediaStream && videoRef.current) {
                    videoRef.current.srcObject = mediaStream;
                    videoRef.current.play().catch(() => { });
                    setState(prev => ({
                        ...prev,
                        isCameraEnabled: mediaStream.getVideoTracks().some(track => track.enabled && track.readyState === 'live'),
                        isMicrophoneEnabled: mediaStream.getAudioTracks().some(track => track.enabled && track.readyState === 'live'),
                        isActive: true,
                    }));
                }

                faceDetectionRef.current = new FaceDetection({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`,
                });
                faceDetectionRef.current.setOptions({ model: 'short', minDetectionConfidence: 0.5 });
                faceDetectionRef.current.onResults(onResults);
                requestRef.current = requestAnimationFrame(processVideo);
            } catch (error) {
                console.error('[VideoProctor] Failed to initialize:', error);
                if (active) handleViolation('camera_disabled', error instanceof Error ? error.message : 'Init failed');
            }
        };

        initialize();

        return () => {
            active = false;
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
            if (absenceTimerRef.current) clearTimeout(absenceTimerRef.current);
            if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
            if (objectDetectionTimerRef.current) clearInterval(objectDetectionTimerRef.current);
            if (faceDetectionRef.current) {
                try {
                    faceDetectionRef.current.close();
                } catch { }
                faceDetectionRef.current = null;
            }
            if (videoRef.current) videoRef.current.srcObject = null;
        };
    }, [enabled, videoRef, mediaStream, onResults, processVideo, handleViolation]);

    return state;
}
