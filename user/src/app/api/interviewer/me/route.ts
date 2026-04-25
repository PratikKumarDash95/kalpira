// GET /api/interviewer/me — Returns current interviewer profile from DB
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import prisma from '@/lib/prisma';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
        if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const session = await verifySessionToken(token);
        if (!session.valid || !session.researcherId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await (prisma.user.findUnique as any)({
            where: { id: session.researcherId },
            select: { id: true, name: true, email: true, role: true, createdAt: true },
        }) as { id: string; name: string | null; email: string | null; role: string; createdAt: Date } | null;

        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
        if (user.role !== 'interviewer') return NextResponse.json({ error: 'Not an interviewer account' }, { status: 403 });

        return NextResponse.json({ user });
    } catch (error) {
        console.error('Interviewer me error:', error);
        return NextResponse.json({ error: 'Failed to get profile' }, { status: 500 });
    }
}
