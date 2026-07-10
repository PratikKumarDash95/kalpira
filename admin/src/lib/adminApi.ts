import { apiFetch } from '@/lib/apiClient';

// ─── Shared types ──────────────────────────────────────────────────────────
export type Role = 'candidate' | 'interviewer' | 'admin';

export interface Stats {
    totalUsers: number;
    totalCandidates: number;
    totalInterviewers: number;
    totalAdmins: number;
    totalStudies: number;
    activeStudies: number;
    totalSessions: number;
    activeInterviews: number;
    recentUsers: { id: string; name: string | null; email: string | null; role: Role; createdAt: string }[];
}

export interface AdminUser {
    id: string;
    name: string | null;
    email: string | null;
    role: Role;
    oauthProvider: string | null;
    onboardingComplete: boolean;
    createdAt: string;
    _count: { interviewSessions: number; studies: number };
}

export interface Interviewer {
    id: string;
    name: string | null;
    email: string | null;
    oauthProvider: string | null;
    createdAt: string;
    studiesCreated: number;
    activeStudies: number;
    totalInterviews: number;
    activeInterviews: number;
}

export interface AdminStudy {
    id: string;
    name: string;
    roleTitle: string;
    interviewCount: number;
    totalSessions: number;
    activeSessions: number;
    isLocked: boolean;
    createdAt: string;
    owner: { id: string; name: string | null; email: string | null; role: Role } | null;
}

export interface AdminSession {
    id: string;
    startedAt: string;
    completedAt: string | null;
    averageScore: number;
    role: string;
    difficulty?: string;
    mode?: string;
    candidateName: string | null;
    candidateEmail: string | null;
    user: { name: string | null; email: string | null } | null;
}

export interface FeedbackItem {
    id: string;
    sessionId: string | null;
    studyId: string | null;
    rating: number;
    comment: string | null;
    createdAt: string;
    candidateName: string | null;
    candidateEmail: string | null;
    interviewer: { id: string; name: string | null; email: string | null } | null;
}

export interface UserDetail {
    user: AdminUser & { emailVerifiedAt: string | null; avatarUrl: string | null };
    sessions: { id: string; role: string; startedAt: string; completedAt: string | null; averageScore: number; mode: string }[];
    studies: { id: string; name: string; interviewCount: number; isLocked: boolean; createdAt: string }[];
    badges: { id: string; badgeName: string; awardedAt: string }[];
    readinessScore: number | null;
}

// ─── API helpers ────────────────────────────────────────────────────────────
// Every call throws with a readable message on failure so the UI can surface it
// instead of silently rendering zeros.
async function json<T>(res: Response): Promise<T> {
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
    }
    return res.json() as Promise<T>;
}

export const AdminApi = {
    stats: () => apiFetch('/api/admin/stats').then(json<Stats>),

    users: (role?: Role) =>
        apiFetch(`/api/admin/users${role ? `?role=${role}` : ''}`).then(json<{ users: AdminUser[] }>),

    userDetail: (id: string) => apiFetch(`/api/admin/users/${id}`).then(json<UserDetail>),

    createUser: (body: { name: string; email: string; password: string; role: Role }) =>
        apiFetch('/api/admin/users', { method: 'POST', body: JSON.stringify(body) }).then(json<{ user: AdminUser }>),

    updateUser: (body: { userId: string; name?: string; email?: string; role?: Role }) =>
        apiFetch('/api/admin/users', { method: 'PATCH', body: JSON.stringify(body) }).then(json<{ user: AdminUser }>),

    deleteUser: (userId: string) =>
        apiFetch('/api/admin/users', { method: 'DELETE', body: JSON.stringify({ userId }) }).then(json<{ success: boolean }>),

    interviewers: () => apiFetch('/api/admin/interviewers').then(json<{ interviewers: Interviewer[] }>),

    studies: () => apiFetch('/api/admin/studies').then(json<{ studies: AdminStudy[] }>),

    deleteStudy: (studyId: string) =>
        apiFetch('/api/admin/studies', { method: 'DELETE', body: JSON.stringify({ studyId }) }).then(json<{ success: boolean }>),

    sessions: () => apiFetch('/api/admin/sessions').then(json<{ sessions: AdminSession[] }>),

    deleteSession: (sessionId: string) =>
        apiFetch('/api/admin/sessions', { method: 'DELETE', body: JSON.stringify({ sessionId }) }).then(json<{ success: boolean }>),

    feedback: () => apiFetch('/api/admin/feedback').then(json<{ feedback: FeedbackItem[]; count: number; averageRating: number }>),
};
