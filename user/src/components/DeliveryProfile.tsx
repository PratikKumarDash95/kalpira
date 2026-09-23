'use client';

// ============================================
// DeliveryProfile.tsx — candidate delivery profile (Feature 2)
// ============================================
// The rolled-up half of the delivery analysis: every metric that has been measured
// about how this candidate speaks and presents, across every analysed answer, with
// the count of answers behind each one.
//
// Design rule for this screen, and the reason it looks the way it does:
//
//   · THERE IS NO DELIVERY SCORE HERE. Not in the header, not as a ring, not as a
//     single number to compare against someone else. There is no honest way to
//     collapse "spoke a little fast and paused twice" into one number about a
//     person, and a platform that produces one invites a hiring decision to be made
//     on it. The measurements are shown as measurements.
//
//   · EVERY MEAN SHOWS HOW MANY ANSWERS IT CAME FROM. "145 wpm, measured on 4 of 6
//     answers" is a different claim from "145 wpm", and the difference is exactly
//     what a reader needs in order to know how much to lean on it. A metric read
//     from a single answer is labelled as exactly that.
//
//   · A METRIC THAT WAS NOT MEASURED SAYS SO. Never a zero. A muted microphone and
//     a candidate who never spoke are different facts, and rendering the first as
//     the second would accuse someone of something they did not do.
//
// What is deliberately NOT on this screen: anything about how the candidate looks as
// a person. No face detection, no gaze, no "confidence rating". The video metrics it
// does show are properties of the picture — lighting, focus, framing — and are
// labelled as such.

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { AlertTriangle, ArrowRight, Info, Mic, BarChart3 } from 'lucide-react';
import PageShell from '@/components/layout/PageShell';
import PageHeader from '@/components/layout/PageHeader';
import PageSection from '@/components/layout/PageSection';
import EmptyState from '@/components/layout/EmptyState';
import { apiFetch } from '@/lib/apiClient';
import {
  aggregateVerdict,
  describeBand,
  domainFor,
  formatValue,
  trackFor,
  type MetricAggregate,
  type RegistryEntry,
} from '@/lib/deliveryFormat';

// --------------------------------------------
// Shapes returned by GET /api/delivery/profile
// --------------------------------------------

interface ProfileTrendPoint {
  sessionId: string;
  at: string;
  metrics: MetricAggregate[];
}

interface DeliveryProfileResponse {
  userId: string;
  aggregate: MetricAggregate[];
  trend: ProfileTrendPoint[];
  /** Sessions that produced at least one measurement. */
  analyzedCount: number;
  registry: RegistryEntry[];
}

// --------------------------------------------
// Component
// --------------------------------------------

