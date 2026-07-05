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

        const studiesWithStats = studies.map((s: any) => {
            // Exclude the interviewer's own self-preview / self-practice runs so the
            // dashboard candidate count matches the real candidate list on the detail page.
            const sessions = excludeSelfPreviewSessions(s.interviewSessions || []);
            const completed = sessions.filter((sess: any) => sess.completedAt);
            const avgScore = completed.length > 0
                ? completed.reduce((sum: number, sess: any) => sum + sess.averageScore, 0) / completed.length
                : 0;
            return {
                id: s.id,
                config: JSON.parse(s.configJSON),
                candidateCount: sessions.length,
                completedCount: completed.length,
                averageScore: Math.round(avgScore),
                createdAt: s.createdAt,
            };
        });

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
