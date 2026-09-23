// POST /api/sessions/[id]/save-response — Save a Q&A pair with scores to DB
import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { getParticipantRequestContext } from '@/lib/researcherContext';
import { getAuthUser } from '@/lib/accessControl';
import {
    analyzeResponseDelivery,
    type DeliveryCapturePayload,
} from '@/lib/delivery/deliveryService';

export const dynamic = 'force-dynamic';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: sessionId } = await params;

        // Skip DB save for guest/fallback sessions
        if (sessionId.startsWith('guest-') || sessionId.startsWith('fallback-')) {
            return NextResponse.json({ success: true, skipped: true });
        }

        const body = await request.json();
        const {
            questionText,
            category = 'general',
            difficulty = 'medium',
            answerText,
            technicalScore = 0,
            communicationScore = 0,
            confidenceScore = 0,
            logicScore = 0,
            depthScore = 0,
            feedback = '',
            idealAnswer = '',
            improvementTip = '',
            // Feature 2 — the browser's raw capture for this answer, when it had
            // one. Optional by design: a candidate without a microphone, or one
            // who declined camera access, still gets a scored interview.
            delivery = null,
        } = body as {
            questionText: string;
            category?: string;
            difficulty?: string;
            answerText: string;
            technicalScore?: number;
            communicationScore?: number;
            confidenceScore?: number;
            logicScore?: number;
            depthScore?: number;
            feedback?: string;
            idealAnswer?: string;
            improvementTip?: string;
            delivery?: DeliveryCapturePayload | null;
        };

        if (!questionText || !answerText) {
            return NextResponse.json({ error: 'questionText and answerText required' }, { status: 400 });
        }

        // Verify session exists
        const session = await supabaseDb.interviewSession.findUnique({
            where: { id: sessionId },
            include: { study: true },
        });
        if (!session) {
            return NextResponse.json({ success: true, skipped: true }); // Graceful skip
        }

        // ── Who may write to this session ────────────────────────────────────
        // Every persisted session has an owner. `sessions/start` refuses to persist
        // one without an authenticated user or a valid participant link, handing an
        // anonymous caller a `guest-…` id instead — and those are short-circuited
        // above, so nothing reaching here is ownerless.
        //
        // A session attached to a study can also be written through that study's
        // participant link, which is how most interviews are actually sat. A
        // self-practice session has no study, so there is no study to scope a link
        // to and no owner to compare it against: ownership is the only authority
        // that exists, and it is the only one accepted.
        //
        // This used to be wrapped in `if (session.studyId)`, which left a session
        // with no study taking the unguarded path — an unauthenticated write into
        // any practice session whose id you knew. The check is now exhaustive over
        // both shapes rather than running for one of them.
        const authUser = await getAuthUser();
        const isSessionOwner = Boolean(authUser?.id && session.userId && session.userId === authUser.id);

        if (session.studyId) {
            if (isSessionOwner && authUser?.role === 'candidate') {
                // Authenticated candidate owns this assigned session.
            } else {
                const participantAuth = await getParticipantRequestContext(request);
                if (
                    !participantAuth.valid ||
                    !participantAuth.context ||
                    participantAuth.studyId !== session.studyId ||
                    participantAuth.context.userId !== session.study?.userId
                ) {
                    return NextResponse.json(
                        { error: 'Valid participant link required for this session' },
                        { status: 401 }
                    );
                }
            }
        } else if (!isSessionOwner) {
            return NextResponse.json(
                { error: 'This session belongs to another user' },
                { status: 401 }
            );
        }

        // Create question record
        const question = await supabaseDb.question.create({
            data: {
                sessionId,
                text: questionText,
                difficulty,
                category,
            },
        });

        // Create response record with scores
        const response = await supabaseDb.response.create({
            data: {
                sessionId,
                questionId: question.id,
                answerText,
                technicalScore,
                communicationScore,
                confidenceScore,
                logicScore,
                depthScore,
                feedback,
                idealAnswer,
                improvementTip,
            },
        });

        // ── Feature 2: delivery analysis ─────────────────────────────────────
        // Runs after the answer is safely stored, and inside its own try/catch.
        // The order matters: losing the analysis costs a session its delivery
        // evidence, but losing the answer costs the candidate their interview. The
        // outer catch would report `skipped: true` for a response that was in fact
        // saved, so a delivery failure must never reach it.
        let deliveryAnalyzed = false;
        let deliveryNote: string | null = null;
        if (delivery && typeof delivery === 'object') {
            try {
                const outcome = await analyzeResponseDelivery({
                    responseId: response.id,
                    sessionId,
                    userId: session.userId ?? null,
                    payload: delivery,
                });
                deliveryAnalyzed = outcome?.status === 'succeeded';
                if (outcome && !deliveryAnalyzed) {
                    deliveryNote = outcome.error ?? outcome.skippedReason ?? 'Delivery was not analysed.';
                }
            } catch (deliveryError) {
                console.error('[sessions/save-response] Delivery analysis failed (answer still saved):', deliveryError);
                deliveryNote = 'Delivery analysis could not be completed.';
            }
        }

        return NextResponse.json({
            success: true,
            questionId: question.id,
            responseId: response.id,
            deliveryAnalyzed,
            deliveryNote,
        });
    } catch (error) {
        console.error('Save response error:', error);
        return NextResponse.json({ success: true, skipped: true }); // Never break the interview
    }
}
