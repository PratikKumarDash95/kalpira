// POST /api/candidate/sessions/[id]/feedback
// A logged-in candidate rates the interviewer/experience for an assigned
// interview session. Interviewer is resolved from the session's study owner.

import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/accessControl';
import supabaseDb from '@/lib/supabaseDb';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: { id: string } }) {
    const authUser = await getAuthUser();
    if (!authUser?.id || authUser.role !== 'candidate') {
        return NextResponse.json({ error: 'Candidate login required' }, { status: 401 });
    }

    const user = await supabaseDb.user.findUnique({
        where: { id: authUser.id },
        select: { id: true, name: true, email: true },
    });
    if (!user?.email) {
        return NextResponse.json({ error: 'Candidate email not found' }, { status: 404 });
    }

    let body: { rating?: unknown; comment?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return NextResponse.json({ error: 'Rating must be an integer from 1 to 5' }, { status: 400 });
    }
    const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 2000) : '';

    const session = await supabaseDb.interviewSession.findUnique({
        where: { id: params.id },
        include: { study: true },
    });
    if (!session) {
        return NextResponse.json({ error: 'Interview session not found' }, { status: 404 });
    }

    // Only the candidate the interview belongs to may leave feedback.
    const ownsByUser = session.userId === user.id;
    const ownsByEmail = session.candidateEmail?.toLowerCase() === user.email.toLowerCase();
    if (!ownsByUser && !ownsByEmail) {
        return NextResponse.json({ error: 'This interview is not assigned to you' }, { status: 403 });
    }

    const interviewerId = session.study?.userId ?? null;

    try {
        const existing = await supabaseDb.interviewFeedback.findFirst({
            where: { sessionId: session.id },
            select: { id: true },
        });

        if (existing) {
            await supabaseDb.interviewFeedback.update({
                where: { id: existing.id },
                data: { rating, comment: comment || null },
            });
        } else {
            await supabaseDb.interviewFeedback.create({
                data: {
                    sessionId: session.id,
                    studyId: session.studyId ?? null,
                    interviewerId,
                    candidateName: session.candidateName || user.name || 'Candidate',
                    candidateEmail: user.email.toLowerCase(),
                    rating,
                    comment: comment || null,
                    createdAt: new Date(),
                },
            });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Candidate feedback error:', error);
        return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 });
    }
}
