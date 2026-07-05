'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, CheckCircle, CreditCard, Loader2, ShieldCheck, Sparkles, Users, XCircle } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { PLAN_CARDS, PLAN_LABELS, PlanKey } from '@/lib/plans';
import { loadRazorpayCheckout, openRazorpayCheckout } from '@/lib/razorpay';

interface BillingStatus {
    plan: PlanKey;
    planExpiresAt: string | null;
    isActive: boolean;
    limits: {
        maxInterviews: number;
        maxStudentsPerInterview: number;
    };
    usage: {
        interviewsUsed: number;
    };
}

interface ConfigStatus {
    hasRazorpayConfigured?: boolean;
}

interface CreateOrderResponse {
    orderId: string;
    amount: number;
    currency: string;
    keyId: string;
    plan: PlanKey;
    error?: string;
}

const formatExpiry = (value: string | null) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const InterviewerBilling: React.FC = () => {
    const router = useRouter();
    const pathname = usePathname();
    const isStandalonePortal = process.env.NEXT_PUBLIC_PORTAL === 'interviewer' || !pathname?.startsWith('/interviewer');
    const portalPath = (path: string) => isStandalonePortal ? path : `/interviewer${path}`;

    const [billing, setBilling] = useState<BillingStatus | null>(null);
    const [config, setConfig] = useState<ConfigStatus | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [buyingPlan, setBuyingPlan] = useState<PlanKey | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const loadBilling = async () => {
        const [billingRes, configRes] = await Promise.all([
            apiFetch('/api/interviewer/billing'),
            apiFetch('/api/config/status'),
        ]);

        if (billingRes.status === 401) {
            router.push(portalPath('/login'));
            return;
        }

        if (!billingRes.ok) {
            const data = await billingRes.json().catch(() => ({}));
            throw new Error(data.error || 'Failed to load billing.');
        }

        setBilling(await billingRes.json());
        if (configRes.ok) setConfig(await configRes.json());
    };

    useEffect(() => {
        loadBilling()
            .catch((error) => setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to load billing.' }))
            .finally(() => setIsLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router, isStandalonePortal]);

    const handleBuyPlan = async (plan: PlanKey) => {
        setBuyingPlan(plan);
        setMessage(null);

        try {
            const orderRes = await apiFetch('/api/interviewer/billing/create-order', {
                method: 'POST',
                body: JSON.stringify({ plan }),
            });
            const orderData = await orderRes.json().catch(() => ({})) as CreateOrderResponse;

            if (!orderRes.ok) {
                setMessage({ type: 'error', text: orderData.error || 'Could not start checkout.' });
                return;
            }

            await loadRazorpayCheckout();

            await new Promise<void>((resolve, reject) => {
                openRazorpayCheckout({
                    key: orderData.keyId,
                    order_id: orderData.orderId,
                    amount: orderData.amount,
                    currency: orderData.currency || 'INR',
                    name: 'Kalpira',
                    description: `${PLAN_LABELS[plan]} interviewer plan`,
                    prefill: {},
                    theme: { color: '#7c3aed' },
                    handler: async (response) => {
                        try {
                            const verifyRes = await apiFetch('/api/interviewer/billing/verify', {
                                method: 'POST',
                                body: JSON.stringify(response),
                            });
                            const verifyData = await verifyRes.json().catch(() => ({}));
                            if (!verifyRes.ok) {
                                reject(new Error(verifyData.error || 'Payment verification failed.'));
                                return;
                            }
                            setMessage({ type: 'success', text: `${PLAN_LABELS[plan]} is active for this account.` });
                            await loadBilling();
                            resolve();
                        } catch (error) {
                            reject(error);
                        }
                    },
                    modal: {
                        ondismiss: () => resolve(),
                    },
                });
            });
        } catch (error) {
            setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Checkout failed.' });
        } finally {
            setBuyingPlan(null);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <Loader2 size={36} className="animate-spin text-violet-400" />
            </div>
        );
    }

    const activePlan = billing?.plan || 'free';
    const expiresAt = formatExpiry(billing?.planExpiresAt || null);
    const paymentsEnabled = config?.hasRazorpayConfigured !== false;

    return (
        <div className="min-h-screen bg-slate-950 text-white">
            <div className="fixed inset-0 pointer-events-none bg-gradient-to-br from-violet-950/20 via-slate-950 to-indigo-950/10" />
            <main className="relative mx-auto max-w-6xl px-4 py-8">
                <button
                    onClick={() => router.push(portalPath('/dashboard'))}
                    className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-slate-200"
                >
                    <ArrowLeft size={16} /> Dashboard
                </button>

                <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div>
                        <p className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-violet-300">
                            <CreditCard size={14} /> Billing
                        </p>
                        <h1 className="text-3xl font-bold">Choose your interviewer plan</h1>
                        <p className="mt-2 max-w-2xl text-sm text-slate-400">
                            Your current plan is {PLAN_LABELS[activePlan]}. The backend enforces these limits when interviews and candidate seats are created.
                        </p>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                        <p className="text-xs uppercase tracking-wider text-slate-500">Current Usage</p>
                        <p className="mt-1 text-sm text-slate-300">
                            {billing?.usage.interviewsUsed ?? 0} / {billing?.limits.maxInterviews ?? 1} interviews
                        </p>
                        <p className="text-xs text-slate-500">
                            {billing?.limits.maxStudentsPerInterview ?? 5} candidates per interview
                        </p>
                    </div>
                </div>

                {message && (
                    <div className={`mb-6 flex items-center gap-3 rounded-2xl border p-4 ${message.type === 'success' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-red-500/20 bg-red-500/10 text-red-300'}`}>
                        {message.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
                        <p className="text-sm">{message.text}</p>
                    </div>
                )}

                {!paymentsEnabled && (
                    <div className="mb-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
                        Payments are not configured yet. Add the Razorpay keys on the backend to enable checkout.
                    </div>
                )}

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {PLAN_CARDS.map((plan, index) => {
                        const isCurrent = activePlan === plan.key;
                        const isPaid = plan.priceInRupees > 0;
                        return (
                            <motion.div
                                key={plan.key}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.04 }}
                                className={`flex min-h-[300px] flex-col rounded-2xl border p-5 ${isCurrent ? 'border-violet-500/50 bg-violet-500/10' : 'border-slate-800 bg-slate-900/70'}`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <h2 className="text-lg font-semibold">{plan.label}</h2>
                                        <p className="mt-1 text-xs text-slate-400">{plan.tagline}</p>
                                    </div>
                                    {isCurrent && (
                                        <span className="rounded-full bg-violet-500/20 px-2.5 py-1 text-xs text-violet-200">Active</span>
                                    )}
                                </div>

                                <div className="mt-5">
                                    <p className="text-3xl font-bold">
                                        {plan.priceInRupees === 0 ? 'Free' : `Rs ${plan.priceInRupees}`}
                                    </p>
                                    {isPaid && <p className="text-xs text-slate-500">Valid for 30 days</p>}
                                    {isCurrent && expiresAt && <p className="mt-1 text-xs text-slate-500">Expires {expiresAt}</p>}
                                </div>

                                <div className="mt-6 space-y-3 text-sm text-slate-300">
                                    <p className="flex items-center gap-2"><Sparkles size={15} className="text-violet-300" /> {plan.maxInterviews} interviews</p>
                                    <p className="flex items-center gap-2"><Users size={15} className="text-blue-300" /> {plan.maxStudentsPerInterview} candidates per interview</p>
                                    <p className="flex items-center gap-2"><ShieldCheck size={15} className="text-emerald-300" /> Server-enforced limits</p>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => handleBuyPlan(plan.key)}
                                    disabled={!isPaid || isCurrent || !paymentsEnabled || !!buyingPlan}
                                    className="mt-auto flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                                >
                                    {buyingPlan === plan.key ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />}
                                    {isCurrent ? 'Current Plan' : isPaid ? 'Upgrade' : 'Included'}
                                </button>
                            </motion.div>
                        );
                    })}
                </div>
            </main>
        </div>
    );
};

export default InterviewerBilling;
