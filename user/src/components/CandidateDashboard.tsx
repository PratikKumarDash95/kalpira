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
  Loader2,
  Mail,
  User,
  Users,
} from 'lucide-react';

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
  status: 'assigned' | 'in_progress' | 'completed';
  questionCount: number;
}

const activeStatusRank: Record<CandidateSession['status'], number> = {
  in_progress: 0,
  assigned: 0,
  completed: 1,
};

const sessionTime = (session: CandidateSession) =>
  new Date(session.completedAt || session.assignedAt).getTime() || 0;

const CandidateDashboard: React.FC = () => {
  const router = useRouter();
  const [candidate, setCandidate] = useState<CandidateInfo | null>(null);
  const [sessions, setSessions] = useState<CandidateSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
          router.push('/login?redirect=/candidate/dashboard');
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
    return 'bg-violet-500/10 text-violet-300 border-violet-500/20';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 size={40} className="animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="fixed inset-0 pointer-events-none bg-gradient-to-br from-violet-950/20 via-slate-950 to-indigo-950/10" />

      <div className="relative max-w-[1500px] mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center">
              <User size={18} />
            </div>
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider">Candidate Dashboard</p>
              <p className="text-sm font-semibold text-slate-200">{candidate?.name || candidate?.email}</p>
            </div>
          </div>
          <button onClick={() => router.push('/studies')} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition-colors border border-slate-700">
            <ArrowRight size={15} className="rotate-180" /> Studies
          </button>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <h1 className="text-2xl font-bold">Assigned Interviews</h1>
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Mail size={14} /> {candidate?.email}
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-2xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm">
            {error}
          </div>
        )}

        {sortedSessions.length === 0 ? (
          <div className="bg-slate-900/40 border border-slate-800 border-dashed rounded-2xl p-12 text-center">
            <Briefcase size={40} className="text-slate-700 mx-auto mb-4" />
            <h2 className="text-slate-300 font-medium mb-2">No assigned interviews</h2>
            <p className="text-slate-600 text-sm">When an interviewer assigns an interview to this email, it will appear here.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {sortedSessions.map((session, index) => (
              <motion.div
                key={session.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04 }}
                className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 min-h-[18rem]"
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

                  <button
                    onClick={() => router.push(session.completedAt ? `/results/${session.id}` : `/candidate/interview/${session.id}`)}
                    className="flex w-full items-center justify-center gap-2 px-3 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-medium transition-colors"
                  >
                    {session.completedAt ? <CheckCircle size={16} /> : <ArrowRight size={16} />}
                    {session.completedAt ? 'View Results' : 'Start Interview'}
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CandidateDashboard;
