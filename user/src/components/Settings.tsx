'use client';
import { apiFetch } from '@/lib/apiClient';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CreditCard, ChevronRight, Sparkles } from 'lucide-react';

interface ResearcherProfile {
  name: string;
  email: string;
  avatarUrl: string | null;
}

// API keys and storage credentials are no longer user-configurable — self-created
// studies and practices run on the platform's AI and are gated by the user's
// subscription. Settings now just surfaces the account and a link to the plan.
const Settings: React.FC = () => {
  const router = useRouter();
  const [profile, setProfile] = useState<ResearcherProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        if (data.profile) setProfile(data.profile);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="kalpira-light min-h-screen p-8">
        <div className="mx-auto max-w-2xl">
          <div className="mb-8 flex items-center gap-3">
            <div className="skeleton h-10 w-10 rounded-lg" />
            <div className="space-y-2">
              <div className="skeleton h-7 w-32" />
              <div className="skeleton h-4 w-56" />
            </div>
          </div>
          <div className="skeleton-card rounded-xl border border-stone-700 p-6">
            <div className="skeleton mb-5 h-6 w-44" />
            <div className="skeleton h-12" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="kalpira-light min-h-screen p-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-2xl mx-auto"
      >
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => router.push('/studies')}
            className="p-2 hover:bg-stone-800 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} className="text-stone-400" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">Settings</h1>
            {profile && (
              <p className="text-stone-400 text-sm">{profile.email}</p>
            )}
          </div>
        </div>

        {/* Subscription */}
        <div className="bg-stone-800/50 rounded-xl border border-stone-700 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard size={18} className="text-stone-400" />
            <h2 className="text-lg font-semibold text-white">Subscription</h2>
          </div>
          <p className="text-stone-400 text-sm mb-4">
            Your plan sets how many custom studies and practice sessions you can create.
            Everything runs on our platform&apos;s AI — no API keys required.
          </p>
          <button
            onClick={() => router.push('/subscription')}
            className="flex w-full items-center justify-between rounded-xl border border-stone-600 bg-stone-800 px-4 py-3 text-left transition-colors hover:bg-stone-700"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-stone-200">
              <Sparkles size={16} className="text-violet-400" /> Manage plan &amp; usage
            </span>
            <ChevronRight size={18} className="text-stone-400" />
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default Settings;
