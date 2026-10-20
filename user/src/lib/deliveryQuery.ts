import { apiFetch } from './apiClient';
import { revalidateQuery } from './queryCache';
import { deliveryProfileQueryKey } from './queryKeys';
import type { MetricAggregate, RegistryEntry } from './deliveryFormat';

export { deliveryProfileQueryKey };

export interface ProfileTrendPoint {
  sessionId: string;
  at: string;
  metrics: MetricAggregate[];
}

export interface DeliveryProfileResponse {
  userId: string;
  aggregate: MetricAggregate[];
  trend: ProfileTrendPoint[];
  analyzedCount: number;
  registry: RegistryEntry[];
}

export type DeliveryResult =
  | { ok: true; data: DeliveryProfileResponse }
  | { ok: false; error: string };

export async function fetchDeliveryProfile(sessionId?: string): Promise<DeliveryResult> {
  try {
    const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
    const res = await apiFetch(`/api/delivery/profile${query}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error || 'Failed to load your delivery profile.' };
    }
    return { ok: true, data: (await res.json()) as DeliveryProfileResponse };
  } catch {
    return { ok: false, error: 'Could not reach the delivery service.' };
  }
}

export function revalidateDeliveryProfile(sessionId?: string): void {
  void revalidateQuery(deliveryProfileQueryKey(sessionId), () => fetchDeliveryProfile(sessionId));
}
