// Display-only mirror of the backend plan catalog (backend/server/app/lib/plans.ts).
// The backend is authoritative for enforcement and the amount charged; this exists
// only so the billing UI can render plan cards. Prices here are in rupees for display.

export type PlanKey = 'free' | 'starter' | 'pro' | 'max';

export interface PlanCard {
    key: PlanKey;
    label: string;
    maxInterviews: number;
    maxStudentsPerInterview: number;
    priceInRupees: number; // 0 = free
    tagline: string;
}

export const PLAN_CARDS: PlanCard[] = [
    { key: 'free', label: 'Trial', maxInterviews: 1, maxStudentsPerInterview: 5, priceInRupees: 0, tagline: 'Try it free' },
    { key: 'starter', label: 'Starter', maxInterviews: 2, maxStudentsPerInterview: 15, priceInRupees: 100, tagline: 'For small hiring rounds' },
    { key: 'pro', label: 'Pro', maxInterviews: 5, maxStudentsPerInterview: 40, priceInRupees: 250, tagline: 'For growing teams' },
    { key: 'max', label: 'Max', maxInterviews: 10, maxStudentsPerInterview: 60, priceInRupees: 500, tagline: 'For high-volume hiring' },
];

export const PLAN_LABELS: Record<PlanKey, string> = {
    free: 'Trial',
    starter: 'Starter',
    pro: 'Pro',
    max: 'Max',
};
