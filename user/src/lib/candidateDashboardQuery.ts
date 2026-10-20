import { apiFetch } from './apiClient';
import { revalidateQuery } from './queryCache';

export interface CandidateInfo {
  id: string;
  name: string | null;
  email: string;
}

export interface CandidateSession {
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

export interface CandidateDashboardData {
  candidate: CandidateInfo | null;
  sessions: CandidateSession[];
  error?: string | null;
}

export const CANDIDATE_DASHBOARD_QUERY_KEY = '/api/candidate/dashboard-data';

export async function fetchCandidateDashboard(): Promise<CandidateDashboardData> {
  try {
    const [meRes, sessionsRes] = await Promise.all([
      apiFetch('/api/candidate/me'),
      apiFetch('/api/candidate/sessions'),
    ]);

    if (!meRes.ok) {
      return { candidate: null, sessions: [], error: 'Not authorized as candidate' };
    }

    const meData = await meRes.json();
    const candidate: CandidateInfo = meData.user;

    if (!sessionsRes.ok) {
      const data = await sessionsRes.json().catch(() => ({}));
      return { candidate, sessions: [], error: data.error || 'Failed to load assigned interviews.' };
    }

    const sessionsData = await sessionsRes.json();
    const rawSessions: CandidateSession[] = sessionsData.sessions || [];
    const userEmail = (candidate?.email || '').trim().toLowerCase();

    // Practice interviews belong to the user's personal practice history and must never
    // be displayed as interviewer-assigned interviews.
    const assignedOnly = rawSessions.filter((s) => {
      const title = (s.title || '').trim().toLowerCase();
      const topic = (s.topic || '').trim().toLowerCase();
      const desc = (s.description || '').trim().toLowerCase();
      const candEmail = (s.candidateEmail || '').trim().toLowerCase();
      const intEmail = (s.interviewerEmail || '').trim().toLowerCase();

      if (candEmail === 'practice@self') return false;
      if (title.startsWith('practice:')) return false;
      if (topic.includes('practice interview')) return false;
      if (desc.includes('self-guided practice')) return false;
      if (userEmail && intEmail === userEmail) return false;
      return true;
    });

    return { candidate, sessions: assignedOnly };
  } catch {
    return { candidate: null, sessions: [], error: 'Failed to load candidate dashboard.' };
  }
}

export function revalidateCandidateDashboard(): void {
  void revalidateQuery(CANDIDATE_DASHBOARD_QUERY_KEY, fetchCandidateDashboard);
}
