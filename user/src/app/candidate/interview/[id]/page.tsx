'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useStore } from '@/store';
import Consent from '@/components/Consent';
import VideoInterview from '@/components/VideoInterview';
import Synthesis from '@/components/Synthesis';
import Export from '@/components/Export';
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';

export default function CandidateInterviewPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;
  const {
    currentStep,
    setStep,
    setStudyConfig,
    setViewMode,
    setParticipantToken,
    resetParticipant,
    studyConfig,
  } = useStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const prepare = async () => {
      try {
        const response = await fetch(`/api/candidate/sessions/${sessionId}/start`, { method: 'POST' });
        const data = await response.json();

        if (!response.ok) {
          if (response.status === 401) {
            router.push(`/login?redirect=/candidate/interview/${sessionId}`);
            return;
          }
          setError(data.error || 'Unable to start this interview.');
          return;
        }

        resetParticipant();
        setStudyConfig(data.studyConfig);
        setParticipantToken(null);
        setViewMode('participant');
        sessionStorage.setItem('candidateInfo', JSON.stringify({
          name: data.candidate.name,
          email: data.candidate.email,
          studyId: data.studyId,
          sessionId: data.sessionId,
        }));
        setStep('consent');
      } catch {
        setError('Failed to prepare interview.');
      } finally {
        setLoading(false);
      }
    };

    if (sessionId) prepare();
  }, [sessionId, router, resetParticipant, setParticipantToken, setStep, setStudyConfig, setViewMode]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 size={40} className="animate-spin text-violet-400" />
      </div>
    );
  }

  if (error || !studyConfig) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <AlertTriangle size={42} className="text-amber-400 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-white mb-2">Interview Unavailable</h1>
          <p className="text-slate-400 text-sm mb-6">{error || 'Interview configuration was not found.'}</p>
          <button onClick={() => router.push('/candidate/dashboard')} className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-sm">
            <ArrowLeft size={16} /> Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  switch (currentStep) {
    case 'consent': return <Consent />;
    case 'interview': return <VideoInterview />;
    case 'synthesis': return <Synthesis />;
    case 'export': return <Export />;
    default: return <Consent />;
  }
}
