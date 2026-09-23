// ============================================
// POST /api/integrity/appeals — a candidate contests a finding
// GET  /api/integrity/appeals — read appeals
// Feature 3 — Integrity & Authenticity Suite
// ============================================
//
// The appeal is part of the feature, not a follow-up. False positives ruin real
// people's careers, and a system that can flag someone without letting them answer is
// not shippable — so this route ships in the same pass as the score it contests.
//
// WHAT AN APPEAL IS, AND IS NOT
//
// It names ONE finding. Not a general complaint box: a reviewer has to know which
// finding is disputed in order to judge it, and a free-floating appeal cannot be
// resolved by anyone. The candidate's own words are required and are not summarised.
//
// The statement is stored verbatim (bounded, so a request cannot be used as free
// storage) because the whole point is that the person gets to say something the
// platform did not think to ask.
//
// WHO MAY SUBMIT
//
// The candidate the session is about, or a valid participant link for that session's
// study — because most interviews are sat through a link by someone who is not signed
// in, and an appeal only signed-in candidates can file is an appeal most candidates
// cannot file.
//
// WHO MAY READ
//
// A candidate sees their own appeals. A study owner sees the appeals on their own
// study's sessions. An admin sees all of them. The scoping is applied in the query
// rather than after it, so there is no shape of request that returns more.
// ============================================

import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/accessControl';
import { getAdminUser } from '@/lib/adminAuth';
import { resolveSessionAccess } from '@/lib/integrity/guards';
import { listAppeals, submitAppeal } from '@/lib/integrity/integrityService';
import supabaseDb from '@/lib/supabaseDb';

export const dynamic = 'force-dynamic';

/** Longest statement stored. Generous, and bounded so the column is not free storage. */
const MAX_STATEMENT = 4000;

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : null;
        const reportId = typeof body?.reportId === 'string' ? body.reportId : null;
        const flagKey = typeof body?.flagKey === 'string' ? body.flagKey : null;
        const statement = typeof body?.statement === 'string' ? body.statement.trim() : '';

        if (!sessionId || !reportId || !flagKey) {
            return NextResponse.json(
                { error: 'sessionId, reportId and flagKey are required' },
                { status: 400 }
            );
        }
        if (statement.length === 0) {
            return NextResponse.json({ error: 'An appeal must include a statement' }, { status: 400 });
        }
        if (statement.length > MAX_STATEMENT) {
            return NextResponse.json(
                { error: `A statement may be at most ${MAX_STATEMENT} characters` },
                { status: 413 }
            );
        }

        const access = await resolveSessionAccess(request, sessionId, { allowParticipantLink: true });
        if (access.state === 'denied') return access.response;

        // The appeal is attributed to the candidate the session is about, not to
        // whoever happened to be signed in. A study owner filing an appeal on a
        // candidate's behalf would otherwise see it appear under their own name.
        const { id } = await submitAppeal({
            sessionId,
            reportId,
            userId: access.ownerId,
            flagKey,
            statement,
        });

        return NextResponse.json({ success: true, appealId: id });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[integrity/appeals] Could not file the appeal:', error);
        // A refused appeal is the candidate's own error — a finding that is not in the
        // report, or a report from another session — so it is a 400 with the reason,
        // not a 500 that tells them nothing.
        return NextResponse.json({ error: message }, { status: 400 });
    }
}

export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const sessionId = url.searchParams.get('sessionId');
        const reportId = url.searchParams.get('reportId');
        const status = url.searchParams.get('status');

        const admin = await getAdminUser();
        const authUser = admin ?? (await getAuthUser());

        if (admin) {
            return NextResponse.json({
                success: true,
                viewer: 'admin',
                appeals: await listAppeals({
                    sessionId: sessionId ?? undefined,
                    reportId: reportId ?? undefined,
                    status: status ?? undefined,
                }),
            });
        }

        if (!authUser?.id) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        // A session filter is checked against ownership before it is used.
        if (sessionId) {
            const access = await resolveSessionAccess(request, sessionId);
            if (access.state === 'denied') return access.response;

            return NextResponse.json({
                success: true,
                viewer: access.isCandidate ? 'candidate' : 'study_owner',
                appeals: await listAppeals({
                    sessionId,
                    reportId: reportId ?? undefined,
                    status: status ?? undefined,
                    // A candidate sees only their own appeals on the session; a study
                    // owner sees all of them, because they are the one deciding.
                    userId: access.isCandidate && !access.isStudyOwner ? access.ownerId ?? undefined : undefined,
                }),
            });
        }

        // Without a session filter, the scope is the caller: the appeals they filed,
        // plus those on studies they own. Built as an explicit union rather than a
        // missing filter, so "no filter" can never mean "everything".
        const owned = await supabaseDb.study.findMany({ where: { userId: authUser.id } });
        const studyIds = (owned as Record<string, any>[]).map((study) => String(study.id));

        const mine = await listAppeals({ userId: authUser.id, status: status ?? undefined });

        if (studyIds.length === 0) {
            return NextResponse.json({ success: true, viewer: 'candidate', appeals: mine });
        }

        const sessions = await supabaseDb.interviewSession.findMany({
            where: { studyId: { in: studyIds } },
        });
        const sessionIds = new Set((sessions as Record<string, any>[]).map((session) => String(session.id)));

        const onMyStudies = (
            await listAppeals({ status: status ?? undefined })
        ).filter((appeal) => sessionIds.has(String(appeal.sessionId)));

        const byId = new Map<string, Record<string, any>>();
        for (const appeal of [...mine, ...onMyStudies]) byId.set(String(appeal.id), appeal);

        return NextResponse.json({
            success: true,
            viewer: 'mixed',
            appeals: [...byId.values()].sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt))),
        });
    } catch (error) {
        console.error('[integrity/appeals] Could not read appeals:', error);
        return NextResponse.json({ error: 'Could not read appeals' }, { status: 500 });
    }
}
