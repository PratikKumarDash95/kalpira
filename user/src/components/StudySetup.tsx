'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store';
import { generateParticipantLink } from '@/services/geminiService';
import { StudyConfig, ProfileField, AIBehavior, AIProviderType, LinkExpirationOption, GEMINI_MODELS, CLAUDE_MODELS, OLLAMA_MODELS, DEFAULT_GEMINI_MODEL, DEFAULT_CLAUDE_MODEL, DEFAULT_OLLAMA_MODEL } from '@/types';
import {
  FileText, Plus, X, ArrowRight, ArrowLeft, Sparkles, Eye,
  Lightbulb, User, ToggleLeft, ToggleRight, Link as LinkIcon,
  Copy, Check, Loader2, LogIn, Save, CheckCircle, GitBranch,
  Clock, AlertTriangle, ExternalLink, Brain, MessageSquare,
  Settings, ChevronRight, Zap
} from 'lucide-react';

const PROFILE_PRESETS: ProfileField[] = [
  { id: 'role', label: 'Current Role', extractionHint: 'Their job title or position', required: true },
  { id: 'industry', label: 'Industry', extractionHint: 'The industry they work in', required: false },
  { id: 'experience', label: 'Years of Experience', extractionHint: 'How many years in their field', required: false },
  { id: 'team_size', label: 'Team Size', extractionHint: 'Size of team they work with', required: false },
  { id: 'location', label: 'Location', extractionHint: 'Where they are based (city/region)', required: false }
];

const STEPS = [
  { id: 1, label: 'Study Details', icon: FileText, desc: 'Name, questions & topics' },
  { id: 2, label: 'AI Settings', icon: Brain, desc: 'Provider, model & style' },
  { id: 3, label: 'Launch', icon: Zap, desc: 'Links, consent & go live' },
];

