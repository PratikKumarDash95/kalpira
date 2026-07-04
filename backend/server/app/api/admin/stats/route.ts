import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import supabaseDb from '@/lib/supabaseDb';

export const dynamic = 'force-dynamic';

export async function GET() {
    const denied = await requireAdmin();
    if (denied) return denied;

    try {
        const [users, studies, sessions] = await Promise.all([
            supabaseDb.user.findMany({ select: { id: true, role: true, name: true, email: true, createdAt: true } }),
            supabaseDb.study.findMany({ select: { id: true, isLocked: true } }),
            supabaseDb.interviewSession.findMany({ select: { id: true, completedAt: true } }),
        ]);

        const roleOf = (r: string | null | undefined) =>
            r === 'admin' || r === 'interviewer' ? r : 'candidate';

        const totalCandidates = users.filter(u => roleOf(u.role) === 'candidate').length;
        const totalInterviewers = users.filter(u => roleOf(u.role) === 'interviewer').length;
        const totalAdmins = users.filter(u => roleOf(u.role) === 'admin').length;

        const activeStudies = studies.filter(s => !s.isLocked).length;
        const activeInterviews = sessions.filter(s => !s.completedAt).length;

        const recentUsers = [...users]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 5)
            .map(u => ({ id: u.id, name: u.name, email: u.email, role: roleOf(u.role), createdAt: u.createdAt }));

        return NextResponse.json({
            totalUsers: users.length,
            totalCandidates,
            totalInterviewers,
            totalAdmins,
            totalStudies: studies.length,
            activeStudies,
            totalSessions: sessions.length,
            activeInterviews,
            recentUsers,
        });
    } catch (error) {
        console.error('Admin stats error:', error);
        return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
    }
}
