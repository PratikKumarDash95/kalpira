'use client';
import { apiFetch } from '@/lib/apiClient';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { deleteStudy } from '@/services/storageService';
import { useQuery, setQuery, invalidateQuery } from '@/lib/queryCache';
import { STUDIES_DETAIL_PREFIX } from '@/lib/queryKeys';
import { STUDIES_QUERY_KEY, fetchStudies, type StudiesPayload } from '@/lib/studiesQuery';
import { useProfile } from '@/hooks/useProfile';
import {
  Loader2,
  Plus,
  BookOpen,
  Users,
  Calendar,
  Lock,
  Unlock,
  Trash2,
  Eye,
  Link as LinkIcon,
  MoreVertical,
  AlertTriangle,
  Briefcase
} from 'lucide-react';
import PageShell from '@/components/layout/PageShell';
import PageHeader from '@/components/layout/PageHeader';
import PageSection from '@/components/layout/PageSection';
import EmptyState from '@/components/layout/EmptyState';

const StudyList: React.FC = () => {
  const router = useRouter();
  // Cached: a revisit paints the real list on the first frame and revalidates
  // behind it, instead of re-showing the skeleton grid every time.
  const { data } = useQuery<StudiesPayload>(STUDIES_QUERY_KEY, fetchStudies);
  const { status: sessionStatus, profile } = useProfile();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [assignedInterviewCount, setAssignedInterviewCount] = useState(0);

  const studies = data?.studies ?? [];
  const kvWarning = data?.warning ?? null;
  // Only a first-ever fetch has nothing to show; a revalidation keeps the list.
  const loading = data === undefined;

  useEffect(() => {
    // Only used to decide whether to surface the "assigned interviews" badge.
    // Waits for the shared profile so this does not race the navbar's own read.
    if (sessionStatus !== 'authed') return;
    if (profile?.role === 'interviewer' || profile?.role === 'admin') return;

    let cancelled = false;
    apiFetch('/api/candidate/sessions')
      .then(async (sessionsRes) => {
        if (!sessionsRes.ok || cancelled) return;
        const sessionsData = await sessionsRes.json();
        if (cancelled) return;
        const assignedCount = (sessionsData?.sessions || []).filter(
          (session: { status?: string }) =>
            session.status === 'assigned' || session.status === 'in_progress',
        ).length;
        setAssignedInterviewCount(assignedCount);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [sessionStatus, profile?.role]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this study? This cannot be undone.')) {
      return;
    }

    setDeletingId(id);
    try {
      const result = await deleteStudy(id);
      if (result.success) {
        // Write the confirmed deletion through the cache rather than
        // invalidating it: clearing would drop the list to `undefined` and flash
        // the skeleton the user just navigated away from.
        setQuery<StudiesPayload>(STUDIES_QUERY_KEY, {
          studies: studies.filter(s => s.id !== id),
          warning: kvWarning ?? undefined,
        });
        invalidateQuery(STUDIES_DETAIL_PREFIX);
      } else {
        alert(result.error || 'Failed to delete study');
      }
    } catch (error) {
      console.error('Error deleting study:', error);
      alert('Failed to delete study');
    } finally {
      setDeletingId(null);
      setMenuOpenId(null);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const renderStudySkeleton = () => (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="skeleton-card rounded-xl border border-stone-700 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-3">
              <div className="skeleton h-5 w-3/4" />
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-2/3" />
            </div>
            <div className="skeleton h-9 w-9 rounded-lg" />
          </div>
          <div className="mt-6 flex gap-3">
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-4 w-28" />
          </div>
          <div className="mt-4 flex gap-2">
            <div className="skeleton h-7 w-20 rounded-full" />
            <div className="skeleton h-7 w-24 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );

  const renderAssignedBadge = () => {
    if (assignedInterviewCount <= 0) return null;

    return (
      <span className="absolute -right-2 -top-2 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold leading-5 text-center shadow-lg shadow-red-500/30 ring-2 ring-white">
        {assignedInterviewCount > 99 ? '99+' : assignedInterviewCount}
      </span>
    );
  };

  return (
    <PageShell showFooter={false}>
      <PageHeader
        icon={<BookOpen size={20} />}
        title="My Studies"
        subtitle={`${studies.length} ${studies.length === 1 ? 'study' : 'studies'}`}
        actions={
          <>
            <Link href="/setup" className="btn-primary sheen px-3 py-2 text-sm">
              <Plus size={16} />
              Create Study
            </Link>

            <Link
              href="/candidate/dashboard"
              title="Open assigned interviews"
              className="btn-secondary relative px-3 py-2 text-sm"
            >
              <Briefcase size={16} />
              Interview Practice
              {renderAssignedBadge()}
            </Link>

            <Link href="/dashboard" className="btn-secondary px-3 py-2 text-sm">
              <Users size={16} />
              All Interviews
            </Link>
          </>
        }
      />

      {/* Storage Warning Banner */}
      {kvWarning && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 bg-amber-900/30 border border-amber-700/50 rounded-xl p-4 flex items-start gap-3"
        >
          <AlertTriangle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-medium text-amber-300 mb-1">Storage Not Configured</h4>
              <p className="text-sm text-amber-400/80">{kvWarning}</p>
              <p className="text-sm text-amber-400/60 mt-2">
                Check Supabase project and table setup for Supabase Postgres.
              </p>
            </div>
          </motion.div>
        )}

      <PageSection>
        {loading ? (
          renderStudySkeleton()
        ) : studies.length === 0 ? (
          <EmptyState
            icon={<BookOpen size={32} />}
            title="No Studies Yet"
            description="Create your first practice study or open an interview assigned by an interviewer."
            action={
              <div className="flex flex-wrap items-center justify-center gap-4">
                <Link href="/setup" className="btn-primary sheen px-6 py-3">
                  <Plus size={18} />
                  Create Study
                </Link>

                <Link
                  href="/candidate/dashboard"
                  title="Open assigned interviews"
                  className="btn-secondary relative px-6 py-3"
                >
                  <Briefcase size={18} />
                  Interview Practice
                  {renderAssignedBadge()}
                </Link>
              </div>
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {studies.map((study, index) => (
              <motion.div
                key={study.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                // Capped: with a cached list this runs on every visit, so a
                // 6-card list should not take 300ms to finish appearing.
                transition={{ delay: Math.min(index, 5) * 0.04 }}
                className="bg-stone-800/50 rounded-xl border border-stone-700 p-6 hover:border-stone-500 transition-colors relative"
              >
                {/* Menu button. Deliberately a sibling of the card link, not a
                    child: a <button> inside an <a> is invalid HTML and swallows
                    the wrong clicks. */}
                <div className="absolute top-4 right-4 z-20">
                  <button
                    onClick={() => setMenuOpenId(menuOpenId === study.id ? null : study.id)}
                    aria-label="Study actions"
                    aria-expanded={menuOpenId === study.id}
                    className="p-2 text-stone-500 hover:text-stone-400 rounded-lg hover:bg-stone-700"
                  >
                    <MoreVertical size={16} />
                  </button>
                  {menuOpenId === study.id && (
                    <div className="absolute right-0 mt-1 w-48 bg-stone-800 border border-stone-700 rounded-xl shadow-card-lg z-10 overflow-hidden">
                      <button
                        onClick={() => {
                          router.push(`/studies/${study.id}`);
                          setMenuOpenId(null);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-stone-300 hover:bg-stone-700 flex items-center gap-2"
                      >
                        <Eye size={14} />
                        View Details
                      </button>
                      <button
                        onClick={() => {
                          // Store study config in sessionStorage for setup page
                          sessionStorage.setItem('prefillStudyConfig', JSON.stringify(study.config));
                          router.push(`/setup?prefill=edit&studyId=${study.id}`);
                          setMenuOpenId(null);
                        }}
                        disabled={study.isLocked}
                        className="w-full px-4 py-2 text-left text-sm text-stone-300 hover:bg-stone-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <LinkIcon size={14} />
                        Edit & Generate Link
                      </button>
                      <button
                        onClick={() => handleDelete(study.id)}
                        disabled={deletingId === study.id || study.interviewCount > 0}
                        className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-stone-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {deletingId === study.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                        Delete
                      </button>
                    </div>
                  )}
                </div>

                {/* Content — the link. Also prefetches the detail route, so the
                    ⋯ → View Details path is warm too. */}
                <Link href={`/studies/${study.id}`} className="block pr-10">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="flex-1">
                      <h3 className="font-semibold text-white text-lg mb-1">
                        {study.config.name}
                      </h3>
                      {study.config.description && (
                        <p className="text-sm text-stone-400 line-clamp-2">
                          {study.config.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-4 text-sm text-stone-500 mb-3">
                    <div className="flex items-center gap-1">
                      <Users size={14} />
                      <span>{study.interviewCount} interviews</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar size={14} />
                      <span>{formatDate(study.createdAt)}</span>
                    </div>
                  </div>

                  {/* Status badges */}
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 text-xs rounded-full flex items-center gap-1 ${study.isLocked
                      ? 'bg-stone-700 text-stone-400'
                      : 'bg-green-900/50 text-green-400'
                      }`}>
                      {study.isLocked ? <Lock size={10} /> : <Unlock size={10} />}
                      {study.isLocked ? 'Locked' : 'Editable'}
                    </span>
                    <span className="px-2 py-1 text-xs rounded-full bg-stone-700 text-stone-400">
                      {study.config.coreQuestions?.length ?? 0} questions
                    </span>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </PageSection>
    </PageShell>
  );
};

export default StudyList;
