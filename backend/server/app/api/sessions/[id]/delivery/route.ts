// ============================================
// GET /api/sessions/[id]/delivery
// Feature 2 — Multimodal Delivery Analysis
//
// Everything measured about how a session's answers were spoken and shown: the
// per-answer metrics with their healthy bands, the adjustments those metrics made
// to the score, what could not be measured and why, and the session roll-up.
//
// Read-only, and reads the STORED analysis rather than re-deriving it. What the
// candidate is shown therefore has to be what the score was actually built from —
// including the case where a metric was absent.
//
// WHY THE REGISTRY IS IN THIS RESPONSE
// The stored metric rows carry the verdict (`inBand`, `position`, `impact`) that
// was reached when the answer was analysed, but not the band that verdict was
// reached against. A UI drawing a value's position needs the band, and fetching it
// from a second endpoint would let the two disagree if the registry changed in
// between. They travel together so a screen cannot render the numbers against the
// wrong scale.
//
// Authorisation: the session's candidate, an admin, or the interviewer who owns the
// study the session belongs to. An interviewer sees only sessions for their own
// studies, which is the same rule the participant link enforces elsewhere.
// ============================================

import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { getAuthUser } from '@/lib/accessControl';
import { sessionDelivery } from '@/lib/delivery/deliveryService';
import { METRIC_REGISTRY } from '@/lib/delivery/contract';
import { LEXICAL_DISCLOSURE } from '@/lib/delivery/lexicalMath';
import {
    ENVELOPE_SAMPLE_INTERVAL_MS,
    MIN_SPEECH_FOR_RATE_MS,
    PAUSE_THRESHOLD_MS,
} from '@/lib/delivery/audioMath';
import { MAX_ADJUSTMENT, MIN_SCORABLE_METRICS } from '@/lib/delivery/fusion';

export const dynamic = 'force-dynamic';

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: sessionId } = await params;

        if (sessionId.startsWith('guest-') || sessionId.startsWith('fallback-')) {
            return NextResponse.json({ error: 'Guest sessions are not analysed' }, { status: 400 });
        }

        const authUser = await getAuthUser();
        if (!authUser) {
            return NextResponse.json({ error: 'Login required' }, { status: 401 });
        }

        const session = await supabaseDb.interviewSession.findUnique({
            where: { id: sessionId },
            include: { study: true },
        });
        if (!session) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        }

        const isCandidate = session.userId === authUser.id;
        const isStudyOwner = Boolean(session.study) && session.study?.userId === authUser.id;
        const isAdmin = authUser.role === 'admin';
        if (!isCandidate && !isStudyOwner && !isAdmin) {
            return NextResponse.json(
                { error: 'You do not have access to this session' },
                { status: 403 }
            );
        }

        const view = await sessionDelivery(sessionId);

        return NextResponse.json({
            success: true,
            ...view,
            // The bands and wording the stored verdicts were reached against.
            registry: METRIC_REGISTRY,
            disclosure: LEXICAL_DISCLOSURE,
            // The measurement settings a reader needs to interpret the numbers —
            // "a pause is 700ms or more" is not something to leave implicit.
            settings: {
                pauseThresholdMs: PAUSE_THRESHOLD_MS,
                minSpeechForRateMs: MIN_SPEECH_FOR_RATE_MS,
                envelopeSampleIntervalMs: ENVELOPE_SAMPLE_INTERVAL_MS,
                maxAdjustment: MAX_ADJUSTMENT,
                minScorableMetrics: MIN_SCORABLE_METRICS,
            },
        });
    } catch (error) {
        console.error('[sessions/delivery] Failed to load delivery evidence:', error);
        return NextResponse.json({ error: 'Could not load delivery evidence' }, { status: 500 });
    }
}
