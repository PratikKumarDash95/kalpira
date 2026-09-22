'use client';
import { apiFetch, apiUrl } from '@/lib/apiClient';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Briefcase,
  Building2,
  CheckCircle,
  Clock,
  Mail,
  User,
  Users,
  XCircle,
} from 'lucide-react';
import InterviewFeedbackWidget from '@/components/InterviewFeedbackWidget';
import PageShell from '@/components/layout/PageShell';
import PageHeader from '@/components/layout/PageHeader';
import PageSection from '@/components/layout/PageSection';
import EmptyState from '@/components/layout/EmptyState';
import { SkeletonList, SkeletonPageHeader } from '@/components/ui/Skeleton';

interface CandidateInfo {
  id: string;
  name: string | null;
  email: string;
}

interface CandidateSession {
  id: string;
  studyId: string;
  title: string;
  description: string;
  topic: string;
  companyName?: string;
  interviewerName: string;
  interviewerEmail: string;
  candidateName: string;
  candidateEmail: string;
  assignedAt: string;
  completedAt: string | null;
  averageScore: number;
  status: 'assigned' | 'in_progress' | 'completed' | 'rejected';
  questionCount: number;
}

const activeStatusRank: Record<CandidateSession['status'], number> = {
  in_progress: 0,
  assigned: 0,
  completed: 1,
  rejected: 2,
};

const sessionTime = (session: CandidateSession) =>
  new Date(session.completedAt || session.assignedAt).getTime() || 0;

