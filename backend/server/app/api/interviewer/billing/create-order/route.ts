// POST /api/interviewer/billing/create-order — creates a Razorpay order for a paid
// plan and records a pending Payment row. The amount is computed server-side from
// the plan catalog; the client never supplies the price.
import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { getInterviewerUser } from '@/lib/interviewerAuth';
import { PLANS, isPlanKey, isPaidPlan } from '@/lib/plans';
import { createRazorpayOrder, getRazorpayKeyId, isRazorpayConfigured, PaymentError } from '@/lib/razorpay';

export const dynamic = 'force-dynamic';

const db = supabaseDb as any;

export async function POST(request: Request) {
    try {
        const user = await getInterviewerUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!isRazorpayConfigured()) {
            return NextResponse.json({ error: 'Payments are not configured. Please try again later.' }, { status: 503 });
        }

        const body = await request.json();
        const plan = body?.plan;

        if (!isPlanKey(plan) || !isPaidPlan(plan)) {
            return NextResponse.json({ error: 'Choose a valid paid plan.' }, { status: 400 });
        }

        const amount = PLANS[plan].priceInPaise;

        // receipt has a 40-char limit on Razorpay; keep it short and unique-ish.
        const receipt = `sub_${plan}_${user.id}`.slice(0, 40);
        const order = await createRazorpayOrder({
            amount,
            receipt,
            notes: { userId: user.id, plan },
        });

        await db.payment.create({
            data: {
                userId: user.id,
                plan,
                amount,
                currency: order.currency || 'INR',
                razorpayOrderId: order.id,
                status: 'created',
            },
        });

        return NextResponse.json({
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: getRazorpayKeyId(),
            plan,
        });
    } catch (error) {
        if (error instanceof PaymentError) {
            return NextResponse.json({ error: error.message }, { status: error.status || 502 });
        }
        console.error('Create order error:', error);
        return NextResponse.json({ error: 'Failed to create payment order' }, { status: 500 });
    }
}
