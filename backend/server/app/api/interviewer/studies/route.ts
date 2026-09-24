// GET  /api/interviewer/studies — List studies owned by logged-in interviewer
// POST /api/interviewer/studies — Create a new study (interview template)
// NOTE: Uses (supabaseDb as any) casts because the Supabase client needs regeneration
// after the schema migration. Restart the dev server to fix type errors.
import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { withInterviewerAiConfig } from '@/lib/interviewerAiConfig';
import { excludeSelfPreviewSessions } from '@/lib/previewSession';
import { getInterviewerId, getInterviewerUser } from '@/lib/interviewerAuth';
import { resolveEffectivePlan } from '@/lib/plans';

export const dynamic = 'force-dynamic';

const db = supabaseDb as any;

export async function GET() {
    const interviewerId = await getInterviewerId();
    if (!interviewerId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const studies = await db.study.findMany({
            where: { userId: interviewerId },
            orderBy: { createdAt: 'desc' },
            include: {
                interviewSessions: {
                    select: { id: true, averageScore: true, completedAt: true, candidateName: true, candidateEmail: true, mode: true },
                },
            },
        });

        const studiesWithStats = await Promise.all(studies.map(async (s: any) => {
            // Exclude the interviewer's own self-preview / self-practice runs so the
            // dashboard candidate count matches the real candidate list on the detail page.
            const sessions = excludeSelfPreviewSessions(s.interviewSessions || []);
            const completed = sessions.filter((sess: any) => sess.completedAt);

            // Feature 4: averaged over the candidates who were actually SCORED, not over
            // everyone who finished.
            //
            // `InterviewSession.averageScore` is a `not null default 0` column, so a session
            // whose answers nothing ever scored is indistinguishable from one that scored
            // zero by reading that column alone. The old average here divided by every
            // completed session, which counted each unscored interview as a 0: four measured
            // candidates at 80 alongside one nobody scored averaged to 64, a figure that
            // describes nobody in the study.
            //
            // The presence of a ScoreBreakdown row is the real signal, so it is read
            // separately — a relation nested two levels deep (study → sessions → breakdown)
            // is not something the database shim can hydrate, and guessing from the 0 would
            // be the bug this fixes.
            const sessionIds = completed.map((sess: any) => sess.id);
            const breakdowns = sessionIds.length
                ? await db.scoreBreakdown.findMany({
                    where: { sessionId: { in: sessionIds } },
                    select: { sessionId: true, overallScore: true },
                })
                : [];
            const measured = (breakdowns || []).filter(
                (b: any) => b && typeof b.overallScore === 'number'
            );

            // Null, never 0, when nothing was measured. A study with no scored candidate has
            // no average score — printing 0 says every candidate scored zero.
            const avgScore: number | null = measured.length > 0
                ? Math.round(measured.reduce((sum: number, b: any) => sum + b.overallScore, 0) / measured.length)
                : null;

            return {
                id: s.id,
                config: JSON.parse(s.configJSON),
                candidateCount: sessions.length,
                completedCount: completed.length,
                // How many of the completed interviews the average actually covers, so the
                // figure cannot be read as describing the whole study.
                scoredCount: measured.length,
                averageScore: avgScore,
                createdAt: s.createdAt,
            };
        }));

        return NextResponse.json({ studies: studiesWithStats });
    } catch (error) {
        console.error('Error fetching interviewer studies:', error);
        return NextResponse.json({ error: 'Failed to fetch studies' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const interviewer = await getInterviewerUser();
    if (!interviewer) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const interviewerId = interviewer.id;

    try {
        const body = await request.json();
        let { config } = body;

        if (!config?.name) {
            return NextResponse.json({ error: 'Study config with name is required' }, { status: 400 });
        }

        // Enforce the plan's interview limit.
        const { limits } = resolveEffectivePlan(interviewer);
        const interviewsUsed = await db.study.count({ where: { userId: interviewerId } });
        if (interviewsUsed >= limits.maxInterviews) {
            return NextResponse.json(
                {
                    error: `You've reached your plan's limit of ${limits.maxInterviews} interview${limits.maxInterviews !== 1 ? 's' : ''}. Upgrade your plan to create more.`,
                    code: 'PLAN_LIMIT',
                },
                { status: 403 },
            );
        }

        config = withInterviewerAiConfig(config);
        const now = new Date();
        const study = await db.study.create({
            data: {
                userId: interviewerId,
                configJSON: JSON.stringify({
                    ...config,
                    createdAt: config.createdAt || now.getTime(),
                }),
                interviewCount: 0,
                isLocked: false,
                createdAt: now,
                updatedAt: now,
            },
        });

        const savedConfig = {
            ...config,
            id: study.id,
            createdAt: config.createdAt || now.getTime(),
        };

        return NextResponse.json({ study: { id: study.id, config: savedConfig } });
    } catch (error) {
        console.error('Error creating interviewer study:', error);
        return NextResponse.json({ error: 'Failed to create study' }, { status: 500 });
    }
}
