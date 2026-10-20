// Shared interviewer authentication helper. Resolves the session cookie to the
// full interviewer User row (or null), replacing the getInterviewerId body that
// was duplicated across the interviewer routes. Enforcement code needs the whole
// row (subscriptionPlan / planExpiresAt), so this returns the row, not just the id.
import { cookies, headers } from 'next/headers';
import supabaseDb from '@/lib/supabaseDb';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';

const db = supabaseDb as any;

export interface InterviewerUserRow {
    id: string;
    name: string | null;
    email: string | null;
    role: string;
    subscriptionPlan?: string | null;
    planExpiresAt?: Date | string | null;
    [key: string]: any;
}

export async function getInterviewerUser(): Promise<InterviewerUserRow | null> {
    try {
        const cookieStore = await cookies();
        let token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

        if (!token) {
            try {
                const headerStore = await headers();
                const authHeader = headerStore.get('authorization');
                if (authHeader && authHeader.startsWith('Bearer ')) {
                    token = authHeader.slice(7).trim();
                }
            } catch {
                // headers() might not be available in all contexts
            }
        }

        if (!token) return null;
        const session = await verifySessionToken(token);
        if (!session.valid || !session.researcherId) return null;
        const user = await db.user.findUnique({ where: { id: session.researcherId } });
        if (!user || (user.role !== 'interviewer' && user.role !== 'admin')) return null;
        return user as InterviewerUserRow;
    } catch {
        return null;
    }
}

export async function getInterviewerId(): Promise<string | null> {
    const user = await getInterviewerUser();
    return user?.id ?? null;
}
