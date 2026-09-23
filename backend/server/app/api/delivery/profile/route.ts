// ============================================
// GET /api/delivery/profile
// Feature 2 — Multimodal Delivery Analysis
//
// A candidate's delivery profile: each metric rolled up across their analysed
// answers, with how many answers actually yielded a measurement, plus a per-session
// trend.
//
// WHAT THIS DELIBERATELY DOES NOT RETURN
// No composite delivery score, and no ranking. There is no honest way to collapse
// "spoke a little fast and paused twice" into one number about a person, and the
// platform does not get to grade someone on the way they talk. The numbers here are
// measurements with their bands; the reading of them belongs to the candidate.
//
// `measuredCount` sits beside every mean for the same reason: "145 wpm, measured on
// 4 of 6 answers" is a different claim from "145 wpm", and the difference is exactly
// what a person needs in order to know how much to trust it.
//
// WHO IS ASKED FOR, AND WHY IT IS A SESSION RATHER THAN A PERSON
//
//   · no parameter  — the signed-in user's own profile.
//   · ?sessionId=   — the profile of whoever sat that session. The caller must be that
//                     person, the owner of the study the session belongs to, or an
//                     admin.
//   · ?userId=      — an admin, or the person themselves. Kept because an admin
//                     investigating a complaint needs to name the account directly.
//
// The interviewer names a session, not a person, and the server resolves who that is.
// An interviewer already holds the session id — it is how they reach the candidate at
// all — so nothing is gained by handing them the candidate's account id as well, and
// a person's account id is not something to spread around to make a link work.
//
// THE SCOPE OF AN INTERVIEWER'S VIEW
//
// A study owner may read a candidate's delivery — that is the evidence behind a
// decision they are making — but only the answers given inside their own studies. A
// profile otherwise spans every answer a person has ever given here, including in
// another interviewer's study, and handing that over as a side effect of a roll-up is
// the kind of leak that looks like a feature. `sessionsVisibleToStudyOwner` narrows
// it, and an owner with no studies holding this candidate is refused rather than
// shown an empty profile — otherwise the endpoint would confirm which candidates
// exist, which is not information it was asked to give out.
// ============================================

import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { getAuthUser } from '@/lib/accessControl';
import {
    userDeliveryProfile,
    sessionsVisibleToStudyOwner,
} from '@/lib/delivery/deliveryService';
import { METRIC_REGISTRY } from '@/lib/delivery/contract';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const authUser = await getAuthUser();
        if (!authUser) {
            return NextResponse.json({ error: 'Login required' }, { status: 401 });
        }

        const params = new URL(request.url).searchParams;
        const sessionId = params.get('sessionId');
        const requestedUserId = params.get('userId');

        let userId = requestedUserId || authUser.id;
        // Set when the caller is a study owner reading someone else's answers, which
        // is the only case where the profile is narrowed.
        let ownerViewerId: string | null = null;

        if (sessionId) {
            const session = await supabaseDb.interviewSession.findUnique({
                where: { id: sessionId },
                include: { study: true },
            });
            if (!session) {
                return NextResponse.json({ error: 'Session not found' }, { status: 404 });
            }

            const candidateId = session.userId ? String(session.userId) : null;
            const isCandidate = candidateId !== null && candidateId === authUser.id;
            const isStudyOwner = Boolean(session.study) && session.study?.userId === authUser.id;
            const isAdmin = authUser.role === 'admin';

            if (!isCandidate && !isStudyOwner && !isAdmin) {
                return NextResponse.json(
                    { error: 'You do not have access to this session' },
                    { status: 403 }
                );
            }

            // A guest session has no account to hold a profile. Said plainly rather
            // than answered with an empty one, which would read as "this person has
            // no delivery" instead of "there is nobody on record here".
            if (!candidateId) {
                return NextResponse.json(
                    { error: 'This session was taken without an account, so it has no profile' },
                    { status: 400 }
                );
            }

            userId = candidateId;
            if (!isCandidate && !isAdmin) ownerViewerId = authUser.id;
        } else if (userId !== authUser.id && authUser.role !== 'admin') {
            // No session was named, so this is one account asking for another's
            // outright. That has to arrive as a session instead.
            return NextResponse.json(
                { error: 'You can only view the delivery of a candidate you interviewed' },
                { status: 403 }
            );
        }

        let sessionIds: string[] | undefined;
        if (ownerViewerId) {
            const visible = await sessionsVisibleToStudyOwner(userId, ownerViewerId);
            if (!visible || visible.length === 0) {
                return NextResponse.json(
                    { error: 'You can only view the delivery of a candidate in your own study' },
                    { status: 403 }
                );
            }
            sessionIds = visible;
        }

        const profile = await userDeliveryProfile(userId, { sessionLimit: 10, sessionIds });

        return NextResponse.json({
            success: true,
            ...profile,
            // Bands travel with the numbers, so a screen cannot draw them against
            // the wrong scale. See the note in the session delivery route.
            registry: METRIC_REGISTRY,
        });
    } catch (error) {
        console.error('[delivery/profile] Failed to load the delivery profile:', error);
        return NextResponse.json({ error: 'Could not load the delivery profile' }, { status: 500 });
    }
}
