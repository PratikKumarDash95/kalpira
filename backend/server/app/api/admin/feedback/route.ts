import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import supabaseDb from '@/lib/supabaseDb';

export const dynamic = 'force-dynamic';

// GET /api/admin/feedback — candidate → interviewer feedback across the platform,
// each row enriched with the interviewer it was left for.
export async function GET() {
    const denied = await requireAdmin();
    if (denied) return denied;

    try {
        const [feedback, users] = await Promise.all([
            supabaseDb.interviewFeedback.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
            supabaseDb.user.findMany({ select: { id: true, name: true, email: true } }),
        ]);

        const userById = new Map(
            (users as { id: string; name: string | null; email: string | null }[]).map((u) => [u.id, u]),
        );

        const items = feedback.map((f: { id: string; sessionId: string | null; studyId: string | null; interviewerId: string | null; candidateName: string | null; candidateEmail: string | null; rating: number; comment: string | null; createdAt: Date }) => {
            const interviewer = f.interviewerId ? userById.get(f.interviewerId) : null;
            return {
                id: f.id,
                sessionId: f.sessionId,
                studyId: f.studyId,
                rating: f.rating,
                comment: f.comment,
                createdAt: f.createdAt,
                candidateName: f.candidateName,
                candidateEmail: f.candidateEmail,
                interviewer: interviewer
                    ? { id: interviewer.id, name: interviewer.name, email: interviewer.email }
                    : null,
            };
        });

        const rated = items.filter((i: { rating: number }) => i.rating > 0);
        const averageRating = rated.length
            ? rated.reduce((sum: number, i: { rating: number }) => sum + i.rating, 0) / rated.length
            : 0;

        return NextResponse.json({ feedback: items, count: items.length, averageRating });
    } catch (error) {
        console.error('Admin feedback error:', error);
        return NextResponse.json({ error: 'Failed to fetch feedback' }, { status: 500 });
    }
}
