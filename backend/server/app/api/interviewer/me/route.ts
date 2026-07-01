// GET/PATCH /api/interviewer/me - Returns or updates current interviewer profile from DB
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import supabaseDb from '@/lib/supabaseDb';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type InterviewerUser = {
    id: string;
    name: string | null;
    email: string | null;
    role: string;
    avatarUrl: string | null;
    coverUrl: string | null;
    onboardingComplete: boolean;
    encryptedGeminiApiKey: string | null;
    encryptedAnthropicApiKey: string | null;
    createdAt: Date;
};

async function getInterviewer() {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

    const session = await verifySessionToken(token);
    if (!session.valid || !session.researcherId) {
        return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    }

    const user = await (supabaseDb.user.findUnique as any)({
        where: { id: session.researcherId },
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatarUrl: true,
            coverUrl: true,
            onboardingComplete: true,
            encryptedGeminiApiKey: true,
            encryptedAnthropicApiKey: true,
            createdAt: true,
        },
    }) as InterviewerUser | null;

    if (!user) return { error: NextResponse.json({ error: 'User not found' }, { status: 404 }) };
    if (user.role !== 'interviewer') return { error: NextResponse.json({ error: 'Not an interviewer account' }, { status: 403 }) };

    return { user };
}

function toProfile(user: InterviewerUser) {
    return {
        id: user.id,
        email: user.email || '',
        name: user.name || user.email || 'Interviewer',
        role: user.role,
        avatarUrl: user.avatarUrl,
        coverUrl: user.coverUrl,
        onboardingComplete: user.onboardingComplete,
        hasGeminiKey: !!user.encryptedGeminiApiKey,
        hasAnthropicKey: !!user.encryptedAnthropicApiKey,
        createdAt: user.createdAt,
    };
}

function validateHttpUrl(value: string, label: string): string | null {
    if (!value) return null;
    try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return `${label} URL must be http or https`;
        }
        return null;
    } catch {
        return `${label} URL is invalid`;
    }
}

export async function GET() {
    try {
        const result = await getInterviewer();
        if (result.error) return result.error;

        return NextResponse.json({ user: toProfile(result.user) });
    } catch (error) {
        console.error('Interviewer me error:', error);
        return NextResponse.json({ error: 'Failed to get profile' }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    try {
        const result = await getInterviewer();
        if (result.error) return result.error;

        const body = await request.json();
        const name = typeof body.name === 'string' ? body.name.trim() : undefined;
        const avatarUrl = typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() : undefined;
        const coverUrl = typeof body.coverUrl === 'string' ? body.coverUrl.trim() : undefined;

        if (name !== undefined && name.length === 0) {
            return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
        }

        const avatarError = avatarUrl !== undefined ? validateHttpUrl(avatarUrl, 'Avatar') : null;
        if (avatarError) return NextResponse.json({ error: avatarError }, { status: 400 });

        const coverError = coverUrl !== undefined ? validateHttpUrl(coverUrl, 'Cover') : null;
        if (coverError) return NextResponse.json({ error: coverError }, { status: 400 });

        const updates: { name?: string; avatarUrl?: string | null; coverUrl?: string | null } = {};
        if (name !== undefined) updates.name = name;
        if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl || null;
        if (coverUrl !== undefined) updates.coverUrl = coverUrl || null;

        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ error: 'No profile changes provided' }, { status: 400 });
        }

        const updated = await (supabaseDb.user.update as any)({
            where: { id: result.user.id },
            data: updates,
        }) as InterviewerUser;

        return NextResponse.json({ success: true, user: toProfile(updated) });
    } catch (error) {
        console.error('Interviewer profile update error:', error);
        return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
    }
}
