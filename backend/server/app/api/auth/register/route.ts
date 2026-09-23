// POST /api/auth/register - Researcher registration
import { NextResponse } from 'next/server';
import supabaseDb, { hasServiceRoleKey } from '@/lib/supabaseDb';
import { hashPassword } from '@/lib/auth';
import { createEmailVerificationToken, sendVerificationEmail } from '@/lib/email';
import { validatePasswordPolicy } from '@/lib/passwordPolicy';
import { BUDGETS, accountKey, checkBudget, penalize, tooManyRequests } from '@/lib/throttle';

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

        const passwordError = validatePasswordPolicy(password);
        if (passwordError) {
            return NextResponse.json(
                { error: passwordError },
                { status: 400 }
            );
        }

        // ── Sign-up budget for this address ──────────────────────────────────
        // This route both mints an account and sends a verification mail to an
        // address the caller chooses, so it is two abuse vectors in one: a free
        // account factory, and a second way to flood a stranger's inbox (the
        // first being resend-verification, which is budgeted the same way).
        //
        // Keyed per address rather than per connection, because the address is
        // the side that gets flooded; the per-IP limiter on /api/auth covers the
        // script that rotates through fresh addresses instead. Spent on every
        // request past validation, since the work — one row, one mail — is what
        // is being priced.
        const budgetKey = accountKey('register', 'candidate', trimmedEmail);
        const budget = checkBudget(budgetKey, BUDGETS.register);
        if (!budget.allowed) {
            return NextResponse.json(
                tooManyRequests(budget, 'Too many sign-up attempts for this email. Please try again later.'),
                { status: 429, headers: { 'Retry-After': String(budget.retryAfterSeconds) } }
            );
        }
        penalize(budgetKey, BUDGETS.register);

        // Check if a CANDIDATE account already exists for this email. The same
        // email may separately own an interviewer account, so scope by role.
        const existingUser = await supabaseDb.user.findFirst({
            where: { email: trimmedEmail, role: 'candidate' },
        });

        if (existingUser) {
            return NextResponse.json(
                { error: 'User with this email already exists' },
                { status: 409 }
            );
        }

        // Hash password
        const passwordHash = await hashPassword(password);

        const { rawToken, hashedToken } = createEmailVerificationToken();

        // Create user
        const now = new Date();
        const user = await supabaseDb.user.create({
            data: {
                email: trimmedEmail,
                password: passwordHash,
                name: trimmedName,
                avatarUrl: null,
                coverUrl: null,
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
            role: user.role === 'candidate' ? 'candidate' : 'researcher',
            token: rawToken,
        });

        return NextResponse.json({
            success: true,
            requiresVerification: true,
            message: 'Check your email for a verification link before signing in.',
            user: { id: user.id, email: user.email, name: user.name }
        });

    } catch (error) {
        console.error('Registration error:', error);
        return NextResponse.json(
            { error: 'Registration failed' },
            { status: 500 }
        );
    }
}
