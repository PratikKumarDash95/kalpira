// POST /api/candidate/billing/verify — verifies a Razorpay checkout callback and,
// on success, activates the candidate self-service plan for 30 days. Idempotent per
// order.
import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { getAuthUser } from '@/lib/accessControl';
import { CANDIDATE_PLAN_DURATION_MS, isCandidatePlanKey } from '@/lib/candidatePlans';
import { verifyPaymentSignature, PaymentError } from '@/lib/razorpay';

export const dynamic = 'force-dynamic';

const db = supabaseDb as any;

export async function POST(request: Request) {
    try {
        const authUser = await getAuthUser();
        if (!authUser?.id || authUser.role !== 'candidate') {
            return NextResponse.json({ error: 'Candidate login required' }, { status: 401 });
        }

        const body = await request.json();
        const orderId = typeof body?.razorpay_order_id === 'string' ? body.razorpay_order_id : '';
        const paymentId = typeof body?.razorpay_payment_id === 'string' ? body.razorpay_payment_id : '';
        const signature = typeof body?.razorpay_signature === 'string' ? body.razorpay_signature : '';

        if (!orderId || !paymentId || !signature) {
            return NextResponse.json({ error: 'Missing payment confirmation fields.' }, { status: 400 });
        }

        // The order must be one we created for this candidate.
        const payment = await db.payment.findFirst({ where: { razorpayOrderId: orderId } });
        if (!payment || payment.userId !== authUser.id) {
            return NextResponse.json({ error: 'Payment order not found.' }, { status: 404 });
        }

        const planKey = isCandidatePlanKey(payment.plan) ? payment.plan : 'free';
        if (planKey === 'free') {
            return NextResponse.json({ error: 'Invalid plan on payment order.' }, { status: 400 });
        }

        // Idempotency: if we already activated this order, just report the current state.
        if (payment.status === 'paid') {
            const fresh = await db.user.findUnique({ where: { id: authUser.id } });
            return NextResponse.json({ success: true, plan: fresh?.subscriptionPlan ?? planKey, planExpiresAt: fresh?.planExpiresAt ?? null });
        }

        const valid = verifyPaymentSignature({ orderId, paymentId, signature });
        if (!valid) {
            await db.payment.update({ where: { id: payment.id }, data: { status: 'failed', razorpayPaymentId: paymentId } });
            return NextResponse.json({ error: 'Payment verification failed.' }, { status: 400 });
        }

        const planExpiresAt = new Date(Date.now() + CANDIDATE_PLAN_DURATION_MS);

        await db.payment.update({
            where: { id: payment.id },
            data: { status: 'paid', razorpayPaymentId: paymentId },
        });

        await db.user.update({
            where: { id: authUser.id },
            data: { subscriptionPlan: planKey, planExpiresAt },
        });

        return NextResponse.json({ success: true, plan: planKey, planExpiresAt });
    } catch (error) {
        if (error instanceof PaymentError) {
            return NextResponse.json({ error: error.message }, { status: error.status || 502 });
        }
        console.error('Candidate verify payment error:', error);
        return NextResponse.json({ error: 'Failed to verify payment' }, { status: 500 });
    }
}
