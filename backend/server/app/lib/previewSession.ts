// Helpers for identifying an interviewer's own self-preview / self-practice
// InterviewSession rows so they can be excluded from real candidate lists and counts.
//
// A self-preview session is created when the study owner runs their own interview
// via the practice flow (see PracticeSetup on the frontend). It is tagged with the
// sentinel email below and/or the default `practice` mode. These are the interviewer
// testing their own interview — not a real candidate result — so they must not be
// counted toward candidate totals or shown in the candidate list.

export const SELF_PREVIEW_EMAIL = 'practice@self';

type SessionLike = {
  candidateEmail?: string | null;
  mode?: string | null;
};

export function isSelfPreviewSession(session: SessionLike): boolean {
  const email = (session.candidateEmail || '').trim().toLowerCase();
  if (email === SELF_PREVIEW_EMAIL) return true;
  if ((session.mode || '') === 'practice') return true;
  return false;
}

export function excludeSelfPreviewSessions<T extends SessionLike>(sessions: T[]): T[] {
  return sessions.filter((session) => !isSelfPreviewSession(session));
}
