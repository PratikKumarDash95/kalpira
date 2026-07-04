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
