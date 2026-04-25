// GET  /api/interviewer/studies — List studies owned by logged-in interviewer
// POST /api/interviewer/studies — Create a new study (interview template)
// NOTE: Uses (prisma as any) casts because the Prisma client needs regeneration
// after the schema migration. Restart the dev server to fix type errors.
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import prisma from '@/lib/prisma';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const db = prisma as any;

async function getInterviewerId(): Promise<string | null> {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
        if (!token) return null;
        const session = await verifySessionToken(token);
        if (!session.valid || !session.researcherId) return null;
        const user = await db.user.findUnique({ where: { id: session.researcherId } });
        if (!user || user.role !== 'interviewer') return null;
        return user.id;
    } catch {
        return null;
    }
}

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
                    select: { id: true, averageScore: true, completedAt: true, candidateName: true, candidateEmail: true },
                },
            },
        });

        const studiesWithStats = studies.map((s: any) => {
            const sessions = s.interviewSessions || [];
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
    const interviewerId = await getInterviewerId();
    if (!interviewerId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { config } = body;

        if (!config?.name) {
            return NextResponse.json({ error: 'Study config with name is required' }, { status: 400 });
        }

        const study = await db.study.create({
            data: {
                userId: interviewerId,
                configJSON: JSON.stringify(config),
                interviewCount: 0,
            },
        });

        return NextResponse.json({ study: { id: study.id, config } });
    } catch (error) {
        console.error('Error creating interviewer study:', error);
        return NextResponse.json({ error: 'Failed to create study' }, { status: 500 });
    }
}
