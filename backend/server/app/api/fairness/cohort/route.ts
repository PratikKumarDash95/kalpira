// POST /api/fairness/cohort — tag one candidate's session into a declared cohort
// GET  /api/fairness/cohort — a study's tags, or one session's
//
// The interviewer's tagging control. Guarded by `resolveStudyAccess`, because this is
// study-scoped work an interviewer does on their own study — unlike the audit itself, which
// is admin-only.
//
// The tag is validated against the study's OWN declaration inside `assignCohort`, before
// anything is written. That is the whole of the design decision recorded for this feature:
// cohorts are declared by the study and assigned by a person. Nothing here infers a cohort
// from anything about the candidate, and an undeclared key — including one naming a
// protected attribute — is refused at the boundary rather than stored and filtered later.
import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { getAuthUser } from '@/lib/accessControl';
import { assertTrustedOrigin } from '@/lib/csrf';
import { resolveStudyAccess } from '@/lib/sessionAccess';
import {
    assignCohort,
    cohortAssignmentsForSession,
    cohortAssignmentsForStudy,
    removeCohortAssignment,
    studyCohortDeclaration,
} from '@/lib/fairness/fairnessService';

export const dynamic = 'force-dynamic';

/**
 * The study a session belongs to, and whether the caller may work on it.
 *
 * A session id on its own is never authorization to write a tag onto it, so the study is
 * resolved first and the caller is checked against the study. `assignCohort` looks the
 * session up again to validate the tag against the declaration; that second read is
 * cheaper than threading a partially-trusted study through the service's API.
 */
async function authorisedStudyFor(sessionId: string) {
    const session = await supabaseDb.interviewSession.findUnique({ where: { id: sessionId } });
    if (!session) return { state: 'missing' as const };
    if (!session.studyId) return { state: 'no_study' as const };

    const access = await resolveStudyAccess(String(session.studyId));
    if (access.state === 'denied') return { state: 'denied' as const, response: access.response };
    return { state: 'granted' as const, studyId: String(session.studyId) };
}

export async function POST(request: Request) {
    const csrfError = assertTrustedOrigin(request);
    if (csrfError) return csrfError;

    try {
        const body = await request.json().catch(() => ({}));
        const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
        if (!sessionId) {
            return NextResponse.json({ error: 'A sessionId is required.' }, { status: 400 });
        }

        const study = await authorisedStudyFor(sessionId);
        if (study.state === 'denied') return study.response;
        if (study.state !== 'granted') {
            return NextResponse.json(
                { error: 'That interview session does not belong to a study, so it cannot be tagged.' },
                { status: 404 }
            );
        }

        const authUser = await getAuthUser();

        // `cohortKey` and `cohortValue` are passed through unread on purpose: the
        // validation belongs in one place, against the parsed declaration, and a route
        // that pre-checked them would be a second implementation that could drift.
        const result = await assignCohort({
            sessionId,
            cohortKey: body?.cohortKey,
            cohortValue: body?.cohortValue,
            assignedBy: authUser?.id ?? null,
        });

        if (result.state === 'refused') {
            // 400, not 500: the declaration refused this tag, and the reason is a sentence
            // for the interviewer to act on rather than an error to retry.
            return NextResponse.json({ error: result.reason, refused: true }, { status: 400 });
        }

        return NextResponse.json({
            success: true,
            key: result.key,
            value: result.value,
            assignments: await cohortAssignmentsForSession(sessionId),
        });
    } catch (error) {
        console.error('[fairness/cohort] tagging failed:', error);
        return NextResponse.json({ error: 'The cohort tag could not be saved.' }, { status: 500 });
    }
}

export async function GET(request: Request) {    try {
        const url = new URL(request.url);
        const sessionId = url.searchParams.get('sessionId')?.trim() ?? '';
        const studyId = url.searchParams.get('studyId')?.trim() ?? '';

        if (sessionId) {
            const study = await authorisedStudyFor(sessionId);
            if (study.state === 'denied') return study.response;
            if (study.state !== 'granted') {
                return NextResponse.json({ error: 'Not found' }, { status: 404 });
            }
            return NextResponse.json({
                sessionId,
                assignments: await cohortAssignmentsForSession(sessionId),
            });
        }

        if (!studyId) {
            return NextResponse.json(
                { error: 'A studyId or sessionId is required.' },
                { status: 400 }
            );
        }

        // No empty-where hazard here: `studyId` is checked non-empty above, and the shim's
        // `findMany({ where: {} })` would otherwise read the whole table.
        const access = await resolveStudyAccess(studyId);
        if (access.state === 'denied') return access.response;

        // The declaration travels with the tags: the tagging control renders one row per
        // declared key, and a client that had to fetch the declaration separately could
        // render a key the study has since removed.
        const { declaration, issues, undeclared } = await studyCohortDeclaration(studyId);

        return NextResponse.json({
            studyId,
            declaration,
            declarationIssues: issues,
            undeclared,
            assignments: await cohortAssignmentsForStudy(studyId),
        });
    } catch (error) {
        console.error('[fairness/cohort] read failed:', error);
        return NextResponse.json({ error: 'The cohort tags could not be read.' }, { status: 500 });
    }
}

/**
 * DELETE — remove one tag.
 *
 * A mis-click has to be undoable. Without this, the tagging control's "not tagged" option
 * silently does nothing, which is worse than the mis-click: it teaches the interviewer that
 * the control lies. Removing a tag changes no score and no past audit run — a run's counts
 * are stored on the run, and are never re-derived from this table.
 *
 * The key is not validated against the declaration, because removing a tag for a key the
 * study has since stopped declaring is exactly the cleanup someone needs to be able to do.
 */
export async function DELETE(request: Request) {
    const csrfError = assertTrustedOrigin(request);
    if (csrfError) return csrfError;

    try {
        const body = await request.json().catch(() => ({}));
        const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
        const cohortKey = typeof body?.cohortKey === 'string' ? body.cohortKey.trim() : '';
        if (!sessionId || !cohortKey) {
            return NextResponse.json(
                { error: 'A sessionId and a cohortKey are required.' },
                { status: 400 }
            );
        }

        const study = await authorisedStudyFor(sessionId);
        if (study.state === 'denied') return study.response;
        if (study.state !== 'granted') {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const removed = await removeCohortAssignment(sessionId, cohortKey);

        return NextResponse.json({
            success: true,
            // Reported so the caller can tell "untagged" from "there was nothing to untag",
            // rather than both reading as a successful removal.
            removed,
            assignments: await cohortAssignmentsForSession(sessionId),
        });
    } catch (error) {
        console.error('[fairness/cohort] untag failed:', error);
        return NextResponse.json({ error: 'The cohort tag could not be removed.' }, { status: 500 });
    }
}
