'use client';

// ============================================
// AbilityMap.tsx — Candidate ability profile (Feature 1)
// ============================================
// The visible half of the Competency Measurement Engine.
//
// Design rule for this screen: every number shows its evidence. An ability score
// without its confidence interval invites a candidate to read a measurement as a
// verdict — so the interval, the response count, and a plain "not measured
// precisely yet" state are all first-class parts of the card, not footnotes.
//
// What this screen deliberately does NOT show: a single "you are 72" headline
// over an empty profile. A candidate with no history sees what unlocks it.

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, CheckCircle2, Info, Target, TrendingUp,
} from 'lucide-react';
import PageShell from '@/components/layout/PageShell';
import PageHeader from '@/components/layout/PageHeader';
import PageSection from '@/components/layout/PageSection';
import EmptyState from '@/components/layout/EmptyState';
import { apiFetch } from '@/lib/apiClient';

// --------------------------------------------
// Shapes returned by GET /api/measurement/ability/:userId
// --------------------------------------------

interface CompetencyAbility {
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

interface AbilityProfile {
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

interface AbilityHistoryPoint {
  competencyId: string;
  theta: number;
  standardError: number;
  responsesUsed: number;
  recordedAt: string;
}

// --------------------------------------------
// Presentation helpers
// --------------------------------------------

/** θ on the logit scale to the 0-100 display scale (T-score: mean 50, SD 10). */
function toScale(theta: number): number {
  return Math.round(Math.max(0, Math.min(100, 50 + 10 * theta)) * 10) / 10;
}

/** Describes a scale score in words, so the number is not the only signal. */
function bandLabel(scaleScore: number): { label: string; tone: string } {
  if (scaleScore >= 70) return { label: 'Strong', tone: 'badge-success' };
  if (scaleScore >= 55) return { label: 'Above level', tone: 'badge-brand' };
  if (scaleScore >= 45) return { label: 'At level', tone: 'badge-brand' };
  if (scaleScore >= 30) return { label: 'Developing', tone: 'badge-warn' };
  return { label: 'Needs work', tone: 'badge-warn' };
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

// --------------------------------------------
// Component
// --------------------------------------------

export default function AbilityMap() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<AbilityProfile | null>(null);
  const [history, setHistory] = useState<AbilityHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCompetency, setSelectedCompetency] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);