const CandidateDashboard: React.FC = () => {
  const router = useRouter();
  const [candidate, setCandidate] = useState<CandidateInfo | null>(null);
  const [sessions, setSessions] = useState<CandidateSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const sortedSessions = [...sessions].sort((a, b) => {
    const rankDiff = activeStatusRank[a.status] - activeStatusRank[b.status];
    if (rankDiff !== 0) return rankDiff;
    return sessionTime(b) - sessionTime(a);
  });

  useEffect(() => {
    const load = async () => {
      try {
        const [meRes, sessionsRes] = await Promise.all([
          apiFetch('/api/candidate/me'),
          apiFetch('/api/candidate/sessions'),
        ]);

        if (!meRes.ok) {
          // Not a candidate. Could be an interviewer/admin who landed here —
          // route them to their real dashboard instead of bouncing to /login.
          const profileRes = await apiFetch('/api/auth/me');
          const role = profileRes.ok ? (await profileRes.json())?.profile?.role : null;
          if (role === 'interviewer') router.push('/interviewer/dashboard');
          else if (role === 'admin') router.push('/admin');
          else router.push('/login?redirect=/candidate/dashboard');
          return;
        }

        const meData = await meRes.json();
        setCandidate(meData.user);

        if (!sessionsRes.ok) {
          const data = await sessionsRes.json().catch(() => ({}));
          setError(data.error || 'Failed to load assigned interviews.');
          return;
        }

        const sessionsData = await sessionsRes.json();
        setSessions(sessionsData.sessions || []);
      } catch {
        setError('Failed to load candidate dashboard.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [router]);

  const statusClass = (status: CandidateSession['status']) => {
    if (status === 'completed') return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
    if (status === 'in_progress') return 'bg-amber-500/10 text-amber-300 border-amber-500/20';
    if (status === 'rejected') return 'bg-red-500/10 text-red-300 border-red-500/20';
    return 'border-[color:var(--line-strong)] bg-[color:var(--brand-soft)] text-[color:var(--brand-strong)]';
  };

  const handleReject = async (sessionId: string) => {
    if (!window.confirm('Reject this interview? The interviewer will see that you declined it. This cannot be undone.')) return;
    setRejectingId(sessionId);
    try {
      const res = await apiFetch(`/api/candidate/sessions/${sessionId}/reject`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to reject interview.');
        return;
      }
      setSessions(prev =>
        prev.map(s => (s.id === sessionId ? { ...s, status: 'rejected' as const } : s))
      );
    } catch {
      setError('Failed to reject interview.');
    } finally {
      setRejectingId(null);
    }
  };

  if (loading) {
    // Shape-matched placeholder instead of a centred spinner: the header and the
    // assigned-interview list are already in place when the data lands.
    return (
      <PageShell width="wide" showFooter={false}>
        <div role="status">
          <span className="sr-only">Loading your dashboard…</span>
          <SkeletonPageHeader className="mb-6" />
          <SkeletonList rows={4} />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell width="wide" showFooter={false}>
      <PageHeader
        icon={<User size={20} />}
        title="Assigned Interviews"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {candidate?.name && <span className="font-semibold">{candidate.name}</span>}
            <span className="flex items-center gap-1">
              <Mail size={14} /> {candidate?.email}
            </span>
          </span>
        }
      />

      {error && (
        <div className="mb-6 p-4 rounded-2xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm">
          {error}
        </div>
      )}

      <PageSection>
        {sortedSessions.length === 0 ? (
          <EmptyState
            icon={<Briefcase size={32} />}
            title="No assigned interviews"
            description="When an interviewer assigns an interview to this email, it will appear here."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {sortedSessions.map((session, index) => (
              <motion.div
                key={session.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04 }}
                className="surface p-4 min-h-[18rem]"
              >
                <div className="flex h-full flex-col justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h2 className="text-base font-semibold text-white line-clamp-2">{session.title}</h2>
                      <span className={`px-2.5 py-1 rounded-full border text-xs capitalize ${statusClass(session.status)}`}>
                        {session.status.replace('_', ' ')}
                      </span>
                    </div>
                    {session.description && <p className="text-xs text-slate-400 mb-3 line-clamp-2">{session.description}</p>}
                    <div className="grid gap-2 text-xs text-slate-500">
                      <div className="flex items-center gap-2">
                        <Users size={13} className="shrink-0" />
                        <span className="line-clamp-2">Interviewer: {session.interviewerName}{session.interviewerEmail ? ` (${session.interviewerEmail})` : ''}</span>
                      </div>
                      {session.companyName && (
                        <div className="flex items-center gap-2">
                          <Building2 size={13} className="shrink-0" />
                          <span className="truncate">Company: {session.companyName}</span>
                        </div>
                      )}
                      {session.topic && (
                        <div className="flex items-center gap-2">
                          <Briefcase size={13} className="shrink-0" />
                          <span className="line-clamp-3">Topic: {session.topic}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Clock size={13} className="shrink-0" />
                        <span>Assigned {new Date(session.assignedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {session.status === 'rejected' ? (
                      <div className="flex w-full items-center justify-center gap-2 px-3 py-2.5 bg-red-500/10 text-red-300 border border-red-500/20 rounded-xl text-sm font-medium">
                        <XCircle size={16} /> You rejected this interview
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => router.push(session.completedAt ? `/results/${session.id}` : `/candidate/interview/${session.id}`)}
                          className="btn-primary w-full px-3 py-2.5 text-sm"
                        >
                          {session.completedAt ? <CheckCircle size={16} /> : <ArrowRight size={16} />}
                          {session.completedAt ? 'View Results' : 'Start Interview'}
                        </button>
                        {!session.completedAt && (
                          <button
                            onClick={() => handleReject(session.id)}
                            disabled={rejectingId === session.id}
                            className="flex w-full items-center justify-center gap-2 px-3 py-2.5 bg-slate-800 hover:bg-red-500/10 hover:text-red-300 text-slate-400 border border-slate-700 hover:border-red-500/20 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                          >
                            <XCircle size={16} /> {rejectingId === session.id ? 'Rejecting…' : 'Reject Interview'}
                          </button>
                        )}
                      </>
                    )}
                    {session.completedAt && (
                      <InterviewFeedbackWidget sessionId={session.id} interviewerName={session.interviewerName} />
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </PageSection>
    </PageShell>
  );
};

export default CandidateDashboard;
