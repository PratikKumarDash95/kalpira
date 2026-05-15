'use client';

import { Suspense } from 'react';
import StudySetup from '@/components/StudySetup';
import { Loader2 } from 'lucide-react';

export default function InterviewerSetupPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-violet-400" />
      </div>
    }>
      <StudySetup />
    </Suspense>
  );
}
