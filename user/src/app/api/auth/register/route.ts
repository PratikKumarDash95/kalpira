// POST /api/auth/register - Researcher registration
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import supabaseDb, { hasServiceRoleKey } from '@/lib/supabaseDb';
import { createSessionToken, getSessionCookieOptions, SESSION_COOKIE_NAME, hashPassword } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        if (!hasServiceRoleKey) {
            console.error('Registration error: SUPABASE_SERVICE_ROLE_KEY is required for server-side user creation.');
            return NextResponse.json(
                { error: 'Registration is not configured. Add SUPABASE_SERVICE_ROLE_KEY to user/.env.local.' },
                { status: 500 }
            );
        }

        const body = await request.json();
        const { email, password, name } = body;

        if (!email || !password || !name) {
            return NextResponse.json(
                { error: 'Email, password, and name are required' },
                { status: 400 }
            );
        }

        if (typeof email !== 'string' || typeof password !== 'string' || typeof name !== 'string') {
            return NextResponse.json(
                { error: 'Email, password, and name must be strings' },
                { status: 400 }
            );
        }

        const trimmedEmail = email.trim().toLowerCase();
        const trimmedName = name.trim();

        // Email format check
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(trimmedEmail)) {
            return NextResponse.json(
                { error: 'Please enter a valid email address' },
                { status: 400 }
            );
        }

        if (trimmedName.length < 1 || trimmedName.length > 100) {
            return NextResponse.json(
                { error: 'Name must be between 1 and 100 characters' },
                { status: 400 }
            );
        }

        if (password.length < 8) {
            return NextResponse.json(
                { error: 'Password must be at least 8 characters' },
                { status: 400 }
            );
        }

        if (password.length > 256) {
            return NextResponse.json(
                { error: 'Password is too long' },
                { status: 400 }
            );
        }

        // Check if user already exists
        const existingUser = await supabaseDb.user.findUnique({
            where: { email: trimmedEmail },
        });

        if (existingUser) {
            return NextResponse.json(
                { error: 'User with this email already exists' },
                { status: 409 }
            );
        }

        // Hash password
        const passwordHash = await hashPassword(password);

        // Create user
        const now = new Date();
        const user = await supabaseDb.user.create({
            data: {
                email: trimmedEmail,
                password: passwordHash,
                name: trimmedName,
                avatarUrl: null,
                coverUrl: null,
                createdAt: now,
                updatedAt: now,
            },
        });

        // Create session token
        // For password users, we use their ID as the researcherId payload
        const sessionToken = await createSessionToken(user.id);

        // Set cookie
        const cookieStore = await cookies();
        cookieStore.set(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions());

        return NextResponse.json({ success: true, user: { id: user.id, email: user.email, name: user.name } });

    } catch (error) {
        console.error('Registration error:', error);
        return NextResponse.json(
            { error: 'Registration failed' },
            { status: 500 }
        );
    }
}
