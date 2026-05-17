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

        // Check if user already exists
        const existingUser = await supabaseDb.user.findUnique({
            where: { email },
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
                email,
                password: passwordHash, // We store the hashed password (salt:hash) here
                name,
                createdAt: now,
                updatedAt: now,
                // In hosted mode, we might want to flag standalone accounts differently, 
                // but for now, we treat password-based users as standalone/admin equivalents in the context of authentication.
                // However, Supabase schema comment says "Hashed password for standalone mode".
                // We are enabling it generally for this feature request.
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
