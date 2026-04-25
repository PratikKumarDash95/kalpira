'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useStore } from '@/store';
import { generateParticipantLink } from '@/services/geminiService';
import { StudyConfig, AIProviderType, DEFAULT_GEMINI_MODEL } from '@/types';
import {
    FileText, Plus, X, ArrowRight, Sparkles, Brain, Briefcase, Layers,
    Code, Award, Hash, Zap, Loader2, AlertCircle
} from 'lucide-react';

const PracticeSetup: React.FC = () => {
    const router = useRouter();
    const { setParticipantToken, setStudyConfig, resetParticipant } = useStore();

    const [role, setRole] = useState('');
    const [jobDescription, setJobDescription] = useState('');
    const [techStack, setTechStack] = useState('');
    const [topicAreas, setTopicAreas] = useState<string[]>(['']);
    const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
    const [questionCount, setQuestionCount] = useState<number>(5);

    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const addTopic = () => setTopicAreas([...topicAreas, '']);
    const removeTopic = (i: number) => {
        if (topicAreas.length > 1) setTopicAreas(topicAreas.filter((_, idx) => idx !== i));
    };
    const updateTopic = (i: number, v: string) => {
        const u = [...topicAreas]; u[i] = v; setTopicAreas(u);
    };

    const handleSubmit = async () => {
        if (!role.trim()) { setError('Job Role is required'); return; }

        setIsGenerating(true);
        setError(null);
        resetParticipant();

        // Construct the research question / prompt context from inputs
        const contextPrompt = `
      Conduct a ${difficulty} practice interview for a ${role} position.
      
      Job Description:
      ${jobDescription || 'Not specified'}
      
      Tech Stack/Skills:
      ${techStack || 'Not specified'}
      
      Focus Areas:
      ${topicAreas.filter(t => t.trim()).join(', ') || 'General role-related topics'}
      
      Constraint:
      Ask exactly ${questionCount} questions in total.
    `.trim();

        const config: StudyConfig = {
            id: `study-practice-${Date.now()}`,
            name: `Practice: ${role}`,
            description: `Self-guided practice interview for ${role}`,
            researchQuestion: contextPrompt,
            // Populate coreQuestions with generic prompts so the progress bar works
            coreQuestions: Array(questionCount).fill("Formulate a relevant interview question based on the job role and topic areas."),
            topicAreas: topicAreas.filter(t => t.trim()),
            profileSchema: [], // No profile collection needed for self-practice
            aiBehavior: 'standard',
            aiProvider: 'gemini', // Default
            aiModel: DEFAULT_GEMINI_MODEL,
            enableReasoning: false,
            linksEnabled: true,
            linkExpiration: 'never',
            consentText: 'This is a practice session. Your responses are analyzed by AI to provide feedback.',
            createdAt: Date.now(),
        };

        try {
            // Generate token
            const { token } = await generateParticipantLink(config);
            setParticipantToken(token);
            setStudyConfig(config);

            // Store practice settings in sessionStorage for VideoInterview to pick up
            // We use 'candidateInfo' key which VideoInterview reads.
            // We'll also store 'practiceMode' flag.
            sessionStorage.setItem('candidateInfo', JSON.stringify({
                name: 'Candidate', // Default name
                email: 'practice@user', // Dummy email
                difficulty,
                questionCount,
                isPractice: true
            }));

            // Redirect to participant view
            router.push(`/p/${token}`);
        } catch (err) {
            console.error('Error starting practice:', err);
            setError('Failed to start interview. Please try again.');
            setIsGenerating(false);
        }
    };

    const inputCls = "w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500 transition-colors text-sm";
    const labelCls = "block text-sm font-medium text-slate-300 mb-1.5 flex items-center gap-2";

    return (
        <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8">
            {/* Background */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute inset-0 bg-gradient-to-br from-violet-950/20 via-slate-950 to-indigo-950/10" />
                <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-600/5 rounded-full blur-3xl opacity-50" />
            </div>

            <div className="relative max-w-3xl mx-auto">
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-violet-900/40">
                        <Briefcase size={32} className="text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-2">Practice Interview</h1>
                    <p className="text-slate-400">Configure your session and get AI-powered feedback.</p>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="space-y-6">

                    {/* Main Form */}
                    <div className="grid md:grid-cols-2 gap-6">

                        {/* Left Column */}
                        <div className="space-y-6">
                            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
                                <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                                    <FileText size={14} className="text-violet-400" /> Job Details
                                </h2>

                                <div>
                                    <label className={labelCls}>Job Role <span className="text-violet-400">*</span></label>
                                    <input
                                        type="text" value={role} onChange={e => setRole(e.target.value)}
                                        placeholder="e.g. Senior Frontend Engineer"
                                        className={inputCls} autoFocus
                                    />
                                </div>

                                <div>
                                    <label className={labelCls}>Techn Stack / Skills</label>
                                    <textarea
                                        value={techStack} onChange={e => setTechStack(e.target.value)}
                                        placeholder="e.g. React, Next.js, TypeScript, Node.js"
                                        rows={2} className={`${inputCls} resize-none`}
                                    />
                                </div>

                                <div>
                                    <label className={labelCls}>Job Description <span className="text-slate-500 font-normal">(optional)</span></label>
                                    <textarea
                                        value={jobDescription} onChange={e => setJobDescription(e.target.value)}
                                        placeholder="Paste the JD here for more context..."
                                        rows={4} className={`${inputCls} resize-none`}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Right Column */}
                        <div className="space-y-6">

                            {/* Settings */}
                            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
                                <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                                    <Layers size={14} className="text-violet-400" /> Session Settings
                                </h2>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className={labelCls}><Award size={14} /> Difficulty</label>
                                        <div className="flex bg-slate-800 rounded-xl p-1 border border-slate-700">
                                            {(['easy', 'medium', 'hard'] as const).map(d => (
                                                <button
                                                    key={d}
                                                    onClick={() => setDifficulty(d)}
                                                    className={`flex-1 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${difficulty === d ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                                                >
                                                    {d}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <label className={labelCls}><Hash size={14} /> Questions</label>
                                        <select
                                            value={questionCount}
                                            onChange={e => setQuestionCount(Number(e.target.value))}
                                            className={inputCls}
                                        >
                                            <option value={5}>5 Questions</option>
                                            <option value={8}>8 Questions</option>
                                            <option value={10}>10 Questions</option>
                                            <option value={15}>15 Questions</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Topic Areas */}
                            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                                        <Sparkles size={14} className="text-violet-400" /> Topic Areas
                                    </h2>
                                    <button onClick={addTopic} className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1">
                                        <Plus size={12} /> Add
                                    </button>
                                </div>

                                <div className="space-y-2">
                                    {topicAreas.map((t, i) => (
                                        <div key={i} className="flex gap-2">
                                            <input
                                                value={t} onChange={e => updateTopic(i, e.target.value)}
                                                placeholder={`Topic ${i + 1}`}
                                                className={`${inputCls} py-2`}
                                            />
                                            {topicAreas.length > 1 && (
                                                <button onClick={() => removeTopic(i)} className="text-slate-600 hover:text-red-400 p-2">
                                                    <X size={16} />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                        </div>
                    </div>

                    {error && (
                        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400">
                            <AlertCircle size={20} />
                            <p className="text-sm">{error}</p>
                        </div>
                    )}

                    <button
                        onClick={handleSubmit}
                        disabled={!role.trim() || isGenerating}
                        className="w-full py-4 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-lg rounded-2xl transition-all shadow-lg shadow-violet-900/30 flex items-center justify-center gap-3"
                    >
                        {isGenerating ? <Loader2 size={24} className="animate-spin" /> : <Zap size={24} />}
                        {isGenerating ? 'Setting up...' : 'Start Interview'}
                    </button>

                </motion.div>
            </div>
        </div>
    );
};

export default PracticeSetup;