export default function DeliveryProfile({ sessionId }: { sessionId?: string } = {}) {
  const router = useRouter();

  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<DeliveryProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);

  // Whose profile this is. Bare `/delivery` is the signed-in person's own; an
  // interviewer arrives with a session id and the server resolves who sat it,
  // refusing the request if the caller has no claim on that session. No account id
  // travels from the client either way.
  //
  // A signed-out visitor never reaches this component — RequireAuth replaces the
  // route before it renders — so a missing session is a fault, not something to
  // redirect for.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const meRes = await apiFetch('/api/auth/me');
        if (!meRes.ok) throw new Error(`auth/me responded ${meRes.status}`);
        const me = await meRes.json();
        if (!me?.profile?.id) throw new Error('no profile id in the session');
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) {
          setError('Could not load your account. Try signing in again.');
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    (async () => {
      try {
        const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
        const res = await apiFetch(`/api/delivery/profile${query}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (!cancelled) setError(data.error || 'Failed to load your delivery profile.');
          return;
        }
        const data: DeliveryProfileResponse = await res.json();
        if (cancelled) return;
        setProfile(data);
        // Default the trend to the metric with the most measurements behind it,
        // rather than to whatever happens to be first in the registry: the useful
        // default is the one with the most evidence, not the alphabetical one.
        const best = [...(data.aggregate ?? [])]
          .filter((metric) => metric.mean !== null)
          .sort((a, b) => b.measuredCount - a.measuredCount)[0];
        setSelectedMetric(best?.key ?? null);
      } catch {
        if (!cancelled) setError('Could not reach the delivery service.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [ready, sessionId]);

  const entryFor = useMemo(() => {
    const byKey = new Map((profile?.registry ?? []).map((entry) => [entry.key, entry]));
    return (key: string) => byKey.get(key);
  }, [profile]);

  /**
   * Groups the metrics by what each one was evidence about.
   *
   * Grouping by scoring dimension rather than by sensor is the honest presentation:
   * "these are the measurements that informed your communication score" is a claim
   * the candidate can check, whereas "audio metrics" tells them nothing about what
   * the numbers were used for. Informational metrics are separated out entirely,
   * because they were never allowed to move anything.
   */
  const groups = useMemo(() => {
    const aggregate = profile?.aggregate ?? [];
    const who = sessionId ? 'they were' : 'you were';
    const scored = (metric: MetricAggregate) => {
      const entry = entryFor(metric.key);
      return Boolean(entry && entry.feeds !== null && entry.maxImpact > 0 && entry.shape !== 'informational');
    };

    return [
      {
        id: 'communication',
        title: `How ${who} heard`,
        blurb:
          'Pace, fluency and clarity. These are communication norms, not competence — a deliberate pause while thinking is not a fault.',
        metrics: aggregate.filter((metric) => scored(metric) && entryFor(metric.key)?.feeds === 'communication'),
      },
      {
        id: 'confidence',
        title: `How ${who} came across`,
        blurb:
          'Pausing and vocal variation, read as evidence about steadiness. Every one of these is capped, so none of them can decide a score on its own.',
        metrics: aggregate.filter((metric) => scored(metric) && entryFor(metric.key)?.feeds === 'confidence'),
      },
      {
        id: 'informational',
        title: 'Recorded, never scored',
        blurb:
          'Measured and shown so you can see the conditions your answer was recorded under. None of these moved your score in either direction.',
        metrics: aggregate.filter((metric) => !scored(metric)),
      },
    ].filter((group) => group.metrics.length > 0);
  }, [profile, entryFor, sessionId]);

  /**
   * The trend, for one metric at a time.
   *
   * One metric per chart for the same reason the ability map plots one competency at
   * a time: these carry different units and different bands, so several lines on one
   * axis would invite a comparison that the data does not support.
   */
  const chart = useMemo(() => {
    if (!profile || !selectedMetric) return null;
    const entry = entryFor(selectedMetric);
    if (!entry) return null;

    const points = (profile.trend ?? [])
      .map((session) => {
        const metric = session.metrics.find((row) => row.key === selectedMetric);
        return {
          label: session.at
            ? new Date(session.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            : '—',
          value: metric?.mean ?? null,
          measuredCount: metric?.measuredCount ?? 0,
        };
      })
      // A session where this metric could not be measured has no point. Plotting a
      // zero there would draw a cliff that never happened.
      .filter((point) => point.value !== null);

    if (points.length < 2) return null;

    const { min, max, bandStart, bandEnd } = domainFor(entry);
    // A little air above and below, so a point sitting on the edge of the range is
    // visibly on the edge rather than flat against the frame.
    const pad = (max - min) * 0.08 || 1;

    return { entry, points, domain: [min - pad, max + pad] as [number, number], bandStart, bandEnd };
  }, [profile, selectedMetric, entryFor]);

  if (loading) {
    return (
      <PageShell width="wide">
        <div className="skeleton h-24 w-full rounded-2xl" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="skeleton-card h-44" />
          <div className="skeleton-card h-44" />
          <div className="skeleton-card h-44" />
        </div>
      </PageShell>
    );
  }

  const hasMeasurements = Boolean(profile && profile.analyzedCount > 0);
  const trendCandidates = (profile?.aggregate ?? []).filter((metric) => metric.mean !== null);

  // The same screen serves the candidate and, embedded, the interviewer looking at
  // them. Nothing measured differs between the two — but "you paused twice" is a
  // false statement about the person reading it when the reader is the interviewer,
  // so the few places that address a subject address the right one.
  const forSelf = !sessionId;

  return (
    <PageShell width="wide">
      <PageHeader
        title="Delivery profile"
        subtitle={
          forSelf
            ? 'What has been measured about how you speak and present — and how much of it there is.'
            : 'What has been measured about how this candidate speaks and presents — and how much of it there is.'
        }
        icon={<Mic size={18} />}
      />

      {error && (
        <div className="surface mb-6 flex items-start gap-3 border-l-4 border-l-[color:var(--danger)] p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[color:var(--danger)]" />
          <p className="text-sm text-[color:var(--text)]">{error}</p>
        </div>
      )}

      {!hasMeasurements ? (
        <EmptyState
          icon={<Mic size={28} />}
          title="Nothing measured yet"
          description={
            forSelf
              ? 'Delivery is measured while you answer — pace, pauses, fillers, and the quality of your picture. Take an interview with your microphone on and your profile will appear here. Nothing is recorded; the signals are read live and only the numbers are kept.'
              : 'No answer by this candidate has yielded a delivery measurement yet. That usually means the interview was typed, or taken without a microphone. Nothing is recorded — the signals are read live and only the numbers are kept.'
          }
          action={
            forSelf ? (
              <button type="button" onClick={() => router.push('/setup')} className="btn-primary">
                Start a practice interview <ArrowRight size={16} />
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* ---- What this is built from ---- */}
          <PageSection
            label="Coverage"
            title="What this profile is built from"
            description="Each figure below is an average of the answers it could actually be measured on. The count travels with every one of them."
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="stat-tile">
                <p className="stat-label">Sessions analysed</p>
                <p className="stat-value">{profile!.analyzedCount}</p>
                <p className="mt-1 text-xs text-[color:var(--muted)]">with at least one measurement</p>
              </div>

              <div className="stat-tile">
                <p className="stat-label">Metrics with a reading</p>
                <p className="stat-value">
                  {profile!.aggregate.filter((metric) => metric.mean !== null).length}
                  <span className="text-base font-medium text-[color:var(--muted)]">
                    {' '}/ {profile!.aggregate.length}
                  </span>
                </p>
                <p className="mt-1 text-xs text-[color:var(--muted)]">
                  the rest had nothing to measure
                </p>
              </div>

              <div className="stat-tile">
                <p className="stat-label">Fully measured</p>
                <p className="stat-value">
                  {profile!.aggregate.filter(
                    (metric) => metric.mean !== null && metric.measuredCount === metric.totalCount
                  ).length}
                </p>
                <p className="mt-1 text-xs text-[color:var(--muted)]">
                  read from every analysed answer
                </p>
              </div>

              <div className="stat-tile">
                <p className="stat-label">Thin evidence</p>
                <p className="stat-value">
                  {profile!.aggregate.filter((metric) => metric.measuredCount === 1).length}
                </p>
                <p className="mt-1 text-xs text-[color:var(--muted)]">
                  resting on a single answer
                </p>
              </div>
            </div>
          </PageSection>

          {/* ---- Per-metric groups ---- */}
          {groups.map((group) => (
            <PageSection key={group.id} label="Metrics" title={group.title} description={group.blurb}>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.metrics.map((metric) => (
                  <ProfileMetricCard
                    key={metric.key}
                    metric={metric}
                    entry={entryFor(metric.key)}
                    forSelf={forSelf}
                  />
                ))}
              </div>
            </PageSection>
          ))}

          {/* ---- Trend ---- */}
          {chart && (
            <PageSection
              label="Trend"
              title={`How ${chart.entry.label.toLowerCase()} has moved`}
              description="Each point is one interview's average for this metric. The shaded band is the healthy range — movement inside it is not progress, it is noise."
              actions={
                <div className="flex flex-wrap gap-2">
                  {trendCandidates.map((metric) => (
                    <button
                      key={metric.key}
                      type="button"
                      onClick={() => setSelectedMetric(metric.key)}
                      className={`chip ${
                        selectedMetric === metric.key
                          ? 'bg-[color:var(--brand-soft)] text-[color:var(--brand-strong)]'
                          : ''
                      }`}
                    >
                      {metric.label}
                    </button>
                  ))}
                </div>
              }
            >
              <div className="surface p-4">
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chart.points} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="var(--muted)" />
                      <YAxis
                        domain={chart.domain}
                        tick={{ fontSize: 12 }}
                        stroke="var(--muted)"
                        tickFormatter={(value: number) => formatValue(chart.entry.unit, value)}
                        width={80}
                      />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--surface)',
                          border: '1px solid var(--line)',
                          borderRadius: 12,
                          fontSize: 12,
                        }}
                        formatter={(value) => [
                          typeof value === 'number' ? formatValue(chart.entry.unit, value) : value,
                          chart.entry.label,
                        ]}
                      />
                      {/* The band, drawn on the same scale the value is plotted on — so
                          "inside the range" means the same thing in the chart as it does
                          on the card above it. */}
                      <ReferenceArea
                        y1={chart.bandStart}
                        y2={chart.bandEnd}
                        fill="var(--brand-soft)"
                        fillOpacity={0.35}
                        stroke="none"
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="var(--brand-strong)"
                        strokeWidth={2.5}
                        dot={{ r: 3 }}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-[color:var(--muted)]">
                  <Info size={13} />
                  {describeBand(chart.entry) ?? 'No healthy range is defined for this metric.'} ·{' '}
                  {chart.points.length} of {profile!.trend.length} sessions had a reading for it.
                </p>
              </div>
            </PageSection>
          )}

          {/* ---- What this screen refuses to do ---- */}
          <div className="surface-soft mt-2 flex items-start gap-3 p-4">
            <BarChart3 size={16} className="mt-0.5 shrink-0 text-[color:var(--brand-strong)]" />
            <p className="text-xs leading-relaxed text-[color:var(--muted)]">
              There is no delivery score on this page, and that is deliberate. Speaking rate, pauses
              and fillers are habits, not abilities, and they vary with the question, the language
              you think in, and whether you are tired. Every one of them is capped in how much it can
              move {forSelf ? 'your' : "a candidate's"} result, none of them can decide it, and none of
              them is a judgement about {forSelf ? 'you' : 'the person'}. If a figure here looks wrong
              for the answer it came from, the per-answer report shows the measurement underneath it.
            </p>
          </div>
        </>
      )}
    </PageShell>
  );
}

// --------------------------------------------
// Metric card
// --------------------------------------------

function ProfileMetricCard({
  metric,
  entry,
  forSelf,
}: {
  metric: MetricAggregate;
  entry?: RegistryEntry;
  forSelf: boolean;
}) {
  const verdict = aggregateVerdict(metric, entry);
  const track = entry && metric.mean !== null ? trackFor(entry, metric.mean) : null;
  const band = entry ? describeBand(entry) : null;

  return (
    <div className="surface flex flex-col p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-[color:var(--text)]" title={metric.label}>
            {metric.label}
          </p>
          <p className="text-xs text-[color:var(--muted)]">
            measured on {metric.measuredCount} of {metric.totalCount} answer
            {metric.totalCount === 1 ? '' : 's'}
          </p>
        </div>
        <span className={`badge ${verdict.tone} shrink-0`}>{verdict.label}</span>
      </div>

      {metric.mean === null ? (
        // Never a zero. A metric with no reading says so, and says what that means.
        <p className="mb-3 flex items-start gap-1.5 text-xs leading-relaxed text-[color:var(--muted)]">
          <Info size={13} className="mt-0.5 shrink-0" />
          Nothing was measured for this one — usually a muted microphone or an answer too short to
          read. It contributed nothing to {forSelf ? 'your' : "the candidate's"} score, in either
          direction.
        </p>
      ) : (
        <>
          <div className="mb-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-[color:var(--text)]">
              {formatValue(metric.unit, metric.mean)}
            </span>
          </div>

          {track && (
            <div className="relative mb-3 h-2 w-full overflow-hidden rounded-full bg-[color:var(--surface-soft)]">
              <div
                className="absolute inset-y-0 rounded-full bg-[color:var(--brand-soft)]"
                style={{ left: `${track.bandStart}%`, width: `${track.bandWidth}%` }}
              />
              <div
                className="absolute inset-y-0 w-1 rounded-full bg-[color:var(--brand-strong)]"
                style={{ left: `${Math.max(0, Math.min(99, track.marker))}%` }}
              />
            </div>
          )}

          {band && (
            <p className="mb-3 text-xs text-[color:var(--muted)]">
              {band}
              {track?.offScale && ' · well outside it'}
            </p>
          )}
        </>
      )}

      {entry && (
        <p className="mt-auto flex items-start gap-1.5 border-t border-[color:var(--line)] pt-3 text-xs leading-relaxed text-[color:var(--muted)]">
          <Info size={13} className="mt-0.5 shrink-0" />
          {entry.advice}
        </p>
      )}
    </div>
  );
}
