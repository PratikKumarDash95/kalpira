'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store';
import { generateInterviewResponse, getInterviewGreeting } from '@/services/geminiService';
import { InterviewMessage, InterviewPhase } from '@/types';
import ReactMarkdown from 'react-markdown';
import {
    Mic, MicOff, Video, VideoOff, Phone, Send, Bot, User,
    Loader2, CheckCircle, MessageSquare, Volume2, VolumeX,
    Activity, Clock, ChevronRight
} from 'lucide-react';
import { VideoProctorGuard } from '../security';

// ─── Phase Labels ──────────────────────────────────────────────────────────────
const phaseLabels: Record<InterviewPhase, string> = {
    'background': 'Getting to know you',
    'core-questions': 'Core Questions',
    'exploration': 'Deep Dive',
    'feedback': 'Your Feedback',
    'wrap-up': 'Wrapping Up',
};

// ─── Score Extraction Helper ───────────────────────────────────────────────────
function extractScoresFromAIResponse(aiText: string, userAnswer: string) {
    // Heuristic scoring based on answer length and keywords
    const wordCount = userAnswer.split(' ').length;
    const hasExamples = /example|instance|specifically|for instance|such as/i.test(userAnswer);
    const hasStructure = /first|second|then|finally|additionally|moreover/i.test(userAnswer);
    const hasTechnical = /algorithm|system|architecture|database|api|framework|code|implement/i.test(userAnswer);
    const isConfident = !/i don't know|not sure|maybe|i think|possibly/i.test(userAnswer);

    const base = Math.min(60 + wordCount * 0.3, 85);
    return {
        technicalScore: Math.min(hasTechnical ? base + 10 : base - 5, 100),
        communicationScore: Math.min(hasStructure ? base + 8 : base, 100),
        confidenceScore: Math.min(isConfident ? base + 12 : base - 10, 100),
        logicScore: Math.min(hasExamples ? base + 8 : base - 3, 100),
        depthScore: Math.min(wordCount > 50 ? base + 10 : base - 5, 100),
    };
}

