import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

async function isAdmin(): Promise<boolean> {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return false;
    const result = await verifySessionToken(token);
    return result.valid;
}

export async function GET() {
    if (!(await isAdmin())) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const sessions = await prisma.interviewSession.findMany({
            orderBy: { startedAt: 'desc' },
            take: 50,
            select: {
                id: true,
                startedAt: true,
                completedAt: true,
                averageScore: true,
                role: true,
                user: {
                    select: { name: true, email: true },
                },
            },
        });

        return NextResponse.json({ sessions });
    } catch (error) {
        console.error('Admin sessions error:', error);
        return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 });
    }
}
