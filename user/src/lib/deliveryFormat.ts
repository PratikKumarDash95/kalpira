// ============================================
// deliveryFormat.ts — reading a delivery metric
// Feature 2 — Multimodal Delivery Analysis
// ============================================
//
// The registry that defines every delivery metric lives on the server, in
// `backend/server/app/lib/delivery/contract.ts`, and travels with each response.
// This module is the one place on the client that interprets it.
//
// WHY IT IS SHARED RATHER THAN COPIED
//
// The per-answer report and the rolled-up profile both draw a value against its
// healthy band. If each carried its own copy of "what does this band mean", the two
// screens could come to different conclusions about the same measurement — the
// profile saying a pace is fine while the answer underneath it says otherwise. So
// the formatting, the band description and the track geometry are defined once.
//
// It is also worth being clear about what is NOT here: no band is decided in this
// file. Every value, band, tolerance and verdict arrives from the server. A drift
// between the two packages can therefore change how a number reads, never what it
// says.

/** The unit a metric is expressed in. Mirrors `MetricUnit` on the server. */
export type MetricUnit = 'wpm' | 'ratio' | 'count' | 'ms' | 'score' | 'index' | 'per100words';

export type MetricShape = 'band' | 'lower-better' | 'higher-better' | 'informational';

export type MetricSource = 'audio' | 'lexical' | 'video';

/**
 * A metric definition as the server sends it.
 *
 * `tolerance` is how far outside the band a value has to get before its score
 * contribution is fully realised — which is also the distance the drawn track
 * extends past the band, so the reader's eye and the scoring agree on how bad
 * "outside" is.
 */
export interface RegistryEntry {
  key: string;
  label: string;
  unit: MetricUnit;
  feeds: 'communication' | 'confidence' | null;
  shape: MetricShape;
  band: [number, number];
  tolerance: number;
  maxImpact: number;
  advice: string;
  description: string;
}

/**
 * One metric rolled up across answers or sessions.
 *
 * `mean` is null when nothing was measured, which is deliberately different from
 * zero — "we could not measure your pace" and "your pace was zero" are not the
 * same statement about a person, and the UI must never render the first as the
 * second.
 */
export interface MetricAggregate {
  key: string;
  label: string;
  unit: MetricUnit;
  mean: number | null;
  measuredCount: number;
  totalCount: number;
  inBand: boolean;
  impact: number;
}

/**
 * Formats a value in its own unit.
 *
 * Mirrors `formatMetricValue` in the backend's delivery/contract.ts, which the two
 * packages cannot share.
 */
export function formatValue(unit: MetricUnit, value: number): string {
  switch (unit) {
    case 'wpm':
      return `${Math.round(value)} wpm`;
    case 'per100words':
      return `${value.toFixed(1)} per 100 words`;
    case 'ratio':
      return `${Math.round(value * 100)}%`;
    case 'ms':
      return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
    case 'count':
      return value === 1 ? '1' : `${Math.round(value)}`;
    case 'score':
      return `${Math.round(value)}/100`;
    default:
      return value.toFixed(2);
  }
}

/** The healthy range written out, so the reader never has to infer it from the bar. */
export function describeBand(entry: RegistryEntry): string | null {
  const [low, high] = entry.band;
  if (entry.shape === 'informational' || entry.feeds === null || entry.maxImpact === 0) return null;
  if (entry.shape === 'lower-better') return `healthy under ${formatValue(entry.unit, low)}`;
  if (entry.shape === 'higher-better') return `healthy over ${formatValue(entry.unit, high)}`;
  return `healthy ${formatValue(entry.unit, low)}–${formatValue(entry.unit, high)}`;
}

/**
 * The value range a metric's track spans, and where the healthy range sits in it.
 *
 * The track spans the healthy range plus one tolerance on each side, which is the
 * distance at which a deviation becomes fully realised in the score. A value further
 * out than that is pinned to the end rather than stretching the scale — a 400 wpm
 * rate should look "well past", not make everything else unreadable.
 *
 * Exported because the trend chart needs the same range as the axis: a line drawn on
 * a different scale from the bar beneath it would tell a reader two different stories
 * about the same metric.
 */
export function domainFor(entry: RegistryEntry): {
  min: number;
  max: number;
  bandStart: number;
  bandEnd: number;
} {
  const [low, high] = entry.band;
  const tolerance = entry.tolerance > 0 ? entry.tolerance : Math.max(high - low, 1);

  if (entry.shape === 'lower-better') {
    return { min: 0, max: low + tolerance, bandStart: 0, bandEnd: low };
  }
  if (entry.shape === 'higher-better') {
    return { min: Math.max(0, high - tolerance), max: high + tolerance, bandStart: high, bandEnd: high + tolerance };
  }
  return {
    min: Math.max(0, low - tolerance),
    max: high + tolerance,
    bandStart: low,
    bandEnd: high,
  };
}

/** Where to draw a value on a track, and where the healthy range sits on it. */
export function trackFor(entry: RegistryEntry, value: number) {
  const { min, max, bandStart, bandEnd } = domainFor(entry);
  const span = max - min || 1;
  const percent = (n: number) => Math.max(0, Math.min(100, ((n - min) / span) * 100));

  return {
    bandStart: percent(bandStart),
    bandWidth: Math.max(1.5, percent(bandEnd) - percent(bandStart)),
    marker: percent(value),
    offScale: value < min || value > max,
  };
}

/** Where a rolled-up metric stands, in the words a reader would use. */
export function aggregateVerdict(metric: MetricAggregate, entry?: RegistryEntry): {
  label: string;
  tone: string;
} {
  if (metric.mean === null || metric.measuredCount === 0) {
    return { label: 'Not measured', tone: 'badge' };
  }
  // A mean drawn from a single answer is a measurement of one answer, and saying
  // so is the difference between evidence and a verdict.
  if (metric.measuredCount === 1) {
    return { label: 'One answer only', tone: 'badge' };
  }
  if (entry && (entry.shape === 'informational' || entry.feeds === null || entry.maxImpact === 0)) {
    return { label: 'Informational', tone: 'badge' };
  }
  return metric.inBand
    ? { label: 'Inside the healthy range', tone: 'badge-success' }
    : { label: 'Outside the healthy range', tone: 'badge-warn' };
}
