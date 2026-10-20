import { apiFetch } from './apiClient';
import { revalidateQuery } from './queryCache';
import { PlanKey } from './plans';

export interface StudySummary {
  id: string;
  config: { name: string; researchQuestion: string; aiBehavior: string };
  candidateCount: number;
  completedCount: number;
  scoredCount?: number;
  averageScore: number | null;
  createdAt: string;
}

export interface InterviewerInfo {
  id: string;
  name: string;
  email: string;
  plan?: PlanKey;
  planExpiresAt?: string | null;
  planActive?: boolean;
}

export interface InterviewerDashboardData {
  interviewer: InterviewerInfo | null;
  studies: StudySummary[];
  error?: string | null;
}

export const INTERVIEWER_DASHBOARD_QUERY_KEY = '/api/interviewer/dashboard-data';

export async function fetchInterviewerDashboard(): Promise<InterviewerDashboardData> {
  try {
    const [meRes, studiesRes] = await Promise.all([
      apiFetch('/api/interviewer/me'),
      apiFetch('/api/interviewer/studies'),
    ]);

    if (!meRes.ok) {
      return { interviewer: null, studies: [], error: 'Not authenticated as interviewer' };
    }

    const meData = await meRes.json();
    const interviewer = meData.user || null;

    let studies: StudySummary[] = [];
    if (studiesRes.ok) {
      const studiesData = await studiesRes.json();
      studies = studiesData.studies || [];
    }

    return { interviewer, studies };
  } catch {
    return { interviewer: null, studies: [], error: 'Failed to load interviewer dashboard' };
  }
}

export function revalidateInterviewerDashboard(): void {
  void revalidateQuery(INTERVIEWER_DASHBOARD_QUERY_KEY, fetchInterviewerDashboard);
}
