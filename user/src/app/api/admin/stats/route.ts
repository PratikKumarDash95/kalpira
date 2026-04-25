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
        const [totalUsers, totalStudies, totalSessions, recentUsers] = await Promise.all([
            prisma.user.count(),
            prisma.study.count(),
            prisma.interviewSession.count(),
            prisma.user.findMany({
                orderBy: { createdAt: 'desc' },
                take: 5,
                select: { id: true, name: true, email: true, createdAt: true },
            }),
        ]);

        return NextResponse.json({
            totalUsers,
            totalStudies,
            totalSessions,
            recentUsers,
        });
    } catch (error) {
        console.error('Admin stats error:', error);
        return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
    }
}
