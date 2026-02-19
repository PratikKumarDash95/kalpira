'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useStore } from '@/store';
import { ParticipantToken } from '@/types';
import Consent from '@/components/Consent';
import VideoInterview from '@/components/VideoInterview';
import Synthesis from '@/components/Synthesis';
import Export from '@/components/Export';
import { Loader2, User, Mail, ArrowRight, Briefcase } from 'lucide-react';
import { motion } from 'framer-motion';

// ── Candidate Info Form ──────────────────────────────────────────────────────
function CandidateInfoForm({
  studyName,
  onSubmit,
}: {
  studyName: string;
  onSubmit: (name: string, email: string) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Please enter your name.'); return; }
    if (!email.trim() || !email.includes('@')) { setError('Please enter a valid email.'); return; }
    onSubmit(name.trim(), email.trim());
  };

  const inputCls = "w-full pl-10 pr-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500 transition-colors text-sm";

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-950/20 via-slate-950 to-indigo-950/10" />
        <div className="absolute top-0 left-1/3 w-96 h-96 bg-violet-600/5 rounded-full blur-3xl" />
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-violet-900/40">
            <Briefcase size={26} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">You're Invited</h1>
          <p className="text-slate-400 text-sm mt-1">
            Interview: <span className="text-slate-200 font-medium">{studyName}</span>
          </p>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 backdrop-blur-sm">
          <p className="text-sm text-slate-400 mb-6 text-center">
            Please enter your details before starting the interview.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="Your full name" className={inputCls} required />
            </div>
            <div className="relative">
              <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="Your email address" className={inputCls} required />
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">{error}</div>
            )}

            <button type="submit"
              className="w-full py-3.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 mt-2">
              <ArrowRight size={18} /> Start Interview
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}

// ── Main Participant Page ─────────────────────────────────────────────────────
export default function ParticipantPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const {
    currentStep,
    setStep,
    setStudyConfig,
    setViewMode,
    setParticipantToken,
    studyConfig
  } = useStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsCandidateInfo, setNeedsCandidateInfo] = useState(false);
  const [studyName, setStudyName] = useState('');
  const [studyId, setStudyId] = useState<string | null>(null);

  useEffect(() => {
    const loadStudyFromToken = async () => {
      if (!token) { setError('No token provided'); setLoading(false); return; }

      try {
        const response = await fetch(`/api/generate-link?token=${encodeURIComponent(token)}`);
        const result = await response.json();

        if (!result.valid || !result.data) {
          setError('Invalid or expired link');
          setLoading(false);
          return;
        }

        const tokenData = result.data as ParticipantToken;
        setStudyConfig(tokenData.studyConfig);
        setParticipantToken(token);
        setViewMode('participant');

        // Check if this is an interviewer-created study (has an id that's a real DB id)
        const config = tokenData.studyConfig;
        if (config?.id && !config.id.startsWith('study-')) {
          // This is a saved study — ask for candidate info
          setStudyName(config.name || 'Interview');
          setStudyId(config.id);
          setNeedsCandidateInfo(true);
        } else {
          setStep('consent');
        }

        setLoading(false);
      } catch (err) {
        console.error('Error loading study from token:', err);
        setError('Failed to load study configuration');
        setLoading(false);
      }
    };

    loadStudyFromToken();
  }, [token]);

  const handleCandidateInfoSubmit = async (name: string, email: string) => {
    // Store candidate info in sessionStorage so InterviewChat can pick it up
    sessionStorage.setItem('candidateInfo', JSON.stringify({ name, email, studyId }));
    setNeedsCandidateInfo(false);
    setStep('consent');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <Loader2 size={48} className="animate-spin text-violet-400 mx-auto mb-4" />
          <p className="text-slate-400">Loading interview...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">⚠️</span>
          </div>
          <h1 className="text-xl font-semibold text-white mb-2">Unable to Load Interview</h1>
          <p className="text-slate-400 mb-6">{error}</p>
          <p className="text-slate-500 text-sm">Please check that you have the correct link or contact the interviewer.</p>
        </div>
      </div>
    );
  }

  if (!studyConfig) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-slate-400">Study configuration not found.</p>
      </div>
    );
  }

  // Show candidate info form for interviewer-created studies
  if (needsCandidateInfo) {
    return <CandidateInfoForm studyName={studyName} onSubmit={handleCandidateInfoSubmit} />;
  }

  switch (currentStep) {
    case 'consent': return <Consent />;
    case 'interview': return <VideoInterview />;
    case 'synthesis': return <Synthesis />;
    case 'export': return <Export />;
    default: return <Consent />;
  }
}
