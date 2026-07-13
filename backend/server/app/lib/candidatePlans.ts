// Candidate self-service subscription catalog — the single source of truth for how
// many things a candidate may create for THEMSELVES. Separate from the interviewer
// catalog (lib/plans.ts): interviewer plans gate assigned interviews, this gates a
// candidate's own self-studies and self-practices.
//
// IMPORTANT: interviewer-assigned interviews are always free for the candidate and
// are NOT counted here — they are InterviewSession rows owned by the interviewer,
// never Study rows owned by the candidate. Only a candidate's own Study rows count.
//
// The frontend has a display-only mirror (user/src/lib/candidatePlans.ts); the
// backend is authoritative for enforcement and for the amount charged on an order.

export type CandidatePlanKey = 'free' | 'plus' | 'pro' | 'max';

export interface CandidatePlanDefinition {
    key: CandidatePlanKey;
    label: string;
    maxStudies: number;    // max self-created Study rows (kind: 'study')
    maxPractices: number;  // max self-created practice runs (kind: 'practice')
    priceInPaise: number;  // 0 for the free trial (no payment)
}

export const CANDIDATE_PLANS: Record<CandidatePlanKey, CandidatePlanDefinition> = {
    free: { key: 'free', label: 'Trial', maxStudies: 1, maxPractices: 3, priceInPaise: 0 },
    plus: { key: 'plus', label: 'Plus', maxStudies: 5, maxPractices: 25, priceInPaise: 14900 },
    pro: { key: 'pro', label: 'Pro', maxStudies: 15, maxPractices: 75, priceInPaise: 34900 },
    max: { key: 'max', label: 'Max', maxStudies: 50, maxPractices: 300, priceInPaise: 69900 },
};

// A paid subscription is valid for 30 days per payment (monthly, renew by paying again).
export const CANDIDATE_PLAN_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export function isCandidatePlanKey(value: unknown): value is CandidatePlanKey {
    return value === 'free' || value === 'plus' || value === 'pro' || value === 'max';
}

export function isPaidCandidatePlan(key: CandidatePlanKey): boolean {
    return CANDIDATE_PLANS[key].priceInPaise > 0;
}

type PlanUser = {
    subscriptionPlan?: string | null;
    planExpiresAt?: Date | string | null;
};

export interface EffectiveCandidatePlan {
    planKey: CandidatePlanKey;
    limits: CandidatePlanDefinition;
    expiresAt: Date | null;
    isActive: boolean; // true when a paid plan is still within its validity window
}

// Resolves the plan actually in force for a candidate. A paid plan whose
// planExpiresAt has passed falls back to the free Trial limits. A value that is
// not a candidate plan key (e.g. an interviewer plan key, or null) also falls
// back to free — candidate and interviewer key spaces do not overlap.
export function resolveEffectiveCandidatePlan(user: PlanUser | null | undefined, now = Date.now()): EffectiveCandidatePlan {
    const stored = user?.subscriptionPlan;
    const storedKey: CandidatePlanKey = isCandidatePlanKey(stored) ? stored : 'free';

    if (storedKey === 'free') {
        return { planKey: 'free', limits: CANDIDATE_PLANS.free, expiresAt: null, isActive: false };
    }

    const expiresAtRaw = user?.planExpiresAt ?? null;
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
    const expired = !expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now;

    if (expired) {
        return { planKey: 'free', limits: CANDIDATE_PLANS.free, expiresAt, isActive: false };
    }

    return { planKey: storedKey, limits: CANDIDATE_PLANS[storedKey], expiresAt, isActive: true };
}
