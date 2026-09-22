'use client';
import { apiFetch } from '@/lib/apiClient';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, ChevronRight, Sparkles } from 'lucide-react';
import PageShell from '@/components/layout/PageShell';
import PageHeader from '@/components/layout/PageHeader';
import PageSection from '@/components/layout/PageSection';
import { Skeleton, SkeletonCard, SkeletonPageHeader } from '@/components/ui/Skeleton';

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
      <PageShell width="narrow">
        <SkeletonPageHeader className="mb-8" />
        <SkeletonCard>
          <Skeleton className="mb-5 h-6 w-44" />
          <Skeleton className="h-12" />
        </SkeletonCard>
      </PageShell>
    );
  }

  return (
    <PageShell width="narrow">
      <PageHeader
        back="/studies"
        title="Settings"
        subtitle={profile?.email}
      />

      <PageSection>
        {/* Subscription */}
        <div className="bg-stone-800/50 rounded-xl border border-stone-700 p-6">
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
              <Sparkles size={16} className="text-brand-700" /> Manage plan &amp; usage
            </span>
            <ChevronRight size={18} className="text-stone-400" />
          </button>
        </div>
      </PageSection>
    </PageShell>
  );
};

export default Settings;
