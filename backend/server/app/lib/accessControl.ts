import { cookies } from 'next/headers';
import supabaseDb from './supabaseDb';
import { SESSION_COOKIE_NAME, verifySessionToken } from './auth';

export type Role = 'admin' | 'interviewer' | 'candidate';

export interface AuthUser {
  id: string | null;
  role: Role;
  isLegacyAdmin: boolean;
  /**
   * The account's own address, when it has one. Callers that accept a name or an
   * email in a request body need something to compare it against; the body is a
   * claim, this is the proof.
   */
  email?: string | null;
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await verifySessionToken(token);
  if (!session.valid) return null;

  if (!session.researcherId) {
    return { id: null, role: 'admin', isLegacyAdmin: true };
  }

  const user = await supabaseDb.user.findUnique({
    where: { id: session.researcherId },
    select: { id: true, role: true, email: true },
  });

  if (!user) return null;

  const role = user.role === 'admin' || user.role === 'interviewer' ? user.role : 'candidate';
  return { id: user.id, role, isLegacyAdmin: false, email: user.email ?? null };
}

export async function requireRole(...roles: Role[]): Promise<AuthUser | null> {
  const user = await getAuthUser();
  if (!user) return null;
  return roles.includes(user.role) ? user : null;
}

export function ownerWhere(user: AuthUser) {
  if (user.role === 'admin') return {};
  if (!user.id) return { id: '__deny__' };
  return { userId: user.id };
}

export async function assertStudyOwner(studyId: string, user: AuthUser): Promise<boolean> {
  if (user.role === 'admin') return true;
  if (!user.id) return false;

  const study = await supabaseDb.study.findFirst({
    where: { id: studyId, userId: user.id },
    select: { id: true },
  });

  return Boolean(study);
}

export async function assertSessionOwner(sessionId: string, user: AuthUser): Promise<boolean> {
  if (user.role === 'admin') return true;
  if (!user.id) return false;

  const session = await supabaseDb.interviewSession.findFirst({
    where: {
      id: sessionId,
      OR: [
        { userId: user.id },
        { study: { userId: user.id } },
      ],
    },
    select: { id: true },
  });

  return Boolean(session);
}
