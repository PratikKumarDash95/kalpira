// ============================================
// GET  /api/integrity/report/[sessionId]/review — the reviewer history
// POST /api/integrity/report/[sessionId]/review — record that a human read it
// Feature 3 — Integrity & Authenticity Suite
// ============================================
//
// This is where the feature hands the decision to a person, and records that it did.
//
// WHY "REVIEWED" IS RECORDED AT ALL
//
// A score with no record of anyone having read it is a score that was acted on by a
// machine. The `reviewedBy` and `reviewedAt` columns on the report say a human looked;
// the append-only log says when, in what order, and what they said. The columns hold
// the current state and the log holds the history, which is the only way to answer
// "has anyone actually looked at this candidate's report" after the fact.
//
// THE ROUTE DOES NOT DECIDE ANYTHING
//
// It takes a note and a reviewer identity. It does not accept an outcome, does not
// change the score, and does not touch the flags. A reviewer reading a report and
// forming a view about a candidate is a hiring decision, and hiring decisions do not
// belong inside the integrity feature's own database — the platform's candidate
// record is where that lives. Keeping the boundary here is what stops a score from
// quietly becoming a verdict.
//
// Admin-only. A study owner is entitled to read the report their own study produced,
// but marking it reviewed is an accountability act, and the person accountable for
// the integrity process is not the person hiring from it.
// ============================================

import { NextResponse } from 'next/server';
import { getAdminUser, requireAdmin } from '@/lib/adminAuth';
import { resolveSessionAccess } from '@/lib/sessionAccess';
import { reviewHistory, reviewReport, sessionIntegrity } from '@/lib/integrity/integrityService';

export const dynamic = 'force-dynamic';

const MAX_NOTE = 4000;

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
    try {
        const { sessionId } = await params;

        const access = await resolveSessionAccess(request, sessionId);
        if (access.state === 'denied') return access.response;

        const view = await sessionIntegrity(sessionId);
        if (!view.reportId) {
            return NextResponse.json({ success: true, sessionId, history: [] });
        }

        return NextResponse.json({
            success: true,
            sessionId,
            reportId: view.reportId,
            history: await reviewHistory(view.reportId),
        });
    } catch (error) {
        console.error('[integrity/report/review] Could not read the review history:', error);
        return NextResponse.json({ error: 'Could not read the review history' }, { status: 500 });
    }
}

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
    const denied = await requireAdmin();
    if (denied) return denied;

    try {
        const { sessionId } = await params;
        const body = await request.json().catch(() => ({}));
        const note = typeof body?.note === 'string' ? body.note.trim() : '';

        if (note.length === 0) {
            return NextResponse.json(
                { error: 'A review must include a note saying what was concluded' },
                { status: 400 }
            );
        }
        if (note.length > MAX_NOTE) {
            return NextResponse.json({ error: `A note may be at most ${MAX_NOTE} characters` }, { status: 413 });
        }

        const view = await sessionIntegrity(sessionId);
        if (!view.reportId) {
            // Reviewing a session that has never been analysed would record a review
            // of nothing. Recompute first; the honest answer here is that there is
            // nothing to review yet.
            return NextResponse.json(
                { error: 'This session has no integrity report yet. Recompute it first.' },
                { status: 409 }
            );
        }

        const admin = await getAdminUser();
        await reviewReport({ reportId: view.reportId, reviewerId: admin?.id ?? null, note });

        return NextResponse.json({ success: true, sessionId, reportId: view.reportId });
    } catch (error) {
        console.error('[integrity/report/review] Could not record the review:', error);
        return NextResponse.json({ error: 'Could not record the review' }, { status: 500 });
    }
}
