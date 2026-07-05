// Loads the Razorpay Checkout script on demand and exposes a typed handle.
// Razorpay attaches a global `Razorpay` constructor once checkout.js has loaded.

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

export interface RazorpayCheckoutOptions {
    key: string;
    order_id: string;
    amount: number;
    currency: string;
    name: string;
    description?: string;
    prefill?: { name?: string; email?: string };
    theme?: { color?: string };
    handler: (response: {
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
    }) => void;
    modal?: { ondismiss?: () => void };
}

interface RazorpayInstance {
    open: () => void;
    on: (event: string, callback: (response: unknown) => void) => void;
}

declare global {
    interface Window {
        Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayInstance;
    }
}

let loadPromise: Promise<void> | null = null;

export function loadRazorpayCheckout(): Promise<void> {
    if (typeof window === 'undefined') {
        return Promise.reject(new Error('Razorpay can only load in the browser.'));
    }
    if (window.Razorpay) return Promise.resolve();
    if (loadPromise) return loadPromise;

    loadPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
        if (existing) {
            existing.addEventListener('load', () => resolve());
            existing.addEventListener('error', () => reject(new Error('Failed to load Razorpay checkout.')));
            return;
        }
        const script = document.createElement('script');
        script.src = CHECKOUT_SRC;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => {
            loadPromise = null;
            reject(new Error('Failed to load Razorpay checkout.'));
        };
        document.body.appendChild(script);
    });

    return loadPromise;
}

export function openRazorpayCheckout(options: RazorpayCheckoutOptions): void {
    if (!window.Razorpay) throw new Error('Razorpay checkout is not loaded.');
    const instance = new window.Razorpay(options);
    instance.open();
}
