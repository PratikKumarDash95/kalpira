import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';
import supabaseDb from '@/lib/supabaseDb';

export const dynamic = 'force-dynamic';

async function isAdmin(): Promise<boolean> {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return false;
    const result = await verifySessionToken(token);
    if (!result.valid || !result.researcherId) return false;
    const user = await supabaseDb.user.findUnique({
        where: { id: result.researcherId },
        select: { role: true },
    });
    return user?.role === 'admin';
}

export async function POST(request: Request) {
    if (!(await isAdmin())) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { email, role } = await request.json();
        if (!email || typeof email !== 'string') {
            return NextResponse.json({ error: 'Email required' }, { status: 400 });
        }
        const allowedRoles = ['candidate', 'interviewer', 'admin'];
        if (!role || !allowedRoles.includes(role)) {
            return NextResponse.json({ error: 'Valid role required' }, { status: 400 });
        }

        await (supabaseDb.user.update as any)({
            where: { email },
            data: { role },
        });
        return NextResponse.json({ success: true, message: `Updated ${email} to ${role} role` });
    } catch (e) {
        console.error('fix-role error:', e);
        return NextResponse.json({ error: 'Failed to update role' }, { status: 500 });
    }
}
