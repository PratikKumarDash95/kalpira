// ============================================
// guards.ts — who may see or do what, for the integrity routes
// Feature 3 — Integrity & Authenticity Suite
// ============================================
//
// One implementation of the ownership rule, shared by six routes. Writing it once is
// not only about repetition: the rule is the thing standing between a candidate's
// integrity report and anyone who asks for it, and six copies of a permission check
// are six chances to get it subtly different.
//
// A NOTE ON THE SESSION-WITH-NO-STUDY CASE
//
// `api/sessions/[id]/save-response` used to guard its writes inside
// `if (session.studyId)`, which left a self-practice session — one not attached to any
// study — with no auth check on that route at all: an unauthenticated write into any
// practice session whose id you knew. That has since been fixed there, and this file's
// branches are the shape that fix was modelled on.
//
// It is recorded here because the pattern is the one to avoid: a permission check that
// runs for one shape of input and silently does not run for another is worse than no
// check, because it reads as guarded. The branches below are exhaustive over "has a
// study" and "has no study", and a session that does not exist is refused rather than
// treated as ownerless-and-therefore-open. Feature 3 is the first thing in this product
// that can accuse someone, so its routes do not inherit the pattern.
//
// THE THREE ANSWERS
//
//   · admin          — sees everything, unredacted.
//   · study owner    — sees the sessions in their own study, unredacted, because they
//                      are the person making a hiring decision from them.
//   · the candidate  — sees their own report, redacted, because the transparency rule
//                      entitles them to know how a score about them was reached while
//                      withholding the other candidate's work.
//
// Anyone else is refused, and the refusal is the same shape whether the session does
// not exist or the caller simply may not see it — so probing cannot enumerate.

import { NextResponse } from 'next/server';
import supabaseDb from '../supabaseDb';
import { getAuthUser } from '../accessControl';
import { getAdminUser, requireAdmin } from '../adminAuth';
import { getParticipantRequestContext } from '../researcherContext';

export interface SessionAccess {
    /** String discriminant, not a boolean: this repo compiles with `strict: false`, where
     * boolean-literal narrowing does not happen and every call site would fail to
     * narrow its denial branch. */
    state: 'granted';
    session: Record<string, any>;
    sessionId: string;
    studyId: string | null;
    /** The user this session belongs to, when it has one. */
    ownerId: string | null;
    /** The user who owns the study this session belongs to, when there is one. */
    studyOwnerId: string | null;
    isAdmin: boolean;
    /** The authenticated caller IS the candidate this session is about. */
    isCandidate: boolean;
    isStudyOwner: boolean;
    /** Set when access came from a valid participant link rather than a session cookie. */
    viaParticipantLink: boolean;
}

export type AccessResult = SessionAccess | { state: 'denied'; response: NextResponse };

/** The one refusal. Identical for "not yours" and "does not exist". */
function refuse(): { state: 'denied'; response: NextResponse } {
    return {
        state: 'denied',
        response: NextResponse.json({ error: 'Not found' }, { status: 404 }),
    };
}

/**
 * Resolves what the caller may do with a session.
 *
 * `allowParticipantLink` is set by the routes a candidate reaches mid-interview — the
 * event recorder, and filing an appeal. It is off for the report read, because a
 * participant link is a capability to sit an interview, not to read the integrity
 * analysis of one.
 */
export async function resolveSessionAccess(
    request: Request,
    sessionId: string,
    options: { allowParticipantLink?: boolean } = {}
): Promise<AccessResult> {
    const session = await supabaseDb.interviewSession.findUnique({ where: { id: sessionId } });
    if (!session) return refuse();

    const studyId = session.studyId ? String(session.studyId) : null;
    let studyOwnerId: string | null = null;
    if (studyId) {
        const study = await supabaseDb.study.findUnique({ where: { id: studyId } });
        studyOwnerId = study?.userId ? String(study.userId) : null;
    }

    const authUser = await getAuthUser();
    const isAdmin = authUser?.role === 'admin';
    const ownerId = session.userId ? String(session.userId) : null;
    const isCandidate = Boolean(authUser?.id && ownerId && authUser.id === ownerId);
    const isStudyOwner = Boolean(authUser?.id && studyOwnerId && authUser.id === studyOwnerId);

    const base = {
        session: session as Record<string, any>,
        sessionId,
        studyId,
        ownerId,
        studyOwnerId,
        isAdmin,
        isCandidate,
        isStudyOwner,
    };

    if (isAdmin || isCandidate || isStudyOwner) {
        return { state: 'granted', ...base, viaParticipantLink: false };
    }

    if (options.allowParticipantLink && studyId) {
        const participant = await getParticipantRequestContext(request);
        // The link must be for THIS session's study and issued by that study's owner.
        // Checking only that a link is valid would let a link from any study in the
        // system write events into any other.
        if (
            participant.valid &&
            participant.context &&
            participant.studyId === studyId &&
            participant.context.userId === studyOwnerId
        ) {
            return { state: 'granted', ...base, viaParticipantLink: true };
        }
    }

    return refuse();
}

/**
 * Resolves whether the caller owns a study.
 *
 * Used by the study-wide similarity routes, which are not about one session and so
 * have no session to resolve access through. Admin-ness goes through `getAdminUser`
 * rather than a bare role comparison so the legacy admin-password session — which
 * carries no `researcherId` — is treated as an admin, exactly as the rest of the
 * codebase treats it.
 */
export async function resolveStudyAccess(
    studyId: string
): Promise<
    | { state: 'granted'; study: Record<string, any>; isAdmin: boolean; isOwner: boolean }
    | { state: 'denied'; response: NextResponse }
> {
    const study = await supabaseDb.study.findUnique({ where: { id: studyId } });
    if (!study) return refuse();

    const admin = await getAdminUser();
    const authUser = admin ?? (await getAuthUser());
    const isOwner = Boolean(authUser?.id && study.userId && String(study.userId) === authUser.id);

    if (!admin && !isOwner) return refuse();

    return {
        state: 'granted',
        study: study as Record<string, any>,
        isAdmin: Boolean(admin),
        isOwner,
    };
}

/** Admin-only routes, in the shape the rest of the codebase uses. */
export { requireAdmin };
