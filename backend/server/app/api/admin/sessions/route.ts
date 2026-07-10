import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import supabaseDb from '@/lib/supabaseDb';

export const dynamic = 'force-dynamic';

export async function GET() {
    const denied = await requireAdmin();
    if (denied) return denied;

    try {
        const sessions = await supabaseDb.interviewSession.findMany({
            orderBy: { startedAt: 'desc' },
            take: 100,
            select: {
                id: true,
                startedAt: true,
                completedAt: true,
                averageScore: true,
                role: true,
                difficulty: true,
                mode: true,
                candidateName: true,
                candidateEmail: true,
                user: {
                    select: { name: true, email: true },
                },
            },
        });

        return NextResponse.json({ sessions });
    } catch (error) {
        console.error('Admin sessions error:', error);
        return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 });
    }
}

// DELETE /api/admin/sessions — remove a single InterviewSession by id.
// Related Question / Response / ScoreBreakdown rows are removed by the
// schema's onDelete: Cascade, so this fully clears the assigned interview.
export async function DELETE(request: Request) {
    const denied = await requireAdmin();
    if (denied) return denied;

    try {
        const { sessionId } = await request.json().catch(() => ({}));
        if (!sessionId || typeof sessionId !== 'string') {
            return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
        }

        const existing = await supabaseDb.interviewSession.findUnique({
            where: { id: sessionId },
            select: { id: true },
        });
        if (!existing) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        }

        await supabaseDb.interviewSession.delete({ where: { id: sessionId } });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Admin delete session error:', error);
        return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 });
    }
}
