'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/store';
import VideoInterview from '@/components/VideoInterview';
import { Loader2, AlertTriangle, ArrowRight } from 'lucide-react';

export default function InterviewPage() {
  const router = useRouter();
  const { studyConfig, participantToken } = useStore();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Wait for Zustand persist to finish hydrating from sessionStorage.
    // Using the persist API directly is more reliable than a fixed timer.
    const anyStore = useStore as unknown as {
      persist?: { hasHydrated: () => boolean; onFinishHydration: (cb: () => void) => () => void };
    };
    if (anyStore.persist?.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsub = anyStore.persist?.onFinishHydration(() => setHydrated(true));
    // Safety fallback: if persist API isn't available, hydrate after a short delay
    const fallback = setTimeout(() => setHydrated(true), 500);
    return () => {
      unsub?.();
      clearTimeout(fallback);
    };
  }, []);

  if (!hydrated) {
    return (
      <div className="kalpira-light min-h-screen flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-stone-400" />
      </div>
    );
  }

  // No study configured — redirect to setup
  if (!studyConfig) {
    return (
      <div className="kalpira-light min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-amber-900/30 border border-amber-700/50 flex items-center justify-center mx-auto">
            <AlertTriangle size={28} className="text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white mb-2">No Study Configured</h1>
            <p className="text-stone-400 text-sm">
              Please go through the setup first to configure your interview.
            </p>
          </div>
          <button
            onClick={() => router.push('/setup')}
            className="inline-flex items-center gap-2 px-6 py-3 bg-stone-600 hover:bg-stone-500 text-white font-medium rounded-xl transition-colors"
          >
            Go to Setup <ArrowRight size={18} />
          </button>
        </div>
      </div>
    );
  }

  return <VideoInterview />;
}
