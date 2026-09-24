// POST /api/sessions/[id]/save-response — Save a Q&A pair with scores to DB
import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { getParticipantRequestContext } from '@/lib/researcherContext';
import { getAuthUser } from '@/lib/accessControl';
import {
    analyzeResponseDelivery,
    type DeliveryCapturePayload,
} from '@/lib/delivery/deliveryService';
import {
    appendLinkedDecision,
    findScoredDecision,
    readScoreSet,
    scoreSourceFor,
    verifyScores,
} from '@/lib/fairness/decisionLog';

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
            // ── Feature 4: the scores are NOT read from the body any more ─────────
            //
            // They used to be, and upstream they came from a browser-side heuristic that
            // scored an answer by counting its words and matching a few regexes. So the
            // numbers in this table described a word count, not a model, and nothing could
            // tell the difference — the interview's own "AI evaluation" was the shape of
            // the text box.
            //
            // What arrives instead is the id of the model decision recorded by
            // `/api/interview`, plus optionally the scores the client displayed. The
            // LOGGED scores are what gets persisted; the claimed ones are only ever
            // compared against them, so a client that inflated a number is caught rather
            // than believed. The old top-level score fields are deliberately not
            // destructured: leaving them in the body has no effect, and a field nobody
            // reads cannot become a field somebody trusts again by accident.
            decisionId = null,
            claimedScores = null,
            idealAnswer = '',
            // Feature 2 — the browser's raw capture for this answer, when it had
            // one. Optional by design: a candidate without a microphone, or one
            // who declined camera access, still gets a scored interview.
            delivery = null,
        } = body as {
            questionText: string;
            category?: string;
            difficulty?: string;
            answerText: string;
            decisionId?: string | null;
            claimedScores?: Record<string, unknown> | null;
            idealAnswer?: string;
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

        // ── Feature 4: read the measurement back from our own record ─────────
        //
        // `findScoredDecision` looks up the 'scored' row written by `/api/interview`;
        // `verifyScores` is pure and decides what may be persisted. Its answer is always
        // the MODEL's scores when a decision could be traced, never the client's — and
        // when nothing could be traced, the client's numbers are kept but labelled
        // 'unverified', which excludes them from every fairness figure.
        //
        // Note `readScoreSet` requires ALL FIVE dimensions to be present and in range. A
        // client sending four is not a partial measurement to be completed; it is a claim
        // this route will not accept.
        const claimedRead = readScoreSet(claimedScores);
        const lookup = await findScoredDecision(decisionId);
        const verified = verifyScores(
            lookup,
            claimedRead.state === 'measured' ? claimedRead.scores : null
        );
        const scoreSource = scoreSourceFor(verified.verification, verified.persist);

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
                // NULL, never 0, when nothing was measured. These five columns are the
                // measurement; a measurement whose producer cannot be named is not one, and
                // filling the gap with zeroes is exactly the fabrication this product
                // promises never to commit. `scoreSource` is derived from the same result
                // that produced these values, so the label and the numbers cannot disagree
                // — which is also what the Response_score_source_measured_check constraint
                // enforces in the database.
                technicalScore: verified.persist?.technicalScore ?? null,
                communicationScore: verified.persist?.communicationScore ?? null,
                confidenceScore: verified.persist?.confidenceScore ?? null,
                logicScore: verified.persist?.logicScore ?? null,
                depthScore: verified.persist?.depthScore ?? null,
                scoreSource,
                decisionId: lookup.found ? decisionId : null,
                // `feedback` and `improvementTip` are no longer written. They were composed
                // in the browser by comparing the invented score against a threshold
                // (`communicationScore > 70 ? 'Clear communication.' : ...`), so the
                // candidate was being given generated prose attributed to the AI
                // interviewer. They are left null rather than filled with something no
                // model said; a real qualitative field needs the model asked for it.
                feedback: null,
                improvementTip: null,
                idealAnswer,
            },
        });

        // ── Feature 4: phase two of the log — where the decision landed ──────
        //
        // Append only. The 'scored' row written by `/api/interview` is never updated, so a
        // mismatch is recorded as a second row rather than by rewriting the first: the
        // claim and the fact both survive, which is the only version of this that is worth
        // auditing. Never fatal — the answer is already saved above.
        await appendLinkedDecision({
            decisionId: lookup.found ? decisionId : null,
            sessionId,
            responseId: response.id,
            studyId: session.studyId ?? null,
            userId: session.userId ?? null,
            verification: verified.verification,
            mismatch: verified.mismatch ?? undefined,
            reason: verified.reason,
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
            // Reported back rather than kept private: a client (or whoever is debugging a
            // scoring complaint) can see whether this answer's numbers were traced to a
            // model decision, and a caller that sent scores it invented is told so.
            scoreSource,
            verification: verified.verification,
            deliveryAnalyzed,
            deliveryNote,
        });
    } catch (error) {
        console.error('Save response error:', error);
        return NextResponse.json({ success: true, skipped: true }); // Never break the interview
    }
}
