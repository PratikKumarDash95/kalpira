'use client';

// ============================================
// DeliveryReport.tsx — Candidate delivery evidence (Feature 2)
// ============================================
//
// The visible half of Multimodal Delivery Analysis. It shows a candidate what was
// measured about *how* they answered — pace, pauses, vocal variation, picture
// quality — and what those measurements did to their score.
//
// THE DESIGN RULE, WHICH IS THE SAME ONE THE SCORING FOLLOWS
//
// Every number shows its band. A bare "168 wpm" invites the reader to decide
// whether that is bad; "168 wpm, healthy 110–160" is a fact they can actually act
// on. So each metric is drawn as a position on a track with the healthy range
// shaded in, and the sentence the server produced for that specific value sits
// underneath it.
//
// THREE THINGS THIS SCREEN REFUSES TO DO
//
//   · It never shows a 0 for a metric that was not measured. The server marks those
//     `measured: false` and this renders them as "not measured", with the reason it
//     gives. A missing measurement and a bad measurement are different facts.
//   · It never shows a single composite delivery score. There is no honest way to
//     collapse "spoke a little fast and paused twice" into one number about a
//     person, so the screen shows the measurements and the score movement they
//     caused — separately, and each with its reason.
//   · It never hides a caveat. Automatic gain control, a covered camera, a browser
//     that could not sample the microphone — all of it is shown above the numbers
//     rather than below them, because it changes how much the numbers mean.
//
// Read-only. Everything here comes from GET /api/sessions/[id]/delivery, which
// returns the analysis that was actually used to score the answer.

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity, AlertTriangle, CheckCircle2, Eye, Gauge, Info, Mic, MinusCircle,
  ScanFace, TrendingDown, TrendingUp,
} from 'lucide-react';
import PageShell from '@/components/layout/PageShell';
import PageHeader from '@/components/layout/PageHeader';
import PageSection from '@/components/layout/PageSection';
import EmptyState from '@/components/layout/EmptyState';
import { apiFetch } from '@/lib/apiClient';
import {
  describeBand,
  formatValue,
  trackFor,
  type MetricAggregate,
  type MetricShape,
  type MetricSource,
  type MetricUnit,
  type RegistryEntry,
} from '@/lib/deliveryFormat';

// --------------------------------------------
// Shapes returned by GET /api/sessions/[id]/delivery
// --------------------------------------------

interface MetricRow {
  key: string;
  label: string;
  unit: MetricUnit;
  value: number | null;
  position: number;
  impact: number;
  inBand: boolean;
  measured: boolean;
  source: MetricSource;
  explanation: string;
}

interface DimensionAdjustment {
  dimension: 'communication' | 'confidence';
  before: number;
  after: number;
  delta: number;
  rawDelta: number;
  cappedBy: number;
}

interface DeliveryTimeline {
  points: number[];
  intervalMs: number;
  speechSegments: Array<{ startMs: number; endMs: number }>;
  pauseThresholdMs: number;
  totalMs: number;
  truncated: boolean;
}

interface StoredFusion {
  version: number;
  applied: boolean;
  reason: string | null;
  communication: DimensionAdjustment;
  confidence: DimensionAdjustment;
  caveats: string[];
  captureIssues: string[];
  unmeasured: string[];
  /** Absent for answers analysed before the contour was stored, and for silent ones. */
  timeline?: DeliveryTimeline | null;
  analyzedAt: string;
}

interface ResponseView {
  responseId: string;
  questionText: string | null;
  answerPreview: string;
  metrics: MetricRow[];
  fusion: StoredFusion | null;
  jobStatus: 'queued' | 'running' | 'succeeded' | 'failed' | 'none';
  jobError: string | null;
}

/**
 * The server's own account of how the word-based metrics count.
 *
 * This travels with the response rather than being written here because it is the
 * definition the numbers were computed against. Copying it into the client would
 * let the two drift, and the whole point of the panel is that a candidate can check
 * what was counted.
 */
