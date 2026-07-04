import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import supabaseDb from '@/lib/supabaseDb';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const denied = await requireAdmin();
    if (denied) return denied;

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
