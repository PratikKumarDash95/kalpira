import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (!email) return NextResponse.json({ error: 'Email required' });

    try {
        // Cast to any to bypass stale client types until restart
        await (supabaseDb.user.update as any)({
            where: { email },
            data: { role: 'interviewer' },
        });
        return NextResponse.json({ success: true, message: `Updated ${email} to interviewer role` });
    } catch (e) {
        return NextResponse.json({ error: String(e) });
    }
}
