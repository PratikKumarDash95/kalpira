// POST /api/interviewer/register — Register a new interviewer account
import { NextResponse } from 'next/server';
import supabaseDb, { hasServiceRoleKey } from '@/lib/supabaseDb';
import { hashPassword } from '@/lib/auth';
import { createEmailVerificationToken, sendVerificationEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        if (!hasServiceRoleKey) {
            console.error('Interviewer registration error: SUPABASE_SERVICE_ROLE_KEY is required for server-side user creation.');
            return NextResponse.json(
                { error: 'Registration is not configured. Add SUPABASE_SERVICE_ROLE_KEY to user/.env.local.' },
                { status: 500 }
            );
        }

        const body = await request.json();
        const { email, password, name } = body;

        if (!email || !password || !name) {
            return NextResponse.json({ error: 'Name, email, and password are required' }, { status: 400 });
        }

        if (password.length < 6) {
            return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
        }

        const existingUser = await supabaseDb.user.findUnique({ where: { email } });
        if (existingUser) {
            return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
        }

        const trimmedEmail = email.trim().toLowerCase();
        const trimmedName = name.trim();
        const passwordHash = await hashPassword(password);
        const { rawToken, hashedToken } = createEmailVerificationToken();
        const now = new Date();

        const user = await supabaseDb.user.create({
            data: {
                email: trimmedEmail,
                password: passwordHash,
                name: trimmedName,
                role: 'interviewer',
                emailVerifiedAt: null,
                emailVerificationToken: hashedToken,
                emailVerificationSentAt: now,
                createdAt: now,
                updatedAt: now,
            },
        });

        await sendVerificationEmail({
            email: user.email,
            name: user.name,
            role: 'interviewer',
            token: rawToken,
        });

        return NextResponse.json({
            success: true,
            requiresVerification: true,
            message: 'Check your email for a verification link before signing in.',
            user: { id: user.id, email: user.email, name: user.name, role: user.role }
        });
    } catch (error) {
        console.error('Interviewer registration error:', error);
        return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 500 });
    }
}
