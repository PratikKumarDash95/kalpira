// GET /api/candidate/billing — current self-service subscription plan, limits and
// usage for the logged-in candidate. Usage is split into custom studies vs
// self-practices (the two separately-capped kinds). Interviewer-assigned interviews
// are InterviewSession rows and are never counted here.
import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/accessControl';
import supabaseDb from '@/lib/supabaseDb';
import { getAllStudies } from '@/lib/kv';
import { resolveEffectiveCandidatePlan } from '@/lib/candidatePlans';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const authUser = await getAuthUser();
        if (!authUser?.id || authUser.role !== 'candidate') {
            return NextResponse.json({ error: 'Candidate login required' }, { status: 401 });
        }

        const user = await supabaseDb.user.findUnique({ where: { id: authUser.id } });
        if (!user) {
            return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
        }

        const effective = resolveEffectiveCandidatePlan(user);

        // Split the candidate's own studies into custom-study vs self-practice.
        const own = await getAllStudies(user.id);
        let studiesUsed = 0;
        let practicesUsed = 0;
        for (const s of own) {
            if (s.config?.kind === 'practice') practicesUsed += 1;
            else studiesUsed += 1;
        }

        return NextResponse.json({
            plan: effective.planKey,
            planExpiresAt: effective.expiresAt,
            isActive: effective.isActive,
            limits: {
                maxStudies: effective.limits.maxStudies,
                maxPractices: effective.limits.maxPractices,
            },
            usage: { studiesUsed, practicesUsed },
        });
    } catch (error) {
        console.error('Candidate billing status error:', error);
        return NextResponse.json({ error: 'Failed to load billing status' }, { status: 500 });
    }
}
