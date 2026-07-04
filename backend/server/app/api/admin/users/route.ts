import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { hashPassword } from '@/lib/auth';
import supabaseDb from '@/lib/supabaseDb';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['candidate', 'interviewer', 'admin'] as const;
type AllowedRole = (typeof ALLOWED_ROLES)[number];

const userSelect = {
    id: true,
    name: true,
    email: true,
    role: true,
    oauthProvider: true,
    onboardingComplete: true,
    createdAt: true,
    _count: { select: { interviewSessions: true, studies: true } },
} as const;

// GET /api/admin/users?role=candidate — list users, optionally filtered by role.
export async function GET(request: Request) {
    const denied = await requireAdmin();
    if (denied) return denied;

    try {
        const { searchParams } = new URL(request.url);
        const role = searchParams.get('role');

        const where = role && ALLOWED_ROLES.includes(role as AllowedRole)
            ? { role }
            : undefined;

        const users = await supabaseDb.user.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            select: userSelect,
        });

        return NextResponse.json({ users });
    } catch (error) {
        console.error('Admin users error:', error);
        return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }
}

// POST /api/admin/users — create a new user/interviewer/admin account.
export async function POST(request: Request) {
    const denied = await requireAdmin();
    if (denied) return denied;

    try {
        const body = await request.json();
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        const role = body.role as string;

        if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
        }
        if (!password || password.length < 8) {
            return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
        }
        if (!ALLOWED_ROLES.includes(role as AllowedRole)) {
            return NextResponse.json({ error: 'Valid role is required' }, { status: 400 });
        }

        const existing = await supabaseDb.user.findUnique({ where: { email }, select: { id: true } });
        if (existing) {
            return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 });
        }

        const hashed = await hashPassword(password);
        const now = new Date();
        const user = await supabaseDb.user.create({
            data: {
                name: name || null,
                email,
                password: hashed,
                role,
                // Admin-created accounts are pre-verified so they can sign in immediately.
                emailVerifiedAt: now,
                onboardingComplete: false,
                createdAt: now,
                updatedAt: now,
            },
        });

        return NextResponse.json({
            success: true,
            user: { id: user.id, name: user.name, email: user.email, role: user.role },
        });
    } catch (error) {
        console.error('Admin create user error:', error);
        return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
    }
}

// PATCH /api/admin/users — edit an existing user (name/email/role).
export async function PATCH(request: Request) {
    const denied = await requireAdmin();
    if (denied) return denied;

    try {
        const body = await request.json();
        const userId = typeof body.userId === 'string' ? body.userId : '';
        if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });

        const updates: Record<string, unknown> = {};

        if (body.name !== undefined) {
            updates.name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
        }
        if (body.email !== undefined) {
            const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
            }
            const clash = await supabaseDb.user.findUnique({ where: { email }, select: { id: true } });
            if (clash && clash.id !== userId) {
                return NextResponse.json({ error: 'Another user already uses this email' }, { status: 409 });
            }
            updates.email = email;
        }
        if (body.role !== undefined) {
            if (!ALLOWED_ROLES.includes(body.role as AllowedRole)) {
                return NextResponse.json({ error: 'Valid role is required' }, { status: 400 });
            }
            updates.role = body.role;
        }

        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ error: 'No changes provided' }, { status: 400 });
        }

        const user = await supabaseDb.user.update({ where: { id: userId }, data: updates });
        return NextResponse.json({
            success: true,
            user: { id: user.id, name: user.name, email: user.email, role: user.role },
        });
    } catch (error) {
        console.error('Admin update user error:', error);
        return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
    }
}

// DELETE /api/admin/users — remove a user (cascades related records).
export async function DELETE(request: Request) {
    const denied = await requireAdmin();
    if (denied) return denied;

    try {
        const { userId } = await request.json();
        if (!userId) {
            return NextResponse.json({ error: 'userId is required' }, { status: 400 });
        }

        await supabaseDb.user.delete({ where: { id: userId } });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Admin delete user error:', error);
        return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
    }
}
