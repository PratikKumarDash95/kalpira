// ============================================
// GET /api/measurement/target
// Feature 1 — Competency Measurement Engine
//
// The integration point with the interview flow. Given a session (or a user),
// returns what to ask next: the difficulty to aim for, the competency, and whether
// the measurement is already precise enough to stop.
//
// WHY A TARGET AND NOT A QUESTION
// This platform has no bank of reusable items — questions are generated per
// session (see app/api/sessions/[id]/save-response/route.ts). So "adaptive item
// selection" here means steering generation: the engine says "ask something at
// difficulty +0.8 on system-design", and the prompt builder asks for exactly that.
//
// That still replaces the thing that was wrong before. The old engine took the
// LLM's self-reported increase/decrease/maintain and moved one notch on an
// easy/medium/hard ladder. This returns a continuous, measured target derived from
// the candidate's estimated ability — the LLM decides *what* to ask, the
// measurement engine decides *how hard*, and that division is the whole point.
//
// Query params (one of sessionId or userId is required):
//   sessionId      resolve the candidate from the session (owner or admin only)
//   userId         explicit candidate (self or admin only)
//   competencyId   restrict the target to one competency
//   itemsAnswered  how many items have been asked so far, for the stop rule
//   itemsAvailable how many items remain, for the stop rule
// ============================================

import { NextResponse } from 'next/server';
import { assertSessionOwner, getAuthUser } from '@/lib/accessControl';
import supabaseDb from '@/lib/supabaseDb';
import { getAdaptiveTarget } from '@/lib/measurement/abilityService';
import { difficultyLabelFor } from '@/lib/measurement/selectionMath';

export const dynamic = 'force-dynamic';

function readCount(value: string | null): number | undefined {
    if (value === null) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

export async function GET(request: Request) {
    const authUser = await getAuthUser();
    if (!authUser) {
        return NextResponse.json({ error: 'Login required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const requestedUserId = searchParams.get('userId');

    if (!sessionId && !requestedUserId) {
        return NextResponse.json(
            { error: 'Either sessionId or userId is required' },
            { status: 400 }
        );
    }

    let userId = requestedUserId;
    let competencyId = searchParams.get('competencyId');

    try {
        if (sessionId) {
            const session = await supabaseDb.interviewSession.findUnique({
                where: { id: sessionId },
                select: { id: true, userId: true, studyId: true },
            });

            if (!session) {
                return NextResponse.json({ error: 'Session not found' }, { status: 404 });
            }

            // The candidate sitting the interview, the interviewer who owns the
            // study, or an admin — nobody else.
            const isParticipant = authUser.id === session.userId;
            const isAdmin = authUser.role === 'admin';
            const isStudyOwner = await assertSessionOwner(sessionId, authUser);

            if (!isParticipant && !isAdmin && !isStudyOwner) {
                return NextResponse.json(
                    { error: 'You do not have access to this session' },
                    { status: 403 }
                );
            }

            userId = session.userId;
        }

        if (!userId) {
            return NextResponse.json(
                { error: 'Could not resolve a candidate for this session' },
                { status: 400 }
            );
        }

        if (authUser.id !== userId && authUser.role !== 'admin') {
            return NextResponse.json(
                { error: 'You can only request a target for yourself' },
                { status: 403 }
            );
        }

        // A competencyId supplied on a session request is honoured only if the
        // caller passed one explicitly; otherwise the engine targets whichever
        // competency is least certain, where the next question buys most.
        if (!competencyId) competencyId = null;

        const target = await getAdaptiveTarget({
            userId,
            competencyId,
            itemsAnswered: readCount(searchParams.get('itemsAnswered')),
            itemsAvailable: readCount(searchParams.get('itemsAvailable')),
        });

        return NextResponse.json({
            sessionId: sessionId ?? null,
            target,
            // The label is provided for the older prompt builders and any UI that
            // still speaks in three tiers. New code should use targetDifficulty.
            legacyDifficultyLabel: difficultyLabelFor(target.targetDifficulty),
        });
    } catch (error) {
        console.error('[measurement/target] failed:', error);
        return NextResponse.json({ error: 'Failed to compute adaptive target' }, { status: 500 });
    }
}