// ─── Main Component ────────────────────────────────────────────────────────────
const VideoInterview: React.FC = () => {
    const router = useRouter();
    const {
        studyConfig, participantProfile, questionProgress, interviewHistory,
        addMessage, setStep, isAiThinking, setAiThinking, contextEntries,
        appendContext, setInterviewPhase, markQuestionAsked, completeInterview,
        updateProfileField, setProfileRawContext, participantToken,
    } = useStore();

    // ── UI State ─────────────────────────────────────────────────────────────────
    const [input, setInput] = useState('');
    const [initialized, setInitialized] = useState(false);
    const [activeStream, setActiveStream] = useState<MediaStream | null>(null);
    const [showFinishOption, setShowFinishOption] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isCameraOff, setIsCameraOff] = useState(false);
    const [isTTSEnabled, setIsTTSEnabled] = useState(true);
    const [isListening, setIsListening] = useState(false);
    const [interimText, setInterimText] = useState('');
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [sessionGuest, setSessionGuest] = useState(false);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [aiSpeaking, setAiSpeaking] = useState(false);
    const [lastAiQuestion, setLastAiQuestion] = useState('');
    const [showChat, setShowChat] = useState(true);

    // ── Refs ──────────────────────────────────────────────────────────────────────
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const recognitionRef = useRef<any>(null);
    const synthRef = useRef<SpeechSynthesis | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const startTimeRef = useRef<Date>(new Date());

    // ── Scroll chat to bottom ─────────────────────────────────────────────────────
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [interviewHistory, isAiThinking]);

    // ── Show finish option after background phase ─────────────────────────────────
    useEffect(() => {
        if (questionProgress.currentPhase !== 'background') setShowFinishOption(true);
    }, [questionProgress.currentPhase]);

    // ── Timer ─────────────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!questionProgress.isComplete) {
            timerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
        }
        return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }, [questionProgress.isComplete]);

    const formatTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

    // ── Stream Management ─────────────────────────────────────────────────────────
    const handleVideoRef = useCallback((node: HTMLVideoElement | null) => {
        videoRef.current = node;
        if (node && activeStream) {
            node.srcObject = activeStream;
            node.play().catch(() => { /* Auto-play might be blocked */ });
        }
    }, [activeStream]);

    // ── Camera Setup ──────────────────────────────────────────────────────────────
    useEffect(() => {
        let mounted = true;

        const startCamera = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                if (!mounted) {
                    stream.getTracks().forEach(t => t.stop());
                    return;
                }

                streamRef.current = stream;
                setActiveStream(stream);

                // If video element is already mounted, attach stream
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                }
            } catch (err) {
                console.warn('Camera/mic not available', err);
            }
        };

        startCamera();

        return () => {
            mounted = false;
            // Only stop tracks if we own them (on unmount)
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(t => t.stop());
                streamRef.current = null;
            }
        };
    }, []);

    const toggleCamera = () => {
        const videoTracks = streamRef.current?.getVideoTracks();
        videoTracks?.forEach(t => { t.enabled = isCameraOff; });
        setIsCameraOff(!isCameraOff);
    };

    const toggleMic = () => {
        const audioTracks = streamRef.current?.getAudioTracks();
        audioTracks?.forEach(t => { t.enabled = isMuted; });
        setIsMuted(!isMuted);
    };

    // ── TTS ───────────────────────────────────────────────────────────────────────
    const speak = useCallback((text: string) => {
        if (!isTTSEnabled || typeof window === 'undefined') return;
        const synth = window.speechSynthesis;
        synth.cancel();
        const clean = text.replace(/[*_`#>\[\]]/g, '').slice(0, 500);
        const utt = new SpeechSynthesisUtterance(clean);
        utt.rate = 0.95;
        utt.pitch = 1.05;
        const voices = synth.getVoices();
        const preferred = voices.find(v => v.name.includes('Google') && v.lang.startsWith('en'));
        if (preferred) utt.voice = preferred;
        utt.onstart = () => setAiSpeaking(true);
        utt.onend = () => setAiSpeaking(false);
        utt.onerror = () => setAiSpeaking(false);
        synth.speak(utt);
    }, [isTTSEnabled]);

    // ── Speech Recognition ────────────────────────────────────────────────────────
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
        if (!SpeechRecognition) return;

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        let silenceTimer: ReturnType<typeof setTimeout> | null = null;

        recognition.onstart = () => setIsListening(true);

        recognition.onresult = (event: any) => {
            let interim = '';
            let final = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) final += event.results[i][0].transcript;
                else interim += event.results[i][0].transcript;
            }
            setInterimText(interim);
            if (final) {
                setInput(prev => prev + (prev ? ' ' : '') + final);
                setInterimText('');
                // Auto-send after 2s silence
                if (silenceTimer) clearTimeout(silenceTimer);
                silenceTimer = setTimeout(() => {
                    setInput(prev => {
                        if (prev.trim()) {
                            handleSendRef.current?.(prev.trim());
                            return '';
                        }
                        return prev;
                    });
                }, 2000);
            }
        };

        recognition.onerror = () => setIsListening(false);
        recognition.onend = () => { setIsListening(false); setInterimText(''); };

        recognitionRef.current = recognition;
    }, []);

    const handleSendRef = useRef<((text: string) => void) | null>(null);

    const toggleListening = () => {
        if (isListening) {
            recognitionRef.current?.stop();
        } else {
            window.speechSynthesis?.cancel();
            try {
                recognitionRef.current?.start();
            } catch (e) {
                console.warn('Speech recognition already started', e);
            }
        }
    };

    // ── Start Session in DB ───────────────────────────────────────────────────────
    useEffect(() => {
        const startSession = async () => {
            try {
                // Read candidate info stored by /p/[token] form (for interviewer-created studies)
                let candidateInfo: { name?: string; email?: string; studyId?: string; difficulty?: string } = {};
                try {
                    const stored = sessionStorage.getItem('candidateInfo');
                    if (stored) {
                        candidateInfo = JSON.parse(stored);
                        // don't remove if we want to persist it for other components, but usually we consume it.
                        // sessionStorage.removeItem('candidateInfo'); 
                    }
                } catch { /* ignore */ }

                const res = await fetch('/api/sessions/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        role: studyConfig?.name || 'General Interview',
                        difficulty: candidateInfo.difficulty || 'medium',
                        mode: 'video',
                        ...(candidateInfo.studyId && { studyId: candidateInfo.studyId }),
                        ...(candidateInfo.name && { candidateName: candidateInfo.name }),
                        ...(candidateInfo.email && { candidateEmail: candidateInfo.email }),
                    }),
                });
                const data = await res.json();
                setSessionId(data.sessionId);
                setSessionGuest(data.guest || false);
            } catch {
                setSessionId(`fallback-${Date.now()}`);
                setSessionGuest(true);
            }
        };
        if (studyConfig) startSession();
    }, [studyConfig]);

    // ── Initialize Greeting ───────────────────────────────────────────────────────
    useEffect(() => {
        let mounted = true;
        const initialize = async () => {
            if (!studyConfig || initialized) return;
            setInitialized(true);
            setAiThinking(true);
            if (interviewHistory.length > 0) { setAiThinking(false); return; }
            try {
                const greeting = await getInterviewGreeting(studyConfig, participantToken);
                if (!mounted) return;
                const msg: InterviewMessage = { id: `msg-${Date.now()}`, role: 'ai', content: greeting, timestamp: Date.now() };
                addMessage(msg);
                setLastAiQuestion(greeting);
                speak(greeting);
            } catch { /* silent */ }
            finally { if (mounted) setAiThinking(false); }
        };
        initialize();
        return () => { mounted = false; };
    }, [studyConfig]);

    // ── Send Message ──────────────────────────────────────────────────────────────
    const handleSend = useCallback(async (textOverride?: string) => {
        const text = textOverride || input;
        if (!text.trim() || !studyConfig) return;

        const userMsg: InterviewMessage = { id: `msg-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() };
        addMessage(userMsg);
        setInput('');
        appendContext(text, 'text');
        setAiThinking(true);

        try {
            const currentContext = contextEntries.map(e => e.text).join('\n');
            const updatedHistory = [...interviewHistory, userMsg];
            const response = await generateInterviewResponse(updatedHistory, studyConfig, participantProfile, questionProgress, currentContext, participantToken);

            if (response.profileUpdates?.length) {
                response.profileUpdates.forEach(u => updateProfileField(u.fieldId, u.value, u.status));
                if (questionProgress.currentPhase === 'background') {
                    setProfileRawContext((participantProfile?.rawContext || '') + '\n' + text);
                }
            }
            if (response.phaseTransition) setInterviewPhase(response.phaseTransition);
            if (response.questionAddressed != null) markQuestionAsked(response.questionAddressed);

            const aiMsg: InterviewMessage = { id: `msg-${Date.now()}`, role: 'ai', content: response.message, timestamp: Date.now() };
            addMessage(aiMsg);
            setLastAiQuestion(response.message);
            speak(response.message);

            // Save to DB (fire-and-forget, non-blocking)
            if (sessionId && lastAiQuestion) {
                // Map scores to DB schema
                const dbScores = response.scores ? {
                    technicalScore: response.scores.technical,
                    communicationScore: response.scores.communication,
                    confidenceScore: response.scores.confidence,
                    logicScore: response.scores.logic,
                    depthScore: response.scores.depth
                } : extractScoresFromAIResponse(response.message, text);

                fetch(`/api/sessions/${sessionId}/save-response`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        questionText: lastAiQuestion.replace(/[*_`#>\[\]]/g, '').slice(0, 500),
                        category: questionProgress.currentPhase === 'core-questions' ? 'technical' : 'behavioral',
                        difficulty: 'medium',
                        answerText: text,
                        ...dbScores,
                        feedback: `Good response. ${dbScores.communicationScore > 70 ? 'Clear communication.' : 'Try to be more structured.'}`,
                        idealAnswer: '',
                        improvementTip: dbScores.depthScore < 60 ? 'Add more specific examples to strengthen your answer.' : 'Well done! Keep up the depth.',
                    }),
                }).catch(() => { });
            }

            if (response.shouldConclude) {
                completeInterview();
                // Complete session in DB
                if (sessionId) {
                    fetch(`/api/sessions/${sessionId}/complete`, { method: 'POST' }).catch(() => { });
                }
            }
        } catch {
            const errMsg: InterviewMessage = { id: `msg-${Date.now()}`, role: 'ai', content: "Could you elaborate on that?", timestamp: Date.now() };
            addMessage(errMsg);
        } finally {
            setAiThinking(false);
        }
    }, [input, studyConfig, interviewHistory, participantProfile, questionProgress, contextEntries, participantToken, sessionId, lastAiQuestion, speak]);

    // Keep ref in sync for the voice auto-send
    useEffect(() => { handleSendRef.current = handleSend; }, [handleSend]);

    const [isFinishing, setIsFinishing] = useState(false);

    const handleFinish = useCallback(async () => {
        if (isFinishing) return;
        setIsFinishing(true);

        // Stop timer immediately
        if (timerRef.current) clearInterval(timerRef.current);

        try {
            completeInterview();
            // BACKGROUND FETCH (Keepalive)
            if (sessionId) {
                fetch(`/api/sessions/${sessionId}/complete`, {
                    method: 'POST',
                    keepalive: true,
                }).catch(e => console.warn('Background complete failed', e));
            }
        } catch (e) {
            console.warn('Error completing interview:', e);
        } finally {
            // ALWAYS cleanup
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(t => t.stop());
                streamRef.current = null;
            }
            setActiveStream(null);

            // Navigate IMMEDIATELY
            // Navigate with fallback
            const targetUrl = (sessionId && !sessionGuest) ? `/results/${sessionId}` : '/synthesis';

            if (sessionGuest) setStep('synthesis');

            // Attempt Next.js router first
            router.push(targetUrl);

            // Force hard navigation if router hangs (3s fallback)
            setTimeout(() => {
                window.location.href = targetUrl;
            }, 3000);
        }
    }, [isFinishing, sessionId, sessionGuest, router, completeInterview, setStep]);

    const isComplete = questionProgress.isComplete;
    const totalQuestions = studyConfig?.coreQuestions?.length || 0;
    const questionsCompleted = questionProgress.questionsAsked.length;

    if (!studyConfig) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <p className="text-slate-400">No study configured.</p>
            </div>
        );
    }

    return (
        <VideoProctorGuard sessionId={sessionId} strictMode={true} onFullscreenExit={handleFinish} mediaStream={activeStream}>
            <div className="flex flex-col h-screen bg-slate-950 overflow-hidden">
                {/* ── Top Bar ── */}
                <div className="h-14 flex items-center justify-between px-3 sm:px-6 bg-slate-900/80 border-b border-slate-800 backdrop-blur-md flex-shrink-0 gap-2">
                    <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                        <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                            <span className="text-xs text-red-400 font-medium">LIVE</span>
                        </div>
                        <span className="text-slate-500 text-xs hidden sm:block">|</span>
                        <div className="flex items-center gap-1.5 text-slate-400 text-xs hidden sm:flex">
                            <Clock size={12} />
                            <span className="font-mono">{formatTime(elapsedSeconds)}</span>
                        </div>
                    </div>

                    <div className="flex-1 flex items-center justify-center min-w-0">
                        <div className="flex items-center gap-2 max-w-full">
                            <span className="text-sm font-medium text-white truncate">{studyConfig.name}</span>
                            <span className="text-xs text-slate-500 hidden sm:block truncate max-w-[80px] sm:max-w-none">
                                {phaseLabels[questionProgress.currentPhase]}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                        {/* Progress dots */}
                        <div className="hidden md:flex items-center gap-1">
                            {Array.from({ length: totalQuestions }).map((_, i) => (
                                <div key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${i < questionsCompleted ? 'bg-emerald-400' : i === questionsCompleted ? 'bg-blue-400 animate-pulse' : 'bg-slate-700'}`} />
                            ))}
                        </div>
                        <button
                            onClick={() => setShowChat(!showChat)}
                            className="sm:hidden p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors"
                        >
                            <MessageSquare size={18} />
                        </button>
                    </div>
                </div>

                {/* ── Main Content ── */}
                <div className="flex flex-1 overflow-hidden">

                    {/* ── Video Panel (left) ── */}
                    <div className={`flex flex-col gap-3 p-3 sm:p-4 transition-all duration-300 ${showChat ? 'hidden sm:flex sm:w-1/2 lg:w-3/5' : 'flex w-full'}`}>

                        {/* AI Avatar (top) */}
                        <div className="relative h-28 sm:h-36 rounded-2xl overflow-hidden bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 flex-shrink-0">
                            {/* Animated AI background */}
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="relative">
                                    {/* Outer pulse rings */}
                                    {aiSpeaking && (
                                        <>
                                            <motion.div animate={{ scale: [1, 1.4, 1], opacity: [0.3, 0, 0.3] }} transition={{ duration: 1.5, repeat: Infinity }} className="absolute inset-0 rounded-full bg-violet-500/20" style={{ width: 160, height: 160, margin: 'auto', top: -40, left: -40 }} />
                                            <motion.div animate={{ scale: [1, 1.6, 1], opacity: [0.2, 0, 0.2] }} transition={{ duration: 1.5, repeat: Infinity, delay: 0.3 }} className="absolute inset-0 rounded-full bg-indigo-500/20" style={{ width: 160, height: 160, margin: 'auto', top: -40, left: -40 }} />
                                        </>
                                    )}
                                    {/* AI Avatar circle */}
                                    <motion.div
                                        animate={aiSpeaking ? { scale: [1, 1.05, 1] } : { scale: 1 }}
                                        transition={{ duration: 0.6, repeat: aiSpeaking ? Infinity : 0 }}
                                        className="w-20 h-20 sm:w-28 sm:h-28 rounded-full bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center shadow-2xl shadow-violet-900/50 border-2 border-violet-500/30"
                                    >
                                        <Bot size={40} className="text-white" />
                                    </motion.div>
                                </div>
                            </div>

                            {/* AI Label */}
                            <div className="absolute top-3 left-3 flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${aiSpeaking ? 'bg-green-400 animate-pulse' : isAiThinking ? 'bg-amber-400 animate-pulse' : 'bg-slate-500'}`} />
                                <span className="text-xs text-slate-300 font-medium">AI Interviewer</span>
                            </div>

                            {/* TTS toggle */}
                            <button
                                onClick={() => { setIsTTSEnabled(!isTTSEnabled); window.speechSynthesis?.cancel(); }}
                                className="absolute top-3 right-3 p-1.5 rounded-lg bg-slate-800/80 text-slate-400 hover:text-white transition-colors"
                            >
                                {isTTSEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                            </button>

                            {/* Thinking indicator */}
                            {isAiThinking && (
                                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-slate-900/80 px-3 py-1.5 rounded-full border border-slate-700">
                                    <Loader2 size={12} className="animate-spin text-violet-400" />
                                    <span className="text-xs text-slate-400">Thinking...</span>
                                </div>
                            )}
                        </div>

                        {/* Candidate Camera (bottom) */}
                        <div className="relative flex-1 rounded-2xl overflow-hidden bg-slate-800 border border-slate-700 min-h-0">
                            <video
                                ref={handleVideoRef}
                                autoPlay
                                muted
                                playsInline
                                className={`w-full h-full object-cover ${isCameraOff ? 'opacity-0' : 'opacity-100'}`}
                            />
                            {isCameraOff && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-14 h-14 rounded-full bg-slate-700 flex items-center justify-center">
                                        <User size={24} className="text-slate-400" />
                                    </div>
                                </div>
                            )}

                            {/* Mic visualizer */}
                            {isListening && (
                                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-0.5">
                                    {[...Array(5)].map((_, i) => (
                                        <motion.div
                                            key={i}
                                            animate={{ height: [4, 12 + i * 3, 4] }}
                                            transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.1 }}
                                            className="w-1 bg-emerald-400 rounded-full"
                                            style={{ height: 4 }}
                                        />
                                    ))}
                                </div>
                            )}

                            <div className="absolute top-2 left-2 flex items-center gap-1.5">
                                <div className={`w-1.5 h-1.5 rounded-full ${isMuted ? 'bg-red-500' : 'bg-emerald-400'}`} />
                                <span className="text-xs text-slate-300">You</span>
                            </div>
                        </div>

                        {/* Controls */}
                        <div className="flex items-center justify-center gap-3 flex-shrink-0">
                            <button onClick={toggleMic} className={`p-3 rounded-full transition-all ${isMuted ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'}`}>
                                {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                            </button>
                            <button onClick={toggleCamera} className={`p-3 rounded-full transition-all ${isCameraOff ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'}`}>
                                {isCameraOff ? <VideoOff size={20} /> : <Video size={20} />}
                            </button>
                            <button onClick={toggleListening} className={`p-3 rounded-full transition-all ${isListening ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse' : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'}`}>
                                <Activity size={20} />
                            </button>
                            <button
                                onClick={handleFinish}
                                disabled={isFinishing}
                                className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-600 hover:bg-red-500 text-white border border-red-500 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                            >
                                {isFinishing ? (
                                    <Loader2 size={18} className="animate-spin" />
                                ) : (
                                    <Phone size={20} className="rotate-[135deg]" />
                                )}
                                <span className="hidden sm:inline text-sm font-medium">
                                    {isFinishing ? 'Ending...' : 'End Interview'}
                                </span>
                            </button>
                        </div>
                    </div>

                    {/* ── Chat Panel (right) ── */}
                    <div className={`flex flex-col border-l border-slate-800 bg-slate-900/50 transition-all duration-300 ${showChat ? 'flex w-full sm:w-1/2 lg:w-2/5' : 'hidden sm:flex sm:w-1/2 lg:w-2/5'}`}>
                        {/* Chat Header */}
                        <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2 flex-shrink-0">
                            <MessageSquare size={14} className="text-slate-500" />
                            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Transcript</span>
                            <span className="ml-auto text-xs text-slate-600">{interviewHistory.length} messages</span>
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
                            <AnimatePresence initial={false}>
                                {interviewHistory.map((msg) => (
                                    <motion.div
                                        key={msg.id}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                                    >
                                        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'ai' ? 'bg-violet-600' : 'bg-slate-700'}`}>
                                            {msg.role === 'ai' ? <Bot size={14} className="text-white" /> : <User size={14} className="text-slate-300" />}
                                        </div>
                                        <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${msg.role === 'ai' ? 'bg-slate-800 text-slate-200 rounded-tl-sm' : 'bg-violet-600/20 text-slate-200 border border-violet-500/20 rounded-tr-sm'}`}>
                                            <ReactMarkdown className="prose prose-invert prose-sm max-w-none">{msg.content}</ReactMarkdown>
                                        </div>
                                    </motion.div>
                                ))}
                            </AnimatePresence>

                            {isAiThinking && (
                                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2">
                                    <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center">
                                        <Bot size={14} className="text-white" />
                                    </div>
                                    <div className="bg-slate-800 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
                                        {[0, 1, 2].map(i => (
                                            <motion.div key={i} animate={{ y: [0, -4, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }} className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                                        ))}
                                    </div>
                                </motion.div>
                            )}

                            {/* Interim voice text */}
                            {interimText && (
                                <div className="flex gap-2 flex-row-reverse">
                                    <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
                                        <User size={14} className="text-slate-300" />
                                    </div>
                                    <div className="max-w-[80%] rounded-2xl rounded-tr-sm px-3 py-2 text-sm bg-slate-800/50 text-slate-400 border border-slate-700 border-dashed italic">
                                        {interimText}...
                                    </div>
                                </div>
                            )}

                            <div ref={messagesEndRef} />
                        </div>

                        {/* Completion Banner */}
                        {isComplete && (
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mx-4 mb-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-3">
                                <CheckCircle size={18} className="text-emerald-400 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-emerald-300">Interview Complete!</p>
                                    <p className="text-xs text-emerald-400/70">Click End Call to see your results</p>
                                </div>
                                <button
                                    onClick={handleFinish}
                                    disabled={isFinishing}
                                    className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors flex-shrink-0 disabled:opacity-70 disabled:cursor-not-allowed"
                                >
                                    {isFinishing ? <Loader2 size={12} className="animate-spin" /> : 'Results'}
                                    {!isFinishing && <ChevronRight size={12} />}
                                </button>
                            </motion.div>
                        )}

                        {/* Input */}
                        <div className="p-3 border-t border-slate-800 flex-shrink-0">
                            {/* Voice hint */}
                            {isListening && (
                                <div className="mb-2 flex items-center gap-2 text-xs text-emerald-400">
                                    <Activity size={12} className="animate-pulse" />
                                    Listening... speak now (auto-sends after pause)
                                </div>
                            )}
                            <div className="flex gap-2">
                                <button onClick={toggleListening} className={`p-2.5 rounded-xl transition-all flex-shrink-0 ${isListening ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700'}`}>
                                    {isListening ? <Mic size={18} className="animate-pulse" /> : <Mic size={18} />}
                                </button>
                                <input
                                    value={input}
                                    onChange={e => setInput(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                                    placeholder={isListening ? 'Listening...' : 'Type or speak your answer...'}
                                    className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500"
                                />
                                <button
                                    onClick={() => handleSend()}
                                    disabled={!input.trim() || isAiThinking}
                                    className="p-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                                >
                                    <Send size={18} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </VideoProctorGuard>
    );
};

export default VideoInterview;