interface LexicalDisclosure {
  fillers: string[];
  hedges: string[];
  observedOnly: string[];
  excluded: Array<{ word: string; reason: string }>;
}

interface SessionDelivery {
  sessionId: string;
  responses: ResponseView[];
  aggregate: MetricAggregate[];
  analyzedCount: number;
  responseCount: number;
  caveats: string[];
  captureIssues: string[];
  registry: RegistryEntry[];
  disclosure: LexicalDisclosure;
  settings: {
    pauseThresholdMs: number;
    minSpeechForRateMs: number;
    envelopeSampleIntervalMs: number;
    maxAdjustment: number;
    minScorableMetrics: number;
  };
}

const SOURCE_GROUPS: Array<{ source: MetricSource; title: string; blurb: string }> = [  {
    source: 'audio',
    title: 'How you spoke',
    blurb: 'Pace, pauses and vocal variation, read from the loudness of the room.',
  },
  {
    source: 'lexical',
    title: 'Your words',
    blurb: 'Fillers and hedging, counted from the transcript.',
  },
  {
    source: 'video',
    title: 'Your picture',
    blurb: 'Image quality and framing, read from the camera. Nothing here is a judgement about you.',
  },
];

// --------------------------------------------
// The answer, drawn
// --------------------------------------------

/**
 * How many bars to draw, whatever the answer's length.
 *
 * The stored contour is one point per half-second, which is 1,900 bars for a
 * sixteen-minute answer — more DOM than a phone wants in order to show a shape that
 * is a few hundred pixels wide. The bars are averaged down to fit the picture; the
 * speech spans are drawn from the full-precision data, so nothing about where the
 * pauses were is lost to this.
 */
const MAX_BARS = 220;

function downsample(points: number[], target: number): number[] {
  if (points.length <= target) return points;
  const bucket = points.length / target;
  const out: number[] = [];
  for (let i = 0; i < target; i += 1) {
    const start = Math.floor(i * bucket);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucket));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end && j < points.length; j += 1) {
      sum += points[j];
      count += 1;
    }
    out.push(count > 0 ? sum / count : 0);
  }
  return out;
}

/**
 * The answer as a loudness contour, with the detected speech shaded in.
 *
 * This is the one place a candidate sees the measurement rather than a number
 * derived from it, and it is the fastest way to make the rest of the screen
 * legible: "you paused once for 2.1 seconds" lands differently when the gap is
 * visible underneath where in the answer it happened.
 */
