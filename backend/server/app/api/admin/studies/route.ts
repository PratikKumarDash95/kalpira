import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import supabaseDb from '@/lib/supabaseDb';

export const dynamic = 'force-dynamic';

// GET /api/admin/studies — every study across the platform with its owner and
// session counts. Powers the Studies page and the "studies created" scaling view.
export async function GET() {
    const denied = await requireAdmin();
    if (denied) return denied;

    try {
        const [studies, users, sessions] = await Promise.all([
            supabaseDb.study.findMany({
                orderBy: { createdAt: 'desc' },
                select: { id: true, userId: true, configJSON: true, interviewCount: true, isLocked: true, createdAt: true },
            }),
            supabaseDb.user.findMany({ select: { id: true, name: true, email: true, role: true } }),
            supabaseDb.interviewSession.findMany({ select: { id: true, studyId: true, completedAt: true } }),
        ]);

        const userById = new Map(
            (users as { id: string; name: string | null; email: string | null; role: string | null }[]).map((u) => [u.id, u]),
        );

        const result = studies.map((s: { id: string; userId: string | null; configJSON: string; interviewCount: number; isLocked: boolean; createdAt: Date }) => {
            let name = 'Untitled study';
            let roleTitle = '';
            try {
                const cfg = JSON.parse(s.configJSON);
                name = cfg?.name || name;
                roleTitle = cfg?.role || cfg?.jobRole || '';
            } catch { /* keep defaults */ }

            const studySessions = sessions.filter((sess: { studyId: string | null }) => sess.studyId === s.id);
            const owner = s.userId ? userById.get(s.userId) : null;

            return {
                id: s.id,
                name,
                roleTitle,
                interviewCount: s.interviewCount,
                totalSessions: studySessions.length,
                activeSessions: studySessions.filter((sess: { completedAt: Date | null }) => !sess.completedAt).length,
                isLocked: s.isLocked,
                createdAt: s.createdAt,
                owner: owner ? { id: owner.id, name: owner.name, email: owner.email, role: owner.role || 'candidate' } : null,
            };
        });

        return NextResponse.json({ studies: result });
    } catch (error) {
        console.error('Admin studies error:', error);
        return NextResponse.json({ error: 'Failed to fetch studies' }, { status: 500 });
    }
}

// DELETE /api/admin/studies — remove a study (cascades stored interviews;
// sessions keep their row with studyId set null per the schema FK rules).
export async function DELETE(request: Request) {
    const denied = await requireAdmin();
    if (denied) return denied;

    try {
        const { studyId } = await request.json();
        if (!studyId) {
            return NextResponse.json({ error: 'studyId is required' }, { status: 400 });
        }
        await supabaseDb.study.delete({ where: { id: studyId } });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Admin delete study error:', error);
        return NextResponse.json({ error: 'Failed to delete study' }, { status: 500 });
    }
}
