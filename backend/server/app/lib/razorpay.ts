// Razorpay integration — order creation (Orders API) and payment signature
// verification. Mirrors the module-level-secret + require*Config() + typed-error
// pattern used by lib/email.ts. Uses native fetch + node crypto (no SDK).
import { createHmac, timingSafeEqual } from 'crypto';

const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;

export class PaymentError extends Error {
    readonly status?: number;

    constructor(message: string, status?: number) {
        super(message);
        this.name = 'PaymentError';
        this.status = status;
    }
}

export function isRazorpayConfigured(): boolean {
    return Boolean(razorpayKeyId && razorpayKeySecret);
}

export function getRazorpayKeyId(): string | undefined {
    return razorpayKeyId;
}

function requireRazorpayConfig() {
    if (!razorpayKeyId || !razorpayKeySecret) {
        throw new PaymentError(
            'Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.',
            503,
        );
    }
}

export interface RazorpayOrder {
    id: string;
    amount: number;
    currency: string;
    status: string;
}

export async function createRazorpayOrder(params: {
    amount: number; // in paise
    receipt: string;
    notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
    requireRazorpayConfig();

    const auth = Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString('base64');
    const response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({
            amount: params.amount,
            currency: 'INR',
            receipt: params.receipt,
            ...(params.notes ? { notes: params.notes } : {}),
        }),
    });

    if (!response.ok) {
        const data = await response.text().catch(() => '');
        throw new PaymentError(
            `Razorpay order creation failed (${response.status}): ${data || 'Unknown error'}`,
            response.status,
        );
    }

    const order = await response.json() as RazorpayOrder;
    return order;
}

// Verifies the checkout callback signature: HMAC_SHA256(order_id|payment_id, key_secret).
// Uses a constant-time comparison to avoid timing leaks.
export function verifyPaymentSignature(params: {
    orderId: string;
    paymentId: string;
    signature: string;
}): boolean {
    requireRazorpayConfig();

    const expected = createHmac('sha256', razorpayKeySecret!)
        .update(`${params.orderId}|${params.paymentId}`)
        .digest('hex');

    const expectedBuffer = Buffer.from(expected, 'utf8');
    const providedBuffer = Buffer.from(params.signature || '', 'utf8');

    if (expectedBuffer.length !== providedBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, providedBuffer);
}
