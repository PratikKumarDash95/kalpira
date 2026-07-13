'use client';
import { apiFetch } from '@/lib/apiClient';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
  BookOpen, Dumbbell, CheckCircle, ArrowRight, Loader2, AlertCircle, Sparkles,
} from 'lucide-react';

// Onboarding no longer collects API keys or storage credentials — self-created
// studies and practices run on the platform's AI, gated by the user's
// subscription. This is now just a welcome + one-click start that marks
// onboarding complete.
const Onboarding: React.FC = () => {
  const router = useRouter();
  const [profile, setProfile] = useState<{ name?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        if (data.profile) setProfile(data.profile);
      })
      .catch(() => {});
  }, []);

  const complete = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const completeRes = await apiFetch('/api/onboarding/complete', { method: 'POST' });
      if (!completeRes.ok) {
        setSaveError('Failed to complete onboarding. Please try again.');
        setSaving(false);
        return;
      }
      router.push('/studies');
    } catch {
      setSaveError('Connection error. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-900 flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-lg w-full"
      >
        <div className="bg-stone-800/50 rounded-xl border border-stone-700 p-8">
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-full bg-stone-700 flex items-center justify-center mx-auto mb-4">
              <Sparkles size={28} className="text-stone-300" />
            </div>
            <h1 className="text-2xl font-bold text-white">
              Welcome{profile?.name ? `, ${profile.name.split(' ')[0]}` : ''}!
            </h1>
            <p className="text-stone-400 mt-3 leading-relaxed">
              You&apos;re ready to go. Create your own AI-powered <strong className="text-stone-300">studies</strong> and
              run <strong className="text-stone-300">practice interviews</strong> — all on our platform, no API keys needed.
            </p>
          </div>

          <div className="space-y-3 mb-6">
            <div className="flex items-start gap-3 p-3 bg-stone-800 rounded-lg">
              <BookOpen size={18} className="text-stone-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-stone-200 text-sm font-medium">Custom studies</p>
                <p className="text-stone-400 text-xs">Design your own interview studies with AI</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-stone-800 rounded-lg">
              <Dumbbell size={18} className="text-stone-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-stone-200 text-sm font-medium">Practice interviews</p>
                <p className="text-stone-400 text-xs">Sharpen your skills with self-guided practice</p>
              </div>
            </div>
          </div>

          <p className="text-stone-500 text-xs text-center mb-6">
            Your free Trial plan includes a few studies and practice sessions. Upgrade any time from your subscription page.
          </p>

          {saveError && (
            <div className="flex items-center gap-2 p-3 mb-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              <AlertCircle size={16} className="flex-shrink-0" />
              {saveError}
            </div>
          )}

          <button
            onClick={complete}
            disabled={saving}
            className="w-full py-3 bg-stone-600 hover:bg-stone-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Getting ready...
              </>
            ) : (
              <>
                <CheckCircle size={18} />
                Create Your First Study
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default Onboarding;