function DeliveryStrip({ timeline }: { timeline: DeliveryTimeline }) {
  const bars = useMemo(() => downsample(timeline.points, MAX_BARS), [timeline.points]);
  const peak = useMemo(() => Math.max(...bars, 0.0001), [bars]);
  const total = timeline.totalMs || 1;

  // The pauses, recovered from the span boundaries. Drawn rather than listed, and
  // derived from the same spans the pause metric came from — so the two cannot
  // disagree about how long a gap was.
  const pauses = useMemo(() => {
    const gaps: Array<{ startMs: number; endMs: number }> = [];
    for (let i = 1; i < timeline.speechSegments.length; i += 1) {
      const start = timeline.speechSegments[i - 1].endMs;
      const end = timeline.speechSegments[i].startMs;
      if (end - start >= timeline.pauseThresholdMs) gaps.push({ startMs: start, endMs: end });
    }
    return gaps;
  }, [timeline.speechSegments, timeline.pauseThresholdMs]);

  const longest = pauses.reduce(
    (best, gap) => Math.max(best, gap.endMs - gap.startMs),
    0
  );

  return (
    <div className="surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-[color:var(--text)]">Your answer, second by second</p>
        <p className="text-xs text-[color:var(--muted)]">
          {timeline.speechSegments.length} stretch
          {timeline.speechSegments.length === 1 ? '' : 'es'} of speech
          {pauses.length > 0 && ` · ${pauses.length} pause${pauses.length === 1 ? '' : 's'}`}
          {longest > 0 && `, longest ${(longest / 1000).toFixed(1)}s`}
        </p>
      </div>

      {/* Speech shading sits behind the bars: it says where you were talking, the
          bars say how loudly — two different facts, one picture. */}
      <div className="relative mt-3 h-20 w-full overflow-hidden rounded-lg bg-[color:var(--surface-soft)]">
        {timeline.speechSegments.map((segment, index) => (
          <div
            key={index}
            className="absolute inset-y-0 bg-[color:var(--brand-soft)]"
            style={{
              left: `${(segment.startMs / total) * 100}%`,
              width: `${Math.max(0.4, ((segment.endMs - segment.startMs) / total) * 100)}%`,
            }}
          />
        ))}

        <div className="absolute inset-0 flex items-end gap-px px-px">
          {bars.map((value, index) => (
            <div
              key={index}
              className="min-w-px flex-1 rounded-t-sm bg-[color:var(--brand-strong)]"
              style={{ height: `${Math.max(1.5, (value / peak) * 96)}%`, opacity: value > 0 ? 0.75 : 0.2 }}
            />
          ))}
        </div>
      </div>

      <div className="mt-1.5 flex justify-between text-[10px] text-[color:var(--muted)]">
        <span>0s</span>
        <span>{Math.round(total / 2000)}s</span>
        <span>{Math.round(total / 1000)}s</span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-[color:var(--muted)]">
        Shaded stretches are where speech was detected; the gaps between them are the silences that
        were counted as pauses, at {timeline.pauseThresholdMs}ms or more. Loudness is sampled every
        half-second, so this is the shape of the answer rather than a recording of it.
      </p>

      {timeline.truncated && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-[color:var(--warn)]">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          This answer was long enough that the picture shows only its beginning. The measurements
          above cover the whole of it.
        </p>
      )}
    </div>
  );
}

// --------------------------------------------
// Metric rendering
// --------------------------------------------

