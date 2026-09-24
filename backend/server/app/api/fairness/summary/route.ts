// GET /api/fairness/summary?studyId=… — the interviewer's per-study fairness view
//
// `resolveStudyAccess`, not `requireAdmin`: this is the thin summary, and the person who
// owns the study is the one who has to act on it. It reports whether a run exists, when it
// ran, its caveats and how many flags it raised by severity — deliberately not the
// per-cohort figures, which stay on the admin console behind `/api/fairness/audit/[id]`.
import { NextResponse } from 'next/server';
import { resolveStudyAccess } from '@/lib/sessionAccess';
import { studyFairnessSummary } from '@/lib/fairness/fairnessService';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const studyId = new URL(request.url).searchParams.get('studyId')?.trim() ?? '';
        if (!studyId) {
            return NextResponse.json({ error: 'A studyId is required.' }, { status: 400 });
        }

        const access = await resolveStudyAccess(studyId);
        if (access.state === 'denied') return access.response;

        const summary = await studyFairnessSummary(studyId);

        return NextResponse.json({
            ...summary,
            // The console shows a "Run an audit" control to admins only, because the run
            // route is admin-gated. Telling the client here keeps that rule in one place
            // instead of duplicating it in each frontend's own role check.
            canRunAudit: access.isAdmin,
        });
    } catch (error) {
        console.error('[fairness/summary] read failed:', error);
        return NextResponse.json({ error: 'The fairness summary could not be read.' }, { status: 500 });
    }
}
