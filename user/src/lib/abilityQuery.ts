import { apiFetch } from './apiClient';
import { revalidateQuery } from './queryCache';

export interface CompetencyAbility {
  competencyId: string;
  name: string;
  slug: string;
  theta: number;
  effectiveTheta: number;
  discount: number;
  standardError: number;
  scaleScore: number;
  confidenceInterval: { low: number; high: number };
  reliability: number;
  isPrecise: boolean;
  responsesUsed: number;
  limitingCompetencies: Array<{ competencyId: string; shortfall: number }>;
  updatedAt: string | null;
}

export interface AbilityProfile {
  userId: string;
  overall: {
    theta: number;
    standardError: number;
    scaleScore: number;
    confidenceInterval: { low: number; high: number };
    competencyCount: number;
    isPrecise: boolean;
  };
  competencies: CompetencyAbility[];
  improvementTargets: Array<{
    competencyId: string;
    gap: number;
    effectiveTheta: number;
    trustworthy: boolean;
  }>;
  measuredCount: number;
  targetStandardError: number;
}

export interface AbilityHistoryPoint {
  competencyId: string;
  theta: number;
  standardError: number;
  responsesUsed: number;
  recordedAt: string;
}

export interface AbilityPayload {
  profile: AbilityProfile | null;
  history: AbilityHistoryPoint[];
  error?: string;
}

export function abilityQueryKey(userId: string): string {
  return `/api/measurement/ability/${userId}`;
}

export async function fetchAbility(userId: string): Promise<AbilityPayload> {
  if (!userId) return { profile: null, history: [] };
  try {
    const res = await apiFetch(`/api/measurement/ability/${encodeURIComponent(userId)}?history=true`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { profile: null, history: [], error: data.error || 'Failed to load ability profile' };
    }
    const data = await res.json();
    return {
      profile: data.profile ?? null,
      history: data.history ?? [],
    };
  } catch {
    return { profile: null, history: [], error: 'Could not reach the measurement service.' };
  }
}

export function revalidateAbility(userId: string): void {
  if (!userId) return;
  void revalidateQuery(abilityQueryKey(userId), () => fetchAbility(userId));
}
