'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, BookOpen, CheckCircle, CreditCard, Dumbbell, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { CANDIDATE_PLAN_CARDS, CANDIDATE_PLAN_LABELS, CandidatePlanKey } from '@/lib/candidatePlans';
import { loadRazorpayCheckout, openRazorpayCheckout } from '@/lib/razorpay';

interface BillingStatus {
    plan: CandidatePlanKey;
    planExpiresAt: string | null;
    isActive: boolean;
    limits: {
        maxStudies: number;
        maxPractices: number;
    };
    usage: {
        studiesUsed: number;
        practicesUsed: number;
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
    plan: CandidatePlanKey;
    error?: string;
}

const formatExpiry = (value: string | null) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const CandidateBilling: React.FC = () => {
    const router = useRouter();

    const [billing, setBilling] = useState<BillingStatus | null>(null);
    const [config, setConfig] = useState<ConfigStatus | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [buyingPlan, setBuyingPlan] = useState<CandidatePlanKey | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const loadBilling = async () => {
        const [billingRes, configRes] = await Promise.all([
            apiFetch('/api/candidate/billing'),
            apiFetch('/api/config/status'),
        ]);

        if (billingRes.status === 401) {
            router.push('/login');
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
    }, [router]);

    const handleBuyPlan = async (plan: CandidatePlanKey) => {
        setBuyingPlan(plan);
        setMessage(null);

        try {
            const orderRes = await apiFetch('/api/candidate/billing/create-order', {
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
                    description: `${CANDIDATE_PLAN_LABELS[plan]} practice plan`,
                    prefill: {},
                    theme: { color: '#7c3aed' },
                    handler: async (response) => {
                        try {
                            const verifyRes = await apiFetch('/api/candidate/billing/verify', {
                                method: 'POST',
                                body: JSON.stringify(response),
                            });
                            const verifyData = await verifyRes.json().catch(() => ({}));
                            if (!verifyRes.ok) {
                                reject(new Error(verifyData.error || 'Payment verification failed.'));
                                return;
                            }
                            setMessage({ type: 'success', text: `${CANDIDATE_PLAN_LABELS[plan]} is active for your account.` });
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
                    onClick={() => router.push('/dashboard')}
                    className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-slate-200"
                >
                    <ArrowLeft size={16} /> Dashboard
                </button>

                <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div>
                        <p className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-violet-300">
                            <CreditCard size={14} /> Subscription
                        </p>
                        <h1 className="text-3xl font-bold">Choose your practice plan</h1>
                        <p className="mt-2 max-w-2xl text-sm text-slate-400">
                            Your current plan is {CANDIDATE_PLAN_LABELS[activePlan]}. Your plan sets how many
                            custom studies and self-practice sessions you can create. Interviews assigned to
                            you by an interviewer are always free and don&apos;t count.
                        </p>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                        <p className="text-xs uppercase tracking-wider text-slate-500">Current Usage</p>
                        <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-300">
                            <BookOpen size={14} className="text-violet-300" />
                            {billing?.usage.studiesUsed ?? 0} / {billing?.limits.maxStudies ?? 1} studies
                        </p>
                        <p className="flex items-center gap-1.5 text-sm text-slate-300">
                            <Dumbbell size={14} className="text-blue-300" />
                            {billing?.usage.practicesUsed ?? 0} / {billing?.limits.maxPractices ?? 3} practices
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
                    {CANDIDATE_PLAN_CARDS.map((plan, index) => {
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
                                    <p className="flex items-center gap-2"><BookOpen size={15} className="text-violet-300" /> {plan.maxStudies} custom studies</p>
                                    <p className="flex items-center gap-2"><Dumbbell size={15} className="text-blue-300" /> {plan.maxPractices} practice sessions</p>
                                    <p className="flex items-center gap-2"><ShieldCheck size={15} className="text-emerald-300" /> Runs on platform AI</p>
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

export default CandidateBilling;
