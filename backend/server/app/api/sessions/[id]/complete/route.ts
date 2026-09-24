// POST /api/sessions/[id]/complete — Mark session complete and compute ScoreBreakdown
import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { getParticipantRequestContext } from '@/lib/researcherContext';
import { getAuthUser } from '@/lib/accessControl';
import { assertTrustedOrigin } from '@/lib/csrf';
import { recomputeUserAbilities } from '@/lib/measurement/abilityService';
import { isMeasuredResponse } from '@/lib/fairness/decisionLog';

export const dynamic = 'force-dynamic';

// No body is read here, which makes this a CORS "simple request": the browser
// sends it without a preflight, and in production the session cookie is
// SameSite=None (the API is on a different host from the frontends), so it is
// attached cross-site. The ownership rules below stop a stranger from ending
// someone else's interview, but they do nothing about a page that borrows the
// *victim's own* cookie — which is the whole of CSRF. Left open, the failure is
// the one the comment below describes: a live interview closed early, a
// ScoreBreakdown written from partial responses, and a real person's measured
// competencies recomputed from them — triggered by visiting a page.
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const csrfError = assertTrustedOrigin(request);
        if (csrfError) return csrfError;

        const { id: sessionId } = await params;

        if (sessionId.startsWith('guest-') || sessionId.startsWith('fallback-')) {
            return NextResponse.json({ success: true, skipped: true });
        }

        const session = await supabaseDb.interviewSession.findUnique({
            where: { id: sessionId },
            include: { responses: true, study: true },
        });

        if (!session) {
            return NextResponse.json({ success: true, skipped: true });
        }

        // ── Who may complete this session ────────────────────────────────────
        // Same rule as `save-response`, and the same reasoning: every persisted
        // session has an owner, because `sessions/start` hands an anonymous caller a
        // `guest-…` id rather than a row, and those are short-circuited above.
        //
        // This route does more than its name suggests. It closes the session, writes
        // the ScoreBreakdown, and asks the measurement engine to recompute the
        // owner's ability profile. Leaving it open meant an unauthenticated caller
        // who knew a practice session's id could end a live interview early and
        // move a real person's measured competencies using responses they had not
        // written. It was wrapped in `if (session.studyId)`, so that was exactly the
        // shape of session it did not guard.
        //
        // Ownership alone, with no role test, for the same reason as the sibling
        // route: a self-practice session is most often owned by an interviewer, and
        // requiring role 'candidate' here would lock out the people who use it.
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

        // ── Feature 4: average only what was actually measured ────────────────
        //
        // The old calculation was `reduce(sum + r[field]) / responses.length`, which read a
        // not-measured answer as a zero: the null contributed nothing to the numerator
        // while still counting in the denominator, so one measured answer of 80 alongside
        // one unmeasured answer averaged to 40. That is a fabricated measurement — it
        // describes neither answer — and it was invisible, because the arithmetic never
        // failed.
        //
        // A response now counts only when its scores were read back from a recorded model
        // decision. When none do, the session still completes (the candidate finished their
        // interview, and that is a fact) but no breakdown is written, because there is no
        // measurement to report. A missing breakdown is absent, and the API reports it as
        // null — never as 0.
        const measured = session.responses.filter((response: any) => isMeasuredResponse(response));
        const count = measured.length;

        // Update the session with completedAt either way; the score is conditional.
        await supabaseDb.interviewSession.update({
            where: { id: sessionId },
            data: { completedAt: new Date() },
        });

        let overallScore: number | null = null;
        if (count > 0) {
            const avg = (field: string) =>
                measured.reduce((sum: number, r: any) => sum + Number(r[field]), 0) / count;

            const technicalAverage = avg('technicalScore');
            const communicationAverage = avg('communicationScore');
            const confidenceAverage = avg('confidenceScore');
            const logicAverage = avg('logicScore');
            const depthAverage = avg('depthScore');
            overallScore = (technicalAverage + communicationAverage + confidenceAverage + logicAverage + depthAverage) / 5;

            // Upsert ScoreBreakdown
            await supabaseDb.scoreBreakdown.upsert({
                where: { sessionId },
                create: {
                    sessionId,
                    overallScore,
                    technicalAverage,
                    communicationAverage,
                    confidenceAverage,
                    logicAverage,
                    depthAverage,
                },
                update: {
                    overallScore,
                    technicalAverage,
                    communicationAverage,
                    confidenceAverage,
                    logicAverage,
                    depthAverage,
                },
            });

            await supabaseDb.interviewSession.update({
                where: { id: sessionId },
                data: { averageScore: overallScore },
            });
        }

        // Bring the candidate's measured ability profile up to date now that the
        // session's responses are final. Awaited rather than fired and forgotten:
        // a candidate who lands on their ability map right after finishing should
        // see this session in it, and this only touches one user's rows.
        //
        // Never fatal — measurement is an enhancement of the results, so a
        // failure here must not cost the candidate their completed session.
        //
        // Run whenever the session has responses, not only when they were measured: the
        // recompute re-reads every session for this user, so gating it on this session's
        // measurement would leave an unrelated correction unapplied.
        let measuredAbility = false;
        if (session.userId && session.responses.length > 0) {
            try {
                await recomputeUserAbilities(session.userId, { sessionId });
                measuredAbility = true;
            } catch (measurementError) {
                console.error(
                    '[sessions/complete] Ability recompute failed (session still completed):',
                    measurementError
                );
            }
        }

        return NextResponse.json({
            success: true,
            // Null, never 0, when nothing was measured. A client that renders this must say
            // "not measured" rather than print a zero the candidate never scored.
            overallScore,
            assessed: count > 0,
            measuredAnswers: count,
            measured: measuredAbility,
        });
    } catch (error) {
        console.error('Session complete error:', error);
        return NextResponse.json({ success: true, skipped: true });
    }
}
