// ============================================
// POST /api/integrity/appeals/[id]/review — a reviewer decides an appeal
// Feature 3 — Integrity & Authenticity Suite
// ============================================
//
// Admin-only, and deliberately so. The person who decides whether a candidate's
// objection stands is the one accountable for the process, and in a study a
// researcher has a stake in the finding they are reviewing — they are hiring from it.
// An interviewer reviewing appeals against their own study's flags is the conflict
// this restriction exists to remove.
//
// WHAT A DECISION MEANS
//
// 'upheld' means the candidate's objection was accepted. It is a statement about the
// FINDING — that it should not have been recorded, or should not carry the weight it
// did — and not about the candidate's honesty, which this route never assesses.
// 'dismissed' means the finding stands. Both require the reviewer's own words in
// `note`, because a decision record with no reasoning is one nobody can audit.
//
// THE LOG IS APPEND-ONLY
//
// Every decision appends to `IntegrityReviewLog`, and the service exposes no update
// and no delete for that table. The appeal row holds the current state; the log holds
// that a decision was made, by whom, and when — which is what lets an auditor ask
// whether one reviewer dismisses every appeal they are handed, a question the
// current-state columns cannot answer because they only ever hold the latest value.
//
// The decision does not change the score. Nothing in this feature rewrites a stored
// report on the strength of an argument — the report is a record of what was measured
// at a point in time, and the appeal is a record of what a person concluded about it.
// Keeping those separate is what makes both trustworthy.
// ============================================

import { NextResponse } from 'next/server';
import { getAdminUser, requireAdmin } from '@/lib/adminAuth';
import { reviewAppeal } from '@/lib/integrity/integrityService';

export const dynamic = 'force-dynamic';

const DECISIONS = ['upheld', 'dismissed'] as const;
type Decision = (typeof DECISIONS)[number];

/** Longest reviewer note stored. */
const MAX_NOTE = 4000;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const denied = await requireAdmin();
    if (denied) return denied;

    try {
        const { id: appealId } = await params;
        const body = await request.json().catch(() => ({}));

        const decision = typeof body?.decision === 'string' ? body.decision : null;
        const note = typeof body?.note === 'string' ? body.note.trim() : '';

        if (!decision || !DECISIONS.includes(decision as Decision)) {
            return NextResponse.json(
                { error: `decision must be one of: ${DECISIONS.join(', ')}` },
                { status: 400 }
            );
        }
        // A decision without reasoning cannot be audited, and an auditor asking "why
        // was this dismissed?" is the whole reason the log exists.
        if (note.length === 0) {
            return NextResponse.json(
                { error: 'A decision must include a note explaining it' },
                { status: 400 }
            );
        }
        if (note.length > MAX_NOTE) {
            return NextResponse.json({ error: `A note may be at most ${MAX_NOTE} characters` }, { status: 413 });
        }

        // The legacy admin-password session carries no user id. The log records who
        // decided, and `null` there is honest — the alternative, inventing an id, is
        // worse than an incomplete record.
        const admin = await getAdminUser();

        const updated = await reviewAppeal({
            appealId,
            reviewerId: admin?.id ?? null,
            decision: decision as Decision,
            note,
        });

        return NextResponse.json({
            success: true,
            appealId,
            status: updated.status,
            decidedAt: updated.decidedAt,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[integrity/appeals/review] Could not record the decision:', error);
        return NextResponse.json({ error: message }, { status: 400 });
    }
}
