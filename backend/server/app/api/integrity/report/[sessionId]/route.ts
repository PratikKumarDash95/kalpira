// ============================================
// GET /api/integrity/report/[sessionId] — the evidence trail for one session
// Feature 3 — Integrity & Authenticity Suite
// ============================================
//
// Returns the stored report, the flags, the per-answer stylometry and the event
// counts. Three audiences read this route and they do not see the same thing.
//
//   · An admin, and the owner of the study the session belongs to, see the report
//     whole. They are the people making a decision from it, and withholding the
//     evidence behind a score from the person acting on the score would be absurd.
//
//   · The candidate sees their own report, redacted. They are entitled to know how a
//     score about them was reached — that is the transparency rule and it is not
//     optional — but a similarity finding concerns two people, and showing the other
//     candidate's answer to this one would hand over somebody else's work.
//
// WHY THE REPORT IS READ RATHER THAN RECOMPUTED
//
// The events and the text behind it are not retained indefinitely, and a finding that
// can be silently re-derived under changed thresholds is not an audit trail. What a
// reviewer sees has to be what the score was actually built from. If the report looks
// stale, the answer is to recompute it explicitly, which is what `recompute` is for.
//
// THREE DISTINGUISHABLE STATES, AND THE DIFFERENCE MATTERS
//
//   · `report: null`                     — analysis has not run. Nobody has looked.
//   · `report.assessed: false, score: null` — analysis ran and could not judge.
//   · `report.assessed: true`            — there is a score, and here is its evidence.
//
// A UI that collapsed the first two would tell a candidate they had been assessed
// when they had not, which is the mistake this feature's whole design is arranged
// around avoiding.
// ============================================

import { NextResponse } from 'next/server';
import { resolveSessionAccess } from '@/lib/sessionAccess';
import { redactForCandidate, sessionIntegrity } from '@/lib/integrity/integrityService';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
    try {
        const { sessionId } = await params;

        // No participant link: a link is a capability to sit an interview, not to read
        // the integrity analysis of one.
        const access = await resolveSessionAccess(request, sessionId);
        if (access.state === 'denied') return access.response;

        const view = await sessionIntegrity(sessionId);
        // Only the candidate's own view is redacted. A study owner is acting on the
        // report and an admin is accountable for it, so both see it whole.
        const candidateOnly = access.isCandidate && !access.isStudyOwner && !access.isAdmin;

        return NextResponse.json({
            success: true,
            sessionId,
            report: view.report && candidateOnly ? redactForCandidate(view.report) : view.report,
            flags: view.report ? (candidateOnly ? redactForCandidate(view.report).flags : view.flags) : [],
            authenticity: view.authenticity.map((row) => ({
                responseId: row.responseId,
                wordCount: row.wordCount,
                sentenceCount: row.sentenceCount,
                burstiness: row.burstiness ?? null,
                lexicalDiversity: row.lexicalDiversity ?? null,
                repetitionIndex: row.repetitionIndex ?? null,
                driftVsBaseline: row.driftVsBaseline ?? null,
                baselineAnswers: row.baselineAnswers ?? 0,
                measured: Boolean(row.measured),
                explanation: row.explanation ?? null,
            })),
            eventCounts: view.eventCounts,
            totalEvents: view.totalEvents,
            reportId: view.reportId,
            // Stated in the payload rather than left for the client to work out, so a
            // UI cannot accidentally present a redacted report as a complete one.
            viewer: candidateOnly ? 'candidate' : access.isAdmin ? 'admin' : 'study_owner',
        });
    } catch (error) {
        console.error('[integrity/report] Could not read the report:', error);
        return NextResponse.json({ error: 'Could not read the integrity report' }, { status: 500 });
    }
}
