import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import supabaseDb from '@/lib/supabaseDb';

export const dynamic = 'force-dynamic';

// GET /api/admin/users/[id] — full detail for a single user, with related records.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
    const denied = await requireAdmin();
    if (denied) return denied;

    try {
        const user = await supabaseDb.user.findUnique({ where: { id: params.id } });
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const [sessions, studies, badges, readiness] = await Promise.all([
            supabaseDb.interviewSession.findMany({
                where: { userId: params.id },
                orderBy: { startedAt: 'desc' },
                take: 25,
                select: { id: true, role: true, startedAt: true, completedAt: true, averageScore: true, mode: true },
            }),
            supabaseDb.study.findMany({
                where: { userId: params.id },
                orderBy: { createdAt: 'desc' },
                select: { id: true, configJSON: true, interviewCount: true, isLocked: true, createdAt: true },
            }),
            supabaseDb.badge.findMany({ where: { userId: params.id } }),
            supabaseDb.readinessIndex.findUnique({ where: { userId: params.id } }),
        ]);

        const studySummaries = studies.map((s: { id: string; configJSON: string; interviewCount: number; isLocked: boolean; createdAt: Date }) => {
            let name = 'Untitled study';
            try { name = JSON.parse(s.configJSON)?.name || name; } catch { /* keep default */ }
            return { id: s.id, name, interviewCount: s.interviewCount, isLocked: s.isLocked, createdAt: s.createdAt };
        });

        return NextResponse.json({
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role || 'candidate',
                oauthProvider: user.oauthProvider,
                onboardingComplete: user.onboardingComplete,
                emailVerifiedAt: user.emailVerifiedAt,
                avatarUrl: user.avatarUrl,
                createdAt: user.createdAt,
            },
            sessions,
            studies: studySummaries,
            badges,
            readinessScore: readiness?.readinessScore ?? null,
        });
    } catch (error) {
        console.error('Admin user detail error:', error);
        return NextResponse.json({ error: 'Failed to fetch user detail' }, { status: 500 });
    }
}
