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

        // Email is no longer globally unique (a candidate + interviewer may
        // share one). Resolve to a single row by id before updating; refuse if
        // the email is ambiguous so we never rewrite the wrong account.
        const matches = await supabaseDb.user.findMany({ where: { email }, select: { id: true, role: true } });
        if (matches.length === 0) {
            return NextResponse.json({ error: `No account found for ${email}` }, { status: 404 });
        }
        if (matches.length > 1) {
            return NextResponse.json(
                { error: `Multiple accounts share ${email} (${matches.map((m: { role: string }) => m.role).join(', ')}). Edit the specific account from the Users panel instead.` },
                { status: 409 }
            );
        }

        await supabaseDb.user.update({
            where: { id: matches[0].id },
            data: { role },
        });
        return NextResponse.json({ success: true, message: `Updated ${email} to ${role} role` });
    } catch (e) {
        console.error('fix-role error:', e);
        return NextResponse.json({ error: 'Failed to update role' }, { status: 500 });
    }
}