function MetricCard({ metric, entry }: { metric: MetricRow; entry?: RegistryEntry }) {
  const band = entry ? describeBand(entry) : null;
  const track = entry && metric.measured && metric.value !== null ? trackFor(entry, metric.value) : null;

  return (
    <div className="rounded-xl border border-[color:var(--line)] p-3.5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-[color:var(--text)]">{metric.label}</p>
        <span
          className={`badge shrink-0 ${
            !metric.measured ? 'badge' : metric.inBand ? 'badge-success' : 'badge-warn'
          }`}
        >
          {!metric.measured ? 'Not measured' : metric.inBand ? 'In range' : 'Outside range'}
        </span>
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums text-[color:var(--text)]">
          {metric.measured && metric.value !== null ? formatValue(metric.unit, metric.value) : '—'}
        </span>
        {band && <span className="text-xs text-[color:var(--muted)]">{band}</span>}
      </div>

      {track && (
        <div className="relative mt-2.5 h-2 w-full rounded-full bg-[color:var(--line)]">
          {/* The healthy range, drawn rather than described. */}
          <div
            className="absolute inset-y-0 rounded-full bg-[color:var(--brand-soft)]"
            style={{ left: `${track.bandStart}%`, width: `${track.bandWidth}%` }}
          />
          <div
            className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[color:var(--surface)] ${
              metric.inBand ? 'bg-[color:var(--brand-strong)]' : 'bg-[color:var(--warn)]'
            }`}
            style={{ left: `${track.marker}%` }}
            aria-hidden
          />
        </div>
      )}

      <p className="mt-2.5 text-xs leading-relaxed text-[color:var(--muted)]">{metric.explanation}</p>

      {metric.measured && entry && !metric.inBand && (
        <p className="mt-2 text-xs leading-relaxed text-[color:var(--text)]">
          <span className="font-medium">What would help: </span>
          {entry.advice}
        </p>
      )}

      {/* Only shown when a metric actually moved something. A row that says
          "0.0 points" on all thirteen metrics trains the reader to ignore the one
          that did not. */}
      {metric.measured && metric.impact !== 0 && (
        <p className="mt-2 text-xs text-[color:var(--muted)]">
          {metric.impact > 0 ? 'Added' : 'Subtracted'}{' '}
          <span className="font-medium tabular-nums text-[color:var(--text)]">
            {Math.abs(metric.impact).toFixed(1)}
          </span>{' '}
          points
          {entry?.feeds && ` ${entry.feeds === 'confidence' ? 'of confidence' : 'of communication'}`}
        </p>
      )}
    </div>
  );
}

/** One dimension's movement, with the arithmetic shown rather than implied. */
function AdjustmentCard({
  title,
  adjustment,
  applied,
  reason,
  maxAdjustment,
}: {
  title: string;
  adjustment: DimensionAdjustment;
  applied: boolean;
  reason: string | null;
  maxAdjustment: number;
}) {
  const up = adjustment.delta > 0;
  const flat = adjustment.delta === 0;
  const capped = Math.abs(adjustment.rawDelta) > Math.abs(adjustment.delta) + 0.05;

  return (
    <div className="surface p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-[color:var(--text)]">{title}</p>
        {flat ? (
          <span className="badge">
            <MinusCircle size={12} /> Unchanged
          </span>
        ) : (
          <span className={`badge ${up ? 'badge-success' : 'badge-warn'}`}>
            {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {up ? '+' : ''}
            {adjustment.delta.toFixed(1)}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-baseline gap-2 tabular-nums">
        <span className="text-2xl font-semibold text-[color:var(--muted)]">
          {Math.round(adjustment.before)}
        </span>
        <span className="text-[color:var(--muted)]">→</span>
        <span className="text-2xl font-semibold text-[color:var(--text)]">
          {Math.round(adjustment.after)}
        </span>
        <span className="text-xs text-[color:var(--muted)]">out of 100</span>
      </div>

      {!applied && (
        <p className="mt-3 text-xs leading-relaxed text-[color:var(--muted)]">
          <Info size={12} className="mr-1 inline" />
          {reason ?? 'There was not enough delivery evidence to adjust this score.'}
        </p>
      )}

      {applied && capped && (
        // The cap is not a footnote. Without it on screen, the individual
        // contributions below would appear not to add up to the movement above.
        <p className="mt-3 text-xs leading-relaxed text-[color:var(--muted)]">
          The measurements added up to {adjustment.rawDelta > 0 ? '+' : ''}
          {adjustment.rawDelta.toFixed(1)}, and delivery evidence is capped at ±{maxAdjustment} points
          {' '}({adjustment.cappedBy.toFixed(1)} was not applied).
        </p>
      )}
    </div>
  );
}

// --------------------------------------------
// Component
// --------------------------------------------

export default function DeliveryReport({ sessionId }: { sessionId: string }) {
  const router = useRouter();

  const [data, setData] = useState<SessionDelivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await apiFetch(`/api/sessions/${sessionId}/delivery`);
        if (!response.ok) throw new Error(`delivery responded ${response.status}`);
        const payload = await response.json();
        if (!cancelled) setData(payload as SessionDelivery);
      } catch {
        if (!cancelled) setError('Could not load the delivery report for this interview.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const registryByKey = useMemo(() => {
    const map = new Map<string, RegistryEntry>();
    for (const entry of data?.registry ?? []) map.set(entry.key, entry);
    return map;
  }, [data]);

  const analysed = useMemo(
    () => (data?.responses ?? []).filter((response) => response.metrics.length > 0),
    [data]
  );

  const measuredTotal = useMemo(
    () =>
      analysed.reduce(
        (sum, response) => sum + response.metrics.filter((metric) => metric.measured).length,
        0
      ),
    [analysed]
  );

  if (loading) {
    return (
      <PageShell>
        <PageHeader title="Delivery report" subtitle="Loading the measurements for this interview…" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-24 rounded-xl" />
          ))}
        </div>
      </PageShell>
    );
  }

  if (error || !data) {
    return (
      <PageShell>
        <PageHeader title="Delivery report" subtitle="Measurements from your interview" />
        <EmptyState
          icon={<AlertTriangle size={28} />}
          title="Could not load this report"
          description={error ?? 'The report was not available.'}
          action={
            <button type="button" onClick={() => router.push('/dashboard')} className="btn-primary">
              Back to dashboard
            </button>
          }
        />
      </PageShell>
    );
  }

  const current = analysed[selected] ?? null;

  return (
    <PageShell>
      <PageHeader
        title="How you delivered it"
        subtitle="What was measured about the way you answered — and what it changed. These are measurements, not a verdict on you."
      />

      {analysed.length === 0 ? (
        <EmptyState
          icon={<Activity size={28} />}
          title="Nothing was measured for this interview"
          // The distinction matters: "the camera and microphone were not used" is a
          // fact about the session, "the analysis failed" is a fault worth reporting.
          description={
            data.responseCount === 0
              ? 'This interview has no saved answers yet, so there is nothing to measure.'
              : 'Your answers were saved, but no audio or video was captured for them. An interview taken by typing, or with the microphone and camera declined, is scored on its words alone.'
          }
          action={
            <button type="button" onClick={() => router.push('/ability')} className="btn-primary">
              See your ability map
            </button>
          }
        />
      ) : (
        <>
          {/* ---- Overview ---- */}
          <PageSection
            label="Overview"
            title="What was analysed"
            description="Metrics are only counted where there was something to measure. An answer given by typing has no audio to read."
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="stat-tile">
                <p className="stat-label">Answers analysed</p>
                <p className="stat-value">
                  {data.analyzedCount}
                  <span className="text-base font-normal text-[color:var(--muted)]">
                    {' '}
                    of {data.responseCount}
                  </span>
                </p>
                <p className="mt-1 text-xs text-[color:var(--muted)]">
                  the rest had no capture to analyse
                </p>
              </div>
              <div className="stat-tile">
                <p className="stat-label">Measurements taken</p>
                <p className="stat-value">{measuredTotal}</p>
                <p className="mt-1 text-xs text-[color:var(--muted)]">
                  across {analysed.length} answer{analysed.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="stat-tile">
                <p className="stat-label">Score movement</p>
                <p className="stat-value tabular-nums">
                  {(() => {
                    const fused = analysed.find((response) => response.fusion?.applied)?.fusion;
                    if (!fused) return '0.0';
                    const total = fused.communication.delta + fused.confidence.delta;
                    return `${total > 0 ? '+' : ''}${total.toFixed(1)}`;
                  })()}
                </p>
                <p className="mt-1 text-xs text-[color:var(--muted)]">
                  from the most recent analysed answer
                </p>
              </div>
            </div>
          </PageSection>

          {/* ---- Caveats, above the numbers on purpose ---- */}
          {(data.caveats.length > 0 || data.captureIssues.length > 0) && (
            <PageSection
              label="Before you read the numbers"
              title="Things that limit what these figures mean"
              description="These are conditions of the recording, not faults of yours. Each one is why a number may read differently from how the answer actually came across."
            >
              <div className="surface divide-y divide-[color:var(--line)]">
                {[...data.captureIssues, ...data.caveats].map((note, index) => (
                  <div key={index} className="flex items-start gap-3 p-4">
                    <Info size={16} className="mt-0.5 shrink-0 text-[color:var(--muted)]" />
                    <p className="text-sm leading-relaxed text-[color:var(--text)]">{note}</p>
                  </div>
                ))}
              </div>
            </PageSection>
          )}

          {/* ---- Score movement ---- */}
          {analysed.some((response) => response.fusion) && (
            <PageSection
              label="Score"
              title="What the delivery evidence changed"
              description="Your score starts from what you said. These are the only movements the delivery measurements made to it, and delivery evidence alone can never move a score by more than a few points."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {(['communication', 'confidence'] as const).map((dimension) => {
                  const withFusion = analysed.filter((response) => response.fusion);
                  const latest = withFusion[withFusion.length - 1]?.fusion;
                  if (!latest) return null;
                  return (
                    <AdjustmentCard
                      key={dimension}
                      title={dimension === 'communication' ? 'Communication' : 'Confidence'}
                      adjustment={latest[dimension]}
                      applied={latest.applied}
                      reason={latest.reason}
                      maxAdjustment={data.settings.maxAdjustment}
                    />
                  );
                })}
              </div>
            </PageSection>
          )}

          {/* ---- Per answer ---- */}
          <PageSection
            label="Answer by answer"
            title="Where each figure came from"
            description="Select an answer to see everything that was measured for it, the healthy range for each measurement, and what it contributed."
          >
            <div className="mb-4 flex flex-wrap gap-2">
              {analysed.map((response, index) => {
                const outside = response.metrics.filter((metric) => metric.measured && !metric.inBand).length;
                return (
                  <button
                    key={response.responseId}
                    type="button"
                    onClick={() => setSelected(index)}
                    className={`chip ${selected === index ? 'bg-[color:var(--brand-soft)] text-[color:var(--brand-strong)]' : ''}`}
                  >
                    Answer {index + 1}
                    {outside > 0 && (
                      <span className="ml-1.5 text-[color:var(--muted)]">{outside} to work on</span>
                    )}
                  </button>
                );
              })}
            </div>

            {current && (
              <div className="space-y-4">
                <div className="surface p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]">
                    Question
                  </p>
                  <p className="mt-1 text-sm text-[color:var(--text)]">
                    {current.questionText ?? 'The question text was not recorded.'}
                  </p>
                  <p className="mt-3 text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]">
                    You answered
                  </p>
                  <p className="mt-1 text-sm italic leading-relaxed text-[color:var(--muted)]">
                    {current.answerPreview}
                    {current.answerPreview.length >= 240 && '…'}
                  </p>

                  {current.jobStatus === 'failed' && (
                    <p className="mt-3 flex items-start gap-2 text-xs text-[color:var(--danger)]">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                      This answer&apos;s delivery analysis did not complete, so it is missing evidence
                      rather than scoring as poor delivery.
                    </p>
                  )}
                </div>

                {current.fusion?.timeline && <DeliveryStrip timeline={current.fusion.timeline} />}

                {SOURCE_GROUPS.map((group) => {
                  const rows = current.metrics.filter((metric) => metric.source === group.source);
                  if (rows.length === 0) return null;
                  const measured = rows.filter((metric) => metric.measured).length;

                  return (
                    <div key={group.source}>
                      <div className="mb-2 flex items-center gap-2">
                        <span className="text-[color:var(--muted)]">
                          {group.source === 'audio' ? (
                            <Mic size={15} />
                          ) : group.source === 'video' ? (
                            <ScanFace size={15} />
                          ) : (
                            <Gauge size={15} />
                          )}
                        </span>
                        <p className="text-sm font-medium text-[color:var(--text)]">{group.title}</p>
                        <span className="badge">
                          {measured} of {rows.length} measured
                        </span>
                      </div>
                      <p className="mb-3 text-xs leading-relaxed text-[color:var(--muted)]">{group.blurb}</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {rows.map((metric) => (
                          <MetricCard
                            key={metric.key}
                            metric={metric}
                            entry={registryByKey.get(metric.key)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}

                {current.fusion && current.fusion.caveats.length > 0 && (
                  <div className="surface border-l-4 border-l-[color:var(--warn)] p-4">
                    <p className="mb-2 flex items-center gap-2 text-sm font-medium text-[color:var(--text)]">
                      <Eye size={15} /> About this answer&apos;s evidence
                    </p>
                    <ul className="space-y-1.5">
                      {current.fusion.caveats.map((caveat, index) => (
                        <li key={index} className="text-xs leading-relaxed text-[color:var(--muted)]">
                          {caveat}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </PageSection>

          {/* ---- Session summary ---- */}
          <PageSection
            label="Across the interview"
            title="Every measurement, averaged"
            description="Each average is taken over the answers that actually produced a measurement — the counts beside them say how many that was."
          >
            <div className="surface divide-y divide-[color:var(--line)]">
              {data.aggregate
                .filter((aggregate) => aggregate.measuredCount > 0)
                .map((aggregate) => {
                  const entry = registryByKey.get(aggregate.key);
                  const complete = aggregate.measuredCount === aggregate.totalCount;
                  return (
                    <div
                      key={aggregate.key}
                      className="flex flex-wrap items-center justify-between gap-3 p-4"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[color:var(--text)]">{aggregate.label}</p>
                        <p className="text-xs text-[color:var(--muted)]">
                          measured on {aggregate.measuredCount} of {aggregate.totalCount} answers
                          {!complete && ' — treat the average as partial'}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-semibold tabular-nums text-[color:var(--text)]">
                          {aggregate.mean !== null ? formatValue(aggregate.unit, aggregate.mean) : '—'}
                        </span>
                        <span className={`badge ${aggregate.inBand ? 'badge-success' : 'badge-warn'}`}>
                          {aggregate.inBand ? (
                            <>
                              <CheckCircle2 size={12} /> In range
                            </>
                          ) : (
                            'Outside range'
                          )}
                        </span>
                      </div>
                      {entry && (
                        <p className="w-full text-xs text-[color:var(--muted)]">{describeBand(entry)}</p>
                      )}
                    </div>
                  );
                })}
            </div>

            {/* ---- What the word counters count ---- */}
            <div className="mt-4 rounded-xl border border-[color:var(--line)] p-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]">
                How the word-based measures work
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-[color:var(--text)]">
                    <span className="font-medium">Counted as fillers: </span>
                    <span className="text-[color:var(--muted)]">{data.disclosure.fillers.join(', ')}</span>
                  </p>
                  <p className="mt-1.5 text-xs text-[color:var(--text)]">
                    <span className="font-medium">Counted as hedging: </span>
                    <span className="text-[color:var(--muted)]">{data.disclosure.hedges.join(', ')}</span>
                  </p>
                  {data.disclosure.observedOnly.length > 0 && (
                    <p className="mt-1.5 text-xs text-[color:var(--text)]">
                      {/* These are words that are sometimes fillers and sometimes
                          real words. Counting them fully would penalise correct
                          usage, so they are reported without being scored. */}
                      <span className="font-medium">Reported but not scored: </span>
                      <span className="text-[color:var(--muted)]">
                        {data.disclosure.observedOnly.join(', ')}
                      </span>
                    </p>
                  )}
                </div>

                {/* The exclusions, with the server's own reason for each. A counter
                    that will not say what it refuses to count is not checkable. */}
                <div>
                  <p className="text-xs font-medium text-[color:var(--text)]">
                    Deliberately not counted
                  </p>
                  <ul className="mt-1.5 space-y-1.5">
                    {data.disclosure.excluded.map((entry) => (
                      <li key={entry.word} className="text-xs leading-relaxed text-[color:var(--muted)]">
                        <span className="font-medium text-[color:var(--text)]">{entry.word}</span> —{' '}
                        {entry.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-[color:var(--muted)]">
              A pause counts as {data.settings.pauseThresholdMs}ms or longer, a speaking rate is only
              calculated when there is at least {Math.round(data.settings.minSpeechForRateMs / 1000)}s
              of speech, and loudness is sampled every {data.settings.envelopeSampleIntervalMs}ms. At
              least {data.settings.minScorableMetrics} measurements are needed before any of this
              moves a score.
            </p>
          </PageSection>
        </>
      )}
    </PageShell>
  );
}
