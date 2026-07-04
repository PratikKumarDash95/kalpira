import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import supabaseDb from '@/lib/supabaseDb';

export const dynamic = 'force-dynamic';

// GET /api/admin/interviewers — list interviewer accounts with scaling stats:
// how many studies each created and how many interviews those studies drove
// (total vs still-active), so admins can gauge server load per interviewer.
export async function GET() {
    const denied = await requireAdmin();
    if (denied) return denied;

    try {
        const [interviewers, studies, sessions] = await Promise.all([
            supabaseDb.user.findMany({
                where: { role: 'interviewer' },
                orderBy: { createdAt: 'desc' },
                select: { id: true, name: true, email: true, oauthProvider: true, createdAt: true },
            }),
            supabaseDb.study.findMany({ select: { id: true, userId: true, isLocked: true } }),
            supabaseDb.interviewSession.findMany({ select: { id: true, studyId: true, completedAt: true } }),
        ]);

        const result = interviewers.map((iv: { id: string; name: string | null; email: string | null; oauthProvider: string | null; createdAt: Date }) => {
            const ownStudies = studies.filter((s: { userId: string | null }) => s.userId === iv.id);
            const studyIds = new Set(ownStudies.map((s: { id: string }) => s.id));
            const ivSessions = sessions.filter((sess: { studyId: string | null }) => sess.studyId && studyIds.has(sess.studyId));
            const activeInterviews = ivSessions.filter((sess: { completedAt: Date | null }) => !sess.completedAt).length;
            return {
                id: iv.id,
                name: iv.name,
                email: iv.email,
                oauthProvider: iv.oauthProvider,
                createdAt: iv.createdAt,
                studiesCreated: ownStudies.length,
                activeStudies: ownStudies.filter((s: { isLocked: boolean }) => !s.isLocked).length,
                totalInterviews: ivSessions.length,
                activeInterviews,
            };
        });

        return NextResponse.json({ interviewers: result });
    } catch (error) {
        console.error('Admin interviewers error:', error);
        return NextResponse.json({ error: 'Failed to fetch interviewers' }, { status: 500 });
    }
}
