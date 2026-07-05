// GET /api/interviewer/billing — current subscription plan, limits and usage.
import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { getInterviewerUser } from '@/lib/interviewerAuth';
import { resolveEffectivePlan } from '@/lib/plans';

export const dynamic = 'force-dynamic';

const db = supabaseDb as any;

export async function GET() {
    try {
        const user = await getInterviewerUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const effective = resolveEffectivePlan(user);
        const interviewsUsed = await db.study.count({ where: { userId: user.id } });

        return NextResponse.json({
            plan: effective.planKey,
            planExpiresAt: effective.expiresAt,
            isActive: effective.isActive,
            limits: {
                maxInterviews: effective.limits.maxInterviews,
                maxStudentsPerInterview: effective.limits.maxStudentsPerInterview,
            },
            usage: { interviewsUsed },
        });
    } catch (error) {
        console.error('Billing status error:', error);
        return NextResponse.json({ error: 'Failed to load billing status' }, { status: 500 });
    }
}