  // Resolve the signed-in candidate, then load their profile. The id comes from
  // /api/auth/me because the measurement endpoints are keyed by user id.
  //
  // A signed-out visitor never reaches this component — RequireAuth replaces the
  // route before it renders — so a missing id here is a real fault rather than
  // something to redirect for.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const meRes = await apiFetch('/api/auth/me');
        if (!meRes.ok) throw new Error(`auth/me responded ${meRes.status}`);
        const me = await meRes.json();
        const id = me?.profile?.id;
        if (!id) throw new Error('no profile id in the session');
        if (!cancelled) setUserId(id);
      } catch {
        if (!cancelled) {
          setError('Could not load your account. Try signing in again.');
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await apiFetch(`/api/measurement/ability/${userId}?history=true`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (!cancelled) setError(data.error || 'Failed to load your ability profile.');
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setProfile(data.profile);
        setHistory(data.history ?? []);
        setSelectedCompetency(data.profile?.competencies?.[0]?.competencyId ?? null);
      } catch {
        if (!cancelled) setError('Could not reach the measurement service.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  /** Re-runs estimation over the full history, then reloads the profile. */
  const handleRecompute = async () => {
    if (!userId) return;
    setRecomputing(true);
    setError(null);
    try {
      const res = await apiFetch('/api/measurement/recompute', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not refresh your estimates.');
        return;
      }

      const reload = await apiFetch(`/api/measurement/ability/${userId}?history=true`);
      if (reload.ok) {
        const data = await reload.json();
        setProfile(data.profile);
        setHistory(data.history ?? []);
      }
    } catch {
      setError('Could not refresh your estimates.');
    } finally {
      setRecomputing(false);
    }
  };

  // The trajectory chart plots one competency: several overlapping lines on one
  // axis would imply the competencies share a scale, which they do not.
  const chartData = useMemo(() => {
    if (!selectedCompetency) return [];
    return history
      .filter((point) => point.competencyId === selectedCompetency)
      .map((point) => ({
        recordedAt: point.recordedAt,
        label: new Date(point.recordedAt).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        }),
        scale: toScale(point.theta),
        // The band a candidate should read as "still uncertain": ±1 SE.
        upper: toScale(point.theta + point.standardError),
        lower: toScale(point.theta - point.standardError),
      }));
  }, [history, selectedCompetency]);

  if (loading) {
    return (
      <PageShell width="wide">
        <div className="skeleton h-24 w-full rounded-2xl" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="skeleton-card h-48" />
          <div className="skeleton-card h-48" />
          <div className="skeleton-card h-48" />
        </div>
      </PageShell>
    );
  }

  const hasMeasurements = Boolean(profile && profile.measuredCount > 0);

  return (
    <PageShell width="wide">
      <PageHeader
        title="Ability map"
        subtitle="What you have been measured on — and how confident that measurement is."
        icon={<Activity size={18} />}
        actions={
          hasMeasurements ? (
            <button
              type="button"
              onClick={handleRecompute}
              disabled={recomputing}
              className="btn-secondary"
            >
              <TrendingUp size={16} />
              {recomputing ? 'Refreshing…' : 'Refresh estimates'}
            </button>
          ) : undefined
        }
      />

      {error && (
        <div className="surface mb-6 flex items-start gap-3 border-l-4 border-l-[color:var(--danger)] p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[color:var(--danger)]" />
          <p className="text-sm text-[color:var(--text)]">{error}</p>
        </div>
      )}

      {!hasMeasurements ? (
        <EmptyState
          icon={<Target size={28} />}
          title="Nothing measured yet"
          description="Your ability estimates are built from your interview answers. Complete a practice interview and your competency map will appear here — with a confidence interval, not just a score."
          action={
            <button type="button" onClick={() => router.push('/setup')} className="btn-primary">
              Start a practice interview <ArrowRight size={16} />
            </button>
          }
        />
      ) : (
        <>
          {/* ---- Overall ---- */}
          <PageSection
            label="Overall"
            title="Where you stand"
            description={
              profile!.overall.isPrecise
                ? 'Every competency below is measured precisely enough to act on.'
                : 'Some competencies still have wide confidence intervals — treat those as provisional.'
            }
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="stat-tile">
                <p className="stat-label">Overall ability</p>
                <p className="stat-value">{Math.round(profile!.overall.scaleScore)}</p>
                <p className="mt-1 text-xs text-[color:var(--muted)]">
                  95% CI {Math.round(toScale(profile!.overall.confidenceInterval.low))}–
                  {Math.round(toScale(profile!.overall.confidenceInterval.high))}
                </p>
              </div>

              <div className="stat-tile">
                <p className="stat-label">Competencies measured</p>
                <p className="stat-value">{profile!.measuredCount}</p>
                <p className="mt-1 text-xs text-[color:var(--muted)]">
                  {profile!.competencies.filter((c) => c.isPrecise).length} precise enough to act on
                </p>
              </div>

              <div className="stat-tile">
                <p className="stat-label">Measurement error</p>
                <p className="stat-value">±{profile!.overall.standardError.toFixed(2)}</p>
                <p className="mt-1 text-xs text-[color:var(--muted)]">
                  logit units; target {profile!.targetStandardError.toFixed(2)}
                </p>
              </div>

              <div className="stat-tile">
                <p className="stat-label">Priority to work on</p>
                <p className="stat-value">
                  {profile!.improvementTargets.filter((t) => t.trustworthy).length}
                </p>
                <p className="mt-1 text-xs text-[color:var(--muted)]">
                  gaps with enough evidence to trust
                </p>
              </div>
            </div>
          </PageSection>

          {/* ---- Per competency ---- */}
          <PageSection
            label="Competencies"
            title="Your ability map"
            description="Each competency is measured independently. The bar shows the 95% confidence interval — the wider it is, the less we know."
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {profile!.competencies.map((competency) => (
                <CompetencyCard key={competency.competencyId} competency={competency} />
              ))}
            </div>
          </PageSection>

          {/* ---- Improvement targets ---- */}
          {profile!.improvementTargets.length > 0 && (
            <PageSection
              label="Next"
              title="What to work on"
              description="Ranked by the size of the gap, with estimates too noisy to trust pushed down."
            >
              <div className="surface divide-y divide-[color:var(--line)]">
                {profile!.improvementTargets.slice(0, 6).map((target) => {
                  const competency = profile!.competencies.find(
                    (c) => c.competencyId === target.competencyId
                  );
                  return (
                    <div
                      key={target.competencyId}
                      className="flex flex-wrap items-center justify-between gap-3 p-4"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-[color:var(--text)]">
                          {competency?.name ?? 'Competency'}
                        </p>
                        <p className="text-sm text-[color:var(--muted)]">
                          {target.gap.toFixed(2)} logits below your strongest area
                          {!target.trustworthy && ' · estimate still too noisy to act on'}
                        </p>
                      </div>
                      <span className={`badge ${target.trustworthy ? 'badge-warn' : 'badge'}`}>
                        {target.trustworthy ? 'Worth prioritising' : 'Provisional'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </PageSection>
          )}

          {/* ---- Trajectory ---- */}
          {chartData.length > 1 && (
            <PageSection
              label="Trajectory"
              title="How this has moved"
              description="Each point is one estimate. The shaded band is ±1 standard error — movement inside it is noise, not progress."
              actions={
                <div className="flex flex-wrap gap-2">
                  {profile!.competencies.map((competency) => (
                    <button
                      key={competency.competencyId}
                      type="button"
                      onClick={() => setSelectedCompetency(competency.competencyId)}
                      className={`chip ${
                        selectedCompetency === competency.competencyId
                          ? 'bg-[color:var(--brand-soft)] text-[color:var(--brand-strong)]'
                          : ''
                      }`}
                    >
                      {competency.name}
                    </button>
                  ))}
                </div>
              }
            >
              <div className="surface p-4">
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="var(--muted)" />
                      <YAxis
                        domain={[0, 100]}
                        tick={{ fontSize: 12 }}
                        stroke="var(--muted)"
                        label={{ value: 'Scale score', angle: -90, position: 'insideLeft', fontSize: 11 }}
                      />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--surface)',
                          border: '1px solid var(--line)',
                          borderRadius: 12,
                          fontSize: 12,
                        }}
                        formatter={(value, name) => [
                          typeof value === 'number' ? Math.round(value) : value,
                          name === 'scale' ? 'Ability' : name === 'upper' ? 'Upper bound' : 'Lower bound',
                        ]}
                      />
                      {/* 50 is the population mean — the line a candidate should read as "at level". */}
                      <ReferenceLine y={50} stroke="var(--muted)" strokeDasharray="4 4" />
                      <Line
                        type="monotone"
                        dataKey="upper"
                        stroke="var(--brand-strong)"
                        strokeOpacity={0.25}
                        strokeWidth={1}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="lower"
                        stroke="var(--brand-strong)"
                        strokeOpacity={0.25}
                        strokeWidth={1}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="scale"
                        stroke="var(--brand-strong)"
                        strokeWidth={2.5}
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-[color:var(--muted)]">
                  <Info size={13} />
                  The dashed line at 50 is the population average.
                </p>
              </div>
            </PageSection>
          )}

          {/* ---- Method note ---- */}
          <div className="surface-soft mt-2 flex items-start gap-3 p-4">
            <BarChart3 size={16} className="mt-0.5 shrink-0 text-[color:var(--brand-strong)]" />
            <p className="text-xs leading-relaxed text-[color:var(--muted)]">
              These estimates come from item response theory — the same family of measurement used
              by standardised tests. Each question carries a calibrated difficulty and
              discrimination, and your ability is estimated from your pattern of answers. The
              confidence interval is reported because a measurement without its uncertainty is not
              a measurement. Scores describe performance on the questions you were asked, not your
              worth as an engineer.
            </p>
          </div>
        </>
      )}
    </PageShell>
  );
}

// --------------------------------------------
// Competency card
// --------------------------------------------

function CompetencyCard({ competency }: { competency: CompetencyAbility }) {
  const band = bandLabel(competency.scaleScore);
  const low = toScale(competency.confidenceInterval.low);
  const high = toScale(competency.confidenceInterval.high);
  const reliable = competency.reliability >= 0.7;

  return (
    <div className="surface flex flex-col p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-[color:var(--text)]" title={competency.name}>
            {competency.name}
          </p>
          <p className="text-xs text-[color:var(--muted)]">
            {competency.responsesUsed} answer{competency.responsesUsed === 1 ? '' : 's'} measured
          </p>
        </div>
        <span className={`badge ${band.tone} shrink-0`}>{band.label}</span>
      </div>

      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums text-[color:var(--text)]">
          {Math.round(competency.scaleScore)}
        </span>
        <span className="text-xs text-[color:var(--muted)]">
          ±{Math.round((high - low) / 2)}
        </span>
      </div>

      {/* Interval bar: the visual argument that this is an estimate, not a fact. */}
      <div className="relative mb-3 h-2 w-full overflow-hidden rounded-full bg-[color:var(--surface-soft)]">
        <div
          className="absolute inset-y-0 rounded-full bg-[color:var(--brand-soft)]"
          style={{ left: `${low}%`, width: `${Math.max(2, high - low)}%` }}
        />
        <div
          className="absolute inset-y-0 w-1 rounded-full bg-[color:var(--brand-strong)]"
          style={{ left: `${Math.max(0, Math.min(99, competency.scaleScore))}%` }}
        />
      </div>

      <p className="mb-3 text-xs text-[color:var(--muted)]">
        95% CI {Math.round(low)}–{Math.round(high)} · reliability {formatPercent(competency.reliability)}
      </p>

      {!competency.isPrecise && (
        <p className="mb-2 flex items-start gap-1.5 text-xs text-[color:var(--muted)]">
          <Info size={13} className="mt-0.5 shrink-0" />
          Not precise enough to act on yet — more answers will narrow this.
        </p>
      )}

      {competency.limitingCompetencies.length > 0 && (
        <p className="mt-auto flex items-start gap-1.5 border-t border-[color:var(--line)] pt-3 text-xs text-[color:var(--muted)]">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-[color:var(--brand-strong)]" />
          <span>
            Held back by {competency.limitingCompetencies.length} prerequisite
            {competency.limitingCompetencies.length === 1 ? '' : 's'}
            {competency.discount > 0.05 && ` · discounted ${competency.discount.toFixed(2)} logits`}
          </span>
        </p>
      )}

      {reliable && competency.isPrecise && competency.limitingCompetencies.length === 0 && (
        <p className="mt-auto flex items-center gap-1.5 border-t border-[color:var(--line)] pt-3 text-xs text-[color:var(--muted)]">
          <CheckCircle2 size={13} className="shrink-0 text-[color:var(--brand-strong)]" />
          Stable measurement
        </p>
      )}
    </div>
  );
}
