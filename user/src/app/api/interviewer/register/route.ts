// POST /api/interviewer/register — Register a new interviewer account
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import prisma from '@/lib/prisma';
import { createSessionToken, getSessionCookieOptions, SESSION_COOKIE_NAME, hashPassword } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { email, password, name } = body;

        if (!email || !password || !name) {
            return NextResponse.json({ error: 'Name, email, and password are required' }, { status: 400 });
        }

        if (password.length < 6) {
            return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
        }

        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
        }

        const passwordHash = await hashPassword(password);

        const user = await prisma.user.create({
            data: { email, password: passwordHash, name, role: 'interviewer' },
        });

        const sessionToken = await createSessionToken(user.id);
        const cookieStore = await cookies();
        cookieStore.set(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions());

        return NextResponse.json({ success: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
    } catch (error) {
        console.error('Interviewer registration error:', error);
        return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 500 });
    }
}