const StudySetup: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setStudyConfig, setStep, studyConfig, loadExampleStudy, setViewMode, setParticipantToken, resetParticipant } = useStore();

  const [currentStep, setCurrentStep] = useState(1);
  const [parentStudyInfo, setParentStudyInfo] = useState<{ id: string; name: string } | null>(null);

  const [name, setName] = useState(studyConfig?.name || '');
  const [description, setDescription] = useState(studyConfig?.description || '');
  const [researchQuestion, setResearchQuestion] = useState(studyConfig?.researchQuestion || '');
  const [coreQuestions, setCoreQuestions] = useState<string[]>(studyConfig?.coreQuestions || ['']);
  const [topicAreas, setTopicAreas] = useState<string[]>(studyConfig?.topicAreas || ['']);
  const [profileSchema, setProfileSchema] = useState<ProfileField[]>(studyConfig?.profileSchema || []);
  const [aiBehavior, setAiBehavior] = useState<AIBehavior>(studyConfig?.aiBehavior || 'standard');
  const [aiProvider, setAiProvider] = useState<AIProviderType>(studyConfig?.aiProvider || 'gemini');
  const [aiModel, setAiModel] = useState<string>(
    studyConfig?.aiModel || (studyConfig?.aiProvider === 'claude' ? DEFAULT_CLAUDE_MODEL : studyConfig?.aiProvider === 'ollama' ? DEFAULT_OLLAMA_MODEL : DEFAULT_GEMINI_MODEL)
  );
  const [enableReasoning, setEnableReasoning] = useState<boolean | undefined>(studyConfig?.enableReasoning);
  const [linkExpiration, setLinkExpiration] = useState<LinkExpirationOption>(studyConfig?.linkExpiration || 'never');
  const [consentText, setConsentText] = useState(
    studyConfig?.consentText ||
    'Thank you for participating in this research study. Your responses will be used to understand [research topic]. You may stop at any time. Do you consent to participate?'
  );

  const [participantLink, setParticipantLink] = useState<string | null>(null);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [savedStudyId, setSavedStudyId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [configStatus, setConfigStatus] = useState<{ hasAnthropicKey: boolean; hasGeminiKey: boolean; hasOllamaConfigured: boolean; } | null>(null);

  useEffect(() => {
    if (studyConfig?.id && !studyConfig.id.startsWith('study-')) {
      setSavedStudyId(studyConfig.id);
    } else {
      setSavedStudyId(null);
    }
  }, [studyConfig?.id]);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth', { method: 'GET' });
        setIsAuthenticated(res.ok);
      } catch { setIsAuthenticated(false); }
    };
    checkAuth();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetch('/api/config/status').then(r => r.ok ? r.json() : null).then(d => d && setConfigStatus(d)).catch(() => { });
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const prefillType = searchParams.get('prefill');
    if (prefillType === 'followup' || prefillType === 'edit') {
      const prefillData = sessionStorage.getItem('prefillStudyConfig');
      if (prefillData) {
        try {
          const config = JSON.parse(prefillData) as Partial<StudyConfig>;
          if (config.name) setName(config.name);
          if (config.description) setDescription(config.description);
          if (config.researchQuestion) setResearchQuestion(config.researchQuestion);
          if (config.coreQuestions?.length) setCoreQuestions(config.coreQuestions);
          if (config.topicAreas?.length) setTopicAreas(config.topicAreas);
          if (config.profileSchema?.length) setProfileSchema(config.profileSchema);
          if (config.aiBehavior) setAiBehavior(config.aiBehavior);
          if (config.aiProvider) setAiProvider(config.aiProvider);
          if (config.aiModel) setAiModel(config.aiModel);
          if (config.enableReasoning !== undefined) setEnableReasoning(config.enableReasoning);
          if (config.linkExpiration) setLinkExpiration(config.linkExpiration);
          if (config.consentText) setConsentText(config.consentText);
          if (prefillType === 'followup' && config.parentStudyId && config.parentStudyName) {
            setParentStudyInfo({ id: config.parentStudyId, name: config.parentStudyName });
          }
          if (prefillType === 'edit') {
            const studyId = searchParams.get('studyId');
            if (studyId) { setSavedStudyId(studyId); setIsDirty(false); }
          } else { setIsDirty(true); }
          sessionStorage.removeItem('prefillStudyConfig');
        } catch (error) { console.error('Error parsing prefill config:', error); }
      }
    }
  }, [searchParams]);

  useEffect(() => {
    if (studyConfig) {
      setName(studyConfig.name);
      setDescription(studyConfig.description);
      setResearchQuestion(studyConfig.researchQuestion);
      setCoreQuestions(studyConfig.coreQuestions.length > 0 ? studyConfig.coreQuestions : ['']);
      setTopicAreas(studyConfig.topicAreas.length > 0 ? studyConfig.topicAreas : ['']);
      setProfileSchema(studyConfig.profileSchema || []);
      setAiBehavior(studyConfig.aiBehavior);
      setAiProvider(studyConfig.aiProvider || 'gemini');
      setAiModel(studyConfig.aiModel || DEFAULT_GEMINI_MODEL);
      setEnableReasoning(studyConfig.enableReasoning);
      setLinkExpiration(studyConfig.linkExpiration || 'never');
      setConsentText(studyConfig.consentText);
    }
  }, [studyConfig]);

  const addQuestion = () => { setCoreQuestions([...coreQuestions, '']); setIsDirty(true); };
  const removeQuestion = (i: number) => { if (coreQuestions.length > 1) { setCoreQuestions(coreQuestions.filter((_, idx) => idx !== i)); setIsDirty(true); } };
  const updateQuestion = (i: number, v: string) => { const u = [...coreQuestions]; u[i] = v; setCoreQuestions(u); setIsDirty(true); };

  const addTopic = () => { setTopicAreas([...topicAreas, '']); setIsDirty(true); };
  const removeTopic = (i: number) => { if (topicAreas.length > 1) { setTopicAreas(topicAreas.filter((_, idx) => idx !== i)); setIsDirty(true); } };
  const updateTopic = (i: number, v: string) => { const u = [...topicAreas]; u[i] = v; setTopicAreas(u); setIsDirty(true); };

  const addProfileField = (preset?: ProfileField) => {
    if (preset) {
      if (!profileSchema.some(f => f.id === preset.id)) { setProfileSchema([...profileSchema, preset]); setIsDirty(true); }
    } else {
      setProfileSchema([...profileSchema, { id: `field-${Date.now()}`, label: '', extractionHint: '', required: false }]);
      setIsDirty(true);
    }
  };
  const removeProfileField = (id: string) => { setProfileSchema(profileSchema.filter(f => f.id !== id)); setIsDirty(true); };
  const updateProfileField = (id: string, updates: Partial<ProfileField>) => { setProfileSchema(profileSchema.map(f => f.id === id ? { ...f, ...updates } : f)); setIsDirty(true); };
  const toggleFieldRequired = (id: string) => { setProfileSchema(profileSchema.map(f => f.id === id ? { ...f, required: !f.required } : f)); setIsDirty(true); };

  const buildConfig = (): StudyConfig => ({
    id: studyConfig?.id || `study-${Date.now()}`,
    name: name || 'Untitled Study',
    description, researchQuestion,
    coreQuestions: coreQuestions.filter(q => q.trim()),
    topicAreas: topicAreas.filter(t => t.trim()),
    profileSchema: profileSchema.filter(f => f.label.trim()),
    aiBehavior, aiProvider, aiModel, enableReasoning, linkExpiration,
    linksEnabled: true, consentText,
    createdAt: studyConfig?.createdAt || Date.now(),
    ...(parentStudyInfo && { parentStudyId: parentStudyInfo.id, parentStudyName: parentStudyInfo.name, generatedFrom: 'synthesis' as const })
  });

  const handleSubmit = async () => {
    resetParticipant();
    const config = buildConfig();
    setStudyConfig(config);
    try {
      const { token } = await generateParticipantLink(config);
      setParticipantToken(token);
    } catch (error) { console.warn('Could not generate token:', error); }
    setStep('consent');
    router.push('/consent');
  };

  const handlePreview = async () => {
    setIsPreviewLoading(true);
    resetParticipant();
    const config = buildConfig();
    setStudyConfig(config);
    try {
      const { token } = await generateParticipantLink(config);
      setParticipantToken(token);
    } catch (error) { console.warn('Could not generate preview token:', error); }
    setIsPreviewLoading(false);
    setViewMode('participant');
    setStep('consent');
    router.push('/consent');
  };

  const handleGenerateLink = async () => {
    setIsGeneratingLink(true);
    setLinkError(null);
    try {
      const config = buildConfig();
      setStudyConfig(config);
      const response = await fetch('/api/generate-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studyConfig: config })
      });
      if (!response.ok) {
        if (response.status === 401) { setLinkError('auth'); setIsAuthenticated(false); }
        else { const data = await response.json(); setLinkError(data.error || 'Failed to generate link'); }
        return;
      }
      const data = await response.json();
      setParticipantLink(data.url);
    } catch { setLinkError('Network error. Please try again.'); }
    finally { setIsGeneratingLink(false); }
  };

  const handleCopyLink = () => {
    if (participantLink) { navigator.clipboard.writeText(participantLink); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); }
  };

  const handleSaveStudy = async () => {
    if (isAuthenticated === false) { router.push('/login'); return; }
    if (isAuthenticated === null) return;
    setIsSaving(true); setSaveSuccess(false); setSaveError(null);
    try {
      const config = buildConfig();
      const isUpdate = !!savedStudyId;
      const response = await fetch(isUpdate ? `/api/studies/${savedStudyId}` : '/api/studies', {
        method: isUpdate ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config })
      });
      if (!response.ok) {
        if (response.status === 401) { setIsAuthenticated(false); router.push('/login'); return; }
        if (response.status === 503) { setSaveError('Storage not configured. Please connect Vercel KV.'); return; }
        if (response.status === 409) {
          const data = await response.json();
          if (data.requiresConfirmation) {
            const confirmed = window.confirm(`${data.warning}\n\nDo you want to continue?`);
            if (confirmed) {
              const retryResponse = await fetch(`/api/studies/${savedStudyId}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config, confirmed: true })
              });
              if (retryResponse.ok) {
                const retryData = await retryResponse.json();
                setSavedStudyId(retryData.study.id); setStudyConfig(retryData.study.config);
                setSaveSuccess(true); setIsDirty(false);
                router.push(`/studies/${retryData.study.id}`);
              }
            }
            return;
          }
        }
        const data = await response.json().catch(() => ({}));
        setSaveError(data.error || 'Failed to save study.'); return;
      }
      const data = await response.json();
      setSavedStudyId(data.study.id); setSaveSuccess(true);
      setStudyConfig(data.study.config); setIsDirty(false);
      router.push(`/studies/${data.study.id}`);
    } catch { setSaveError('Network error. Please check your connection.'); }
    finally { setIsSaving(false); }
  };

  const isValid = name.trim() && researchQuestion.trim();
  const availablePresets = PROFILE_PRESETS.filter(p => !profileSchema.some(f => f.id === p.id));

  const behaviorOptions: { id: AIBehavior; label: string; desc: string; icon: React.ReactNode }[] = [
    { id: 'structured', label: 'Structured', desc: 'Cover all questions. Minimal follow-ups.', icon: <FileText size={18} /> },
    { id: 'standard', label: 'Standard', desc: 'Balance coverage and depth.', icon: <MessageSquare size={18} /> },
    { id: 'exploratory', label: 'Exploratory', desc: 'Chase insights. Deep probing.', icon: <Sparkles size={18} /> },
  ];

  const providerOptions: { id: AIProviderType; label: string; desc: string; badge?: string }[] = [
    { id: 'gemini', label: 'Google Gemini', desc: 'Fast & cost-effective', badge: 'Recommended' },
    { id: 'claude', label: 'Anthropic Claude', desc: 'Nuanced reasoning' },
    { id: 'ollama', label: 'Ollama (Local)', desc: 'Free & private' },
  ];

  // ── Input class ──────────────────────────────────────────────────────────────
  const inputCls = "w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500 transition-colors text-sm";

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-950/20 via-slate-950 to-indigo-950/10" />
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-violet-600/5 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-2xl mx-auto px-4 py-8">

        {/* ── Top Bar ── */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => router.push('/studies')}
            className="flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors text-sm"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <button
            onClick={loadExampleStudy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-xs transition-colors border border-slate-700"
          >
            <Lightbulb size={14} /> Load Example
          </button>
        </div>

        {/* ── Header ── */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Create Interview Study</h1>
          <p className="text-slate-400 text-sm">Set up your AI-powered research interview in 3 steps</p>
        </motion.div>

        {/* ── Step Indicator ── */}
        <div className="flex items-center gap-0 mb-8">
          {STEPS.map((step, idx) => {
            const Icon = step.icon;
            const isActive = currentStep === step.id;
            const isDone = currentStep > step.id;
            return (
              <React.Fragment key={step.id}>
                <button
                  onClick={() => isDone && setCurrentStep(step.id)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all ${isActive ? 'bg-violet-600/20 border border-violet-500/30' : isDone ? 'cursor-pointer hover:bg-slate-800/50' : 'opacity-40 cursor-default'}`}
                >
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${isActive ? 'bg-violet-600 text-white' : isDone ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-500'}`}>
                    {isDone ? <Check size={14} /> : <Icon size={14} />}
                  </div>
                  <div className="hidden sm:block text-left">
                    <p className={`text-xs font-semibold ${isActive ? 'text-violet-300' : isDone ? 'text-emerald-400' : 'text-slate-500'}`}>{step.label}</p>
                    <p className="text-xs text-slate-600">{step.desc}</p>
                  </div>
                </button>
                {idx < STEPS.length - 1 && (
                  <div className={`flex-1 h-px mx-1 ${currentStep > step.id ? 'bg-emerald-500/40' : 'bg-slate-800'}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* ── Follow-up Banner ── */}
        {parentStudyInfo && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex items-center gap-3">
            <GitBranch size={18} className="text-blue-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-blue-300">Follow-up Study</p>
              <p className="text-xs text-slate-400">Based on <button onClick={() => router.push(`/studies/${parentStudyInfo.id}`)} className="text-blue-400 hover:underline">{parentStudyInfo.name}</button></p>
            </div>
          </motion.div>
        )}

        {/* ── Save Error ── */}
        {saveError && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-300">Save Failed</p>
              <p className="text-xs text-red-400/80 mt-0.5">{saveError}</p>
            </div>
            <button onClick={() => setSaveError(null)} className="text-red-400 hover:text-red-300"><X size={16} /></button>
          </motion.div>
        )}

        {/* ── Step Content ── */}
        <AnimatePresence mode="wait">

          {/* ─── STEP 1: Study Details ─── */}
          {currentStep === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">

              {/* Study Info */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
                <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Sparkles size={14} className="text-violet-400" /> Study Info
                </h2>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Study Name <span className="text-violet-400">*</span></label>
                  <input
                    type="text" value={name}
                    onChange={e => { setName(e.target.value); setIsDirty(true); }}
                    placeholder="e.g., AI Adoption in Healthcare"
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Research Question <span className="text-violet-400">*</span></label>
                  <textarea
                    value={researchQuestion}
                    onChange={e => { setResearchQuestion(e.target.value); setIsDirty(true); }}
                    placeholder="What are you trying to understand?"
                    rows={2}
                    className={`${inputCls} resize-none`}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Description <span className="text-slate-500 font-normal">(optional)</span></label>
                  <textarea
                    value={description}
                    onChange={e => { setDescription(e.target.value); setIsDirty(true); }}
                    placeholder="Brief context about the study..."
                    rows={2}
                    className={`${inputCls} resize-none`}
                  />
                </div>
              </div>

              {/* Core Questions */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    <MessageSquare size={14} className="text-violet-400" /> Core Questions
                  </h2>
                  <button onClick={addQuestion} className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors px-2 py-1 rounded-lg hover:bg-violet-500/10">
                    <Plus size={14} /> Add
                  </button>
                </div>
                <p className="text-xs text-slate-500">Must-ask questions for your interview</p>
                <div className="space-y-2">
                  {coreQuestions.map((q, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <span className="text-slate-600 text-xs pt-3.5 w-5 text-right flex-shrink-0">{i + 1}</span>
                      <textarea
                        value={q}
                        onChange={e => updateQuestion(i, e.target.value)}
                        placeholder={`Question ${i + 1}...`}
                        rows={2}
                        className={`${inputCls} resize-none flex-1`}
                      />
                      {coreQuestions.length > 1 && (
                        <button onClick={() => removeQuestion(i)} className="p-2 mt-1.5 text-slate-600 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10 flex-shrink-0">
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Topic Areas */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    <Lightbulb size={14} className="text-violet-400" /> Topic Areas
                  </h2>
                  <button onClick={addTopic} className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors px-2 py-1 rounded-lg hover:bg-violet-500/10">
                    <Plus size={14} /> Add
                  </button>
                </div>
                <p className="text-xs text-slate-500">Themes the AI should probe (e.g., fears, motivations, trade-offs)</p>
                <div className="space-y-2">
                  {topicAreas.map((t, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <span className="text-slate-600 text-xs pt-3.5 w-5 text-right flex-shrink-0">{i + 1}</span>
                      <textarea
                        value={t}
                        onChange={e => updateTopic(i, e.target.value)}
                        placeholder={`Topic area ${i + 1}...`}
                        rows={2}
                        className={`${inputCls} resize-none flex-1`}
                      />
                      {topicAreas.length > 1 && (
                        <button onClick={() => removeTopic(i)} className="p-2 mt-1.5 text-slate-600 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10 flex-shrink-0">
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Profile Fields */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    <User size={14} className="text-violet-400" /> Participant Profile
                  </h2>
                  <button onClick={() => addProfileField()} className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors px-2 py-1 rounded-lg hover:bg-violet-500/10">
                    <Plus size={14} /> Custom
                  </button>
                </div>
                <p className="text-xs text-slate-500">Info to gather about participants during the interview</p>

                {availablePresets.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    <span className="text-xs text-slate-600 self-center">Quick add:</span>
                    {availablePresets.map(preset => (
                      <button key={preset.id} onClick={() => addProfileField(preset)}
                        className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-full transition-colors border border-slate-700">
                        + {preset.label}
                      </button>
                    ))}
                  </div>
                )}

                <div className="space-y-2">
                  {profileSchema.map(field => (
                    <div key={field.id} className="flex items-center gap-2 p-3 bg-slate-800/50 rounded-xl border border-slate-700">
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <input type="text" value={field.label} onChange={e => updateProfileField(field.id, { label: e.target.value })}
                          placeholder="Field label" className={`${inputCls} py-2`} />
                        <input type="text" value={field.extractionHint} onChange={e => updateProfileField(field.id, { extractionHint: e.target.value })}
                          placeholder="Hint for AI" className={`${inputCls} py-2`} />
                      </div>
                      <button onClick={() => toggleFieldRequired(field.id)}
                        className={`px-2 py-1 text-xs rounded-lg flex-shrink-0 border transition-colors ${field.required ? 'bg-violet-500/20 text-violet-300 border-violet-500/30' : 'bg-slate-700 text-slate-500 border-slate-600'}`}>
                        {field.required ? 'REQ' : 'OPT'}
                      </button>
                      <button onClick={() => removeProfileField(field.id)} className="p-1.5 text-slate-600 hover:text-red-400 transition-colors flex-shrink-0">
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                  {profileSchema.length === 0 && (
                    <p className="text-center py-4 text-slate-600 text-xs">No profile fields yet. Use quick add above.</p>
                  )}
                </div>
              </div>

              {/* Next */}
              <button
                onClick={() => setCurrentStep(2)}
                disabled={!name.trim() || !researchQuestion.trim()}
                className="w-full py-3.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
              >
                Continue to AI Settings <ChevronRight size={18} />
              </button>
            </motion.div>
          )}

          {/* ─── STEP 2: AI Settings ─── */}
          {currentStep === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">

              {/* AI Provider */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
                <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Brain size={14} className="text-violet-400" /> AI Provider
                </h2>
                <div className="grid grid-cols-3 gap-3">
                  {providerOptions.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => {
                        setAiProvider(opt.id);
                        setAiModel(opt.id === 'claude' ? DEFAULT_CLAUDE_MODEL : opt.id === 'ollama' ? DEFAULT_OLLAMA_MODEL : DEFAULT_GEMINI_MODEL);
                        setIsDirty(true);
                      }}
                      className={`relative p-4 rounded-xl border-2 text-left transition-all ${aiProvider === opt.id ? 'border-violet-500 bg-violet-500/10' : 'border-slate-700 hover:border-slate-600 bg-slate-800/30'}`}
                    >
                      {opt.badge && <span className="absolute top-2 right-2 text-xs bg-violet-600 text-white px-1.5 py-0.5 rounded-full">{opt.badge}</span>}
                      <p className={`text-sm font-semibold mb-0.5 ${aiProvider === opt.id ? 'text-violet-300' : 'text-slate-300'}`}>{opt.label}</p>
                      <p className="text-xs text-slate-500">{opt.desc}</p>
                    </button>
                  ))}
                </div>

                {/* Model */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Model</label>
                  <select value={aiModel} onChange={e => { setAiModel(e.target.value); setIsDirty(true); }} className={inputCls}>
                    {(aiProvider === 'gemini' ? GEMINI_MODELS : aiProvider === 'claude' ? CLAUDE_MODELS : OLLAMA_MODELS).map(m => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-600 mt-1">
                    {(aiProvider === 'gemini' ? GEMINI_MODELS : aiProvider === 'claude' ? CLAUDE_MODELS : OLLAMA_MODELS).find(m => m.id === aiModel)?.desc || ''}
                  </p>
                </div>

                {/* Reasoning */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Reasoning Mode</label>
                  <select value={enableReasoning === undefined ? 'auto' : enableReasoning ? 'on' : 'off'}
                    onChange={e => { const v = e.target.value; setEnableReasoning(v === 'auto' ? undefined : v === 'on'); setIsDirty(true); }}
                    className={inputCls}>
                    <option value="auto">Automatic (recommended)</option>
                    <option value="on">Always enabled</option>
                    <option value="off">Always disabled</option>
                  </select>
                  <p className="text-xs text-slate-600 mt-1">Auto: OFF for interviews (faster), ON for synthesis (deeper analysis)</p>
                </div>

                {/* Warnings */}
                {aiProvider === 'claude' && configStatus && !configStatus.hasAnthropicKey && (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-2">
                    <AlertTriangle size={15} className="text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-amber-300">Anthropic API Key Missing</p>
                      <p className="text-xs text-slate-400 mt-0.5">Set <code className="text-slate-300">ANTHROPIC_API_KEY</code> in your environment variables.</p>
                    </div>
                  </div>
                )}
                {aiProvider === 'ollama' && (
                  <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-start gap-2">
                    <AlertTriangle size={15} className="text-blue-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-blue-300">Ollama must be running locally</p>
                      <p className="text-xs text-slate-400 mt-0.5">Run <code className="text-slate-300">ollama pull {aiModel}</code> to download the model.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Interview Style */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
                <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Settings size={14} className="text-violet-400" /> Interview Style
                </h2>
                <div className="grid grid-cols-3 gap-3">
                  {behaviorOptions.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => { setAiBehavior(opt.id); setIsDirty(true); }}
                      className={`p-4 rounded-xl border-2 text-left transition-all ${aiBehavior === opt.id ? 'border-violet-500 bg-violet-500/10' : 'border-slate-700 hover:border-slate-600 bg-slate-800/30'}`}
                    >
                      <div className={`mb-2 ${aiBehavior === opt.id ? 'text-violet-400' : 'text-slate-500'}`}>{opt.icon}</div>
                      <p className={`text-sm font-semibold mb-0.5 ${aiBehavior === opt.id ? 'text-violet-300' : 'text-slate-300'}`}>{opt.label}</p>
                      <p className="text-xs text-slate-500">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setCurrentStep(1)} className="flex-1 py-3.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-all flex items-center justify-center gap-2">
                  <ArrowLeft size={16} /> Back
                </button>
                <button onClick={() => setCurrentStep(3)} className="flex-1 py-3.5 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2">
                  Continue <ChevronRight size={18} />
                </button>
              </div>
            </motion.div>
          )}

          {/* ─── STEP 3: Launch ─── */}
          {currentStep === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">

              {/* Consent Text */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
                <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Consent Text</h2>
                <textarea
                  value={consentText}
                  onChange={e => { setConsentText(e.target.value); setIsDirty(true); }}
                  rows={4}
                  className={`${inputCls} resize-none`}
                />
              </div>

              {/* Link Settings */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
                <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Clock size={14} className="text-violet-400" /> Link Settings
                </h2>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Link Expiration</label>
                  <select value={linkExpiration} onChange={e => { setLinkExpiration(e.target.value as LinkExpirationOption); setIsDirty(true); }} className={inputCls}>
                    <option value="never">Never expire</option>
                    <option value="7days">Expire after 7 days</option>
                    <option value="30days">Expire after 30 days</option>
                    <option value="90days">Expire after 90 days</option>
                  </select>
                  <p className="text-xs text-slate-600 mt-1">Expired links show an error when participants try to access them.</p>
                </div>

                {/* Generate Participant Link */}
                {isValid && (
                  <div className="pt-2">
                    <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                      <LinkIcon size={14} className="text-violet-400" /> Participant Link
                    </label>
                    {participantLink ? (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <input type="text" value={participantLink} readOnly
                            className="flex-1 px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 text-xs font-mono" />
                          <button onClick={handleCopyLink}
                            className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl transition-colors flex items-center gap-2 text-sm">
                            {linkCopied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                            {linkCopied ? 'Copied!' : 'Copy'}
                          </button>
                        </div>
                        <p className="text-xs text-slate-600">Share this link with participants.</p>
                      </div>
                    ) : isAuthenticated === false || linkError === 'auth' ? (
                      <div className="p-4 bg-slate-800/50 border border-slate-700 rounded-xl">
                        <p className="text-sm text-slate-400 mb-3">Login required to generate participant links.</p>
                        <button onClick={() => router.push('/login')}
                          className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm transition-colors">
                          <LogIn size={16} /> Login as Researcher
                        </button>
                      </div>
                    ) : (
                      <button onClick={handleGenerateLink} disabled={isGeneratingLink}
                        className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm disabled:opacity-50">
                        <LinkIcon size={16} />
                        {isGeneratingLink ? 'Generating...' : 'Generate Participant Link'}
                      </button>
                    )}
                    {linkError && linkError !== 'auth' && <p className="text-xs text-red-400 mt-1">{linkError}</p>}
                  </div>
                )}
              </div>

              {/* Summary Card */}
              <div className="bg-violet-500/5 border border-violet-500/20 rounded-2xl p-5 space-y-3">
                <h3 className="text-sm font-semibold text-violet-300 flex items-center gap-2"><CheckCircle size={14} /> Ready to launch</h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="text-slate-400"><span className="text-slate-500">Study:</span> <span className="text-slate-200">{name || '—'}</span></div>
                  <div className="text-slate-400"><span className="text-slate-500">Provider:</span> <span className="text-slate-200 capitalize">{aiProvider}</span></div>
                  <div className="text-slate-400"><span className="text-slate-500">Questions:</span> <span className="text-slate-200">{coreQuestions.filter(q => q.trim()).length}</span></div>
                  <div className="text-slate-400"><span className="text-slate-500">Style:</span> <span className="text-slate-200 capitalize">{aiBehavior}</span></div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-3">
                <button
                  onClick={handleSubmit}
                  disabled={!isValid}
                  className="w-full py-4 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-violet-900/30"
                >
                  <Zap size={18} /> Start Interview Now
                </button>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={handlePreview}
                    disabled={!isValid || isPreviewLoading}
                    className="py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-medium rounded-xl transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-40"
                  >
                    {isPreviewLoading ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
                    Preview
                  </button>
                  <button
                    onClick={handleSaveStudy}
                    disabled={!isValid || !isAuthenticated || isSaving || (!!savedStudyId && !isDirty)}
                    className={`py-3 font-medium rounded-xl transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-40 border ${savedStudyId && !isDirty ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'}`}
                  >
                    {isSaving ? <Loader2 size={16} className="animate-spin" /> : savedStudyId && !isDirty ? <CheckCircle size={16} /> : <Save size={16} />}
                    {isSaving ? 'Saving...' : savedStudyId && !isDirty ? 'Saved' : savedStudyId ? 'Update' : 'Save Study'}
                  </button>
                </div>

                <button onClick={() => setCurrentStep(2)} className="w-full py-2.5 text-slate-500 hover:text-slate-400 text-sm transition-colors flex items-center justify-center gap-1">
                  <ArrowLeft size={14} /> Back to AI Settings
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default StudySetup;
