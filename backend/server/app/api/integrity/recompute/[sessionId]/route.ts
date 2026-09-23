// ============================================
// POST /api/integrity/recompute — re-run a session's integrity analysis
// Feature 3 — Integrity & Authenticity Suite
// ============================================
//
// Runs the three layers again and replaces the session's stored report.
//
// WHEN THIS IS THE RIGHT CALL
//
// Two cases. The first is a failed or missing analysis — a job that never ran, or ran
// before the session's answers were saved. The second is a threshold change: when the
// registry version moves, previously-recorded findings were computed under rules that
// no longer apply, and a reviewer looking at an old report is entitled to a current
// one. Neither is something a candidate can trigger, which is why this is not on the
// participant-facing surface.
//
// WHY REPLACING IS SAFE HERE
//
// Feature 2 refuses to recompute in place because its adjusted scores have already
// been consumed downstream, so re-running would apply the same penalty twice. Nothing
// reads an integrity score that way — it is evidence a person looks at, not an input
// to another number — so a recomputation can simply replace the report. That is what
// makes a threshold change re-runnable at all.
//
// The previous report is not kept. If an audit trail of what was previously found is
// needed, it belongs in `IntegrityReviewLog`, which is append-only and records that a
// human looked and what they concluded — not a silent pile of superseded scores.
//
// WHO MAY RUN IT
//
// The study owner, the session's own owner, or an admin. The study owner because they
// are making the decision and may need a current report; the candidate because a
// self-practice session is theirs; an admin because a threshold migration is an
// operational act.
// ============================================

import { NextResponse } from 'next/server';
import { assertTrustedOrigin } from '@/lib/csrf';
import { resolveSessionAccess } from '@/lib/sessionAccess';
import { analyzeSessionIntegrity } from '@/lib/integrity/integrityService';

export const dynamic = 'force-dynamic';

// Body-less POST, so it is a CORS "simple request" that never preflights and
// carries the caller's SameSite=None cookie cross-site. `resolveSessionAccess`
// answers "may *this caller* recompute", which is the right question for
// authorization and the wrong one for CSRF: the forged request comes with the
// victim's cookie, so it passes. Recomputation is not free — it spends model
// work and rewrites the stored report — so it is checked here, before the
// access resolution does any work of its own.
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
    try {
        const csrfError = assertTrustedOrigin(request);
        if (csrfError) return csrfError;

        const { sessionId } = await params;

        // No participant link: recomputation spends work, and a link holder sitting an
        // interview is not the person who decides when that work happens.
        const access = await resolveSessionAccess(request, sessionId);
        if (access.state === 'denied') return access.response;

        const outcome = await analyzeSessionIntegrity(sessionId);

        if (outcome.status === 'failed') {
            return NextResponse.json(
                { success: false, error: outcome.error ?? 'The analysis could not be completed' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            sessionId,
            jobId: outcome.jobId,
            status: outcome.status,
            // The full report comes back so a caller does not have to follow up with a
            // read, and so the recomputation is visible in one round trip.
            report: outcome.report,
        });
    } catch (error) {
        console.error('[integrity/recompute] Could not recompute:', error);
        return NextResponse.json({ error: 'Could not recompute the integrity report' }, { status: 500 });
    }
}
