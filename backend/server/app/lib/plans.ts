// Interviewer subscription plan catalog — the single source of truth for limits
// and prices. The frontend has a display-only mirror (user/src/lib/plans.ts); the
// backend is authoritative for enforcement and for the amount charged on an order.

export type PlanKey = 'free' | 'starter' | 'pro' | 'max';

export interface PlanDefinition {
    key: PlanKey;
    label: string;
    maxInterviews: number;          // max Study rows the interviewer may own
    maxStudentsPerInterview: number; // max assigned candidates per study
    priceInPaise: number;           // 0 for the free trial (no payment)
}

export const PLANS: Record<PlanKey, PlanDefinition> = {
    free: { key: 'free', label: 'Trial', maxInterviews: 1, maxStudentsPerInterview: 5, priceInPaise: 0 },
    starter: { key: 'starter', label: 'Starter', maxInterviews: 2, maxStudentsPerInterview: 15, priceInPaise: 10000 },
    pro: { key: 'pro', label: 'Pro', maxInterviews: 5, maxStudentsPerInterview: 40, priceInPaise: 25000 },
    max: { key: 'max', label: 'Max', maxInterviews: 10, maxStudentsPerInterview: 60, priceInPaise: 50000 },
};

// A paid subscription is valid for 30 days per payment (monthly, renew by paying again).
export const PLAN_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export function isPlanKey(value: unknown): value is PlanKey {
    return value === 'free' || value === 'starter' || value === 'pro' || value === 'max';
}

export function isPaidPlan(key: PlanKey): boolean {
    return PLANS[key].priceInPaise > 0;
}

type PlanUser = {
    subscriptionPlan?: string | null;
    planExpiresAt?: Date | string | null;
};

export interface EffectivePlan {
    planKey: PlanKey;
    limits: PlanDefinition;
    expiresAt: Date | null;
    isActive: boolean; // true when a paid plan is still within its validity window
}

// Resolves the plan actually in force for a user. A paid plan whose planExpiresAt
// has passed falls back to the free Trial limits.
export function resolveEffectivePlan(user: PlanUser | null | undefined, now = Date.now()): EffectivePlan {
    const stored = user?.subscriptionPlan;
    const storedKey: PlanKey = isPlanKey(stored) ? stored : 'free';

    if (storedKey === 'free') {
        return { planKey: 'free', limits: PLANS.free, expiresAt: null, isActive: false };
    }

    const expiresAtRaw = user?.planExpiresAt ?? null;
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
    const expired = !expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now;

    if (expired) {
        return { planKey: 'free', limits: PLANS.free, expiresAt, isActive: false };
    }

    return { planKey: storedKey, limits: PLANS[storedKey], expiresAt, isActive: true };
}
