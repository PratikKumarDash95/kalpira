// Display-only mirror of the backend candidate plan catalog
// (backend/server/app/lib/candidatePlans.ts). The backend is authoritative for
// enforcement and the amount charged; this exists only so the subscription UI can
// render plan cards. Prices here are in rupees for display.

export type CandidatePlanKey = 'free' | 'plus' | 'pro' | 'max';

export interface CandidatePlanCard {
    key: CandidatePlanKey;
    label: string;
    maxStudies: number;
    maxPractices: number;
    priceInRupees: number; // 0 = free
    tagline: string;
}

export const CANDIDATE_PLAN_CARDS: CandidatePlanCard[] = [
    { key: 'free', label: 'Trial', maxStudies: 1, maxPractices: 3, priceInRupees: 0, tagline: 'Try it free' },
    { key: 'plus', label: 'Plus', maxStudies: 5, maxPractices: 25, priceInRupees: 149, tagline: 'For steady prep' },
    { key: 'pro', label: 'Pro', maxStudies: 15, maxPractices: 75, priceInRupees: 349, tagline: 'For serious practice' },
    { key: 'max', label: 'Max', maxStudies: 50, maxPractices: 300, priceInRupees: 699, tagline: 'For power users' },
];

export const CANDIDATE_PLAN_LABELS: Record<CandidatePlanKey, string> = {
    free: 'Trial',
    plus: 'Plus',
    pro: 'Pro',
    max: 'Max',
};
