// ============================================
// growthMath.ts — a trajectory through recorded ability, and its uncertainty
// ============================================
// Pure. No database, no network, no clock — the caller passes the points and the
// window.
//
// Feature 1 records an ability estimate per competency with its standard error, and
// appends each one to `AbilityHistory` rather than overwriting. That is what makes a
// trajectory possible at all; `ReadinessIndex`, which stores a single overwritten
// score, cannot support one and is deliberately not the source here.
//
// THE HONEST DIFFICULTY WITH A GROWTH LINE
//
// Every point on the line is an estimate with its own error, and a least-squares
// slope through noisy points is a confident-looking number derived from uncertain
// inputs. The failure this module is built to avoid is telling someone their system
// design improved 18% when every pair of measurements is indistinguishable from each
// other.
//
// So a trajectory reports its slope *and* whether the movement it describes is larger
// than the error at its two endpoints. `resolvable` is that flag, and where it is
// false the caller is expected to say so rather than draw the line. The test is
// deliberately conservative and is not a formal hypothesis test — the estimates come
// from overlapping response sets and are correlated, which a proper test would have
// to model — and it is documented as conservative rather than presented as exact.

import { computed, refused } from '../measured';
import type { Measured, MeasuredNumber } from '../measured';
import {
    ABILITY_FLAT_BAND,
    ABILITY_REGRESSION_SLOPE,
    MIN_TREND_POINTS,
} from './contract';
import {
    direction as directionOf,
    detectStagnation,
    slope as slopeOf,
    type Direction,
} from './trendMath';

/** One recorded ability estimate. */
export interface AbilityPoint {
    recordedAt: Date | string | number;
    theta: number;
    standardError: number;
    responsesUsed?: number;
}

/** A point reduced for output, with its timestamp normalised to an ISO string. */
export interface TrajectoryPoint {
    at: string;
    theta: number;
    standardError: number;
    responsesUsed: number | null;
}

export interface Trajectory {
    points: number;
    first: TrajectoryPoint;
    latest: TrajectoryPoint;
    /** theta at the last point minus theta at the first. Always defined. */
    netChange: number;
    /** theta per estimate, or a refusal below the point floor. */
    slope: MeasuredNumber;
    direction: Measured<Direction>;
    stagnation: Measured<{ stalled: boolean; since: string | null; runLength: number }>;
    regression: Measured<{ declining: boolean; slope: number }>;
    /**
     * Whether the net change is larger than the errors at its endpoints.
     *
     * `false` does not mean nothing happened; it means these measurements cannot
     * tell. Null when there are too few points to form a view.
     */
    resolvable: boolean | null;
    /** Days between the first and last recorded estimate. */
    spanDays: number;
}

/** Reads a point's timestamp, or null when it is not a date. */
function timeOf(point: AbilityPoint): number | null {
    const raw = point.recordedAt;
    const date = raw instanceof Date ? raw : new Date(raw as string | number);
    const time = date.getTime();
    return Number.isNaN(time) ? null : time;
}

function toOutput(point: AbilityPoint): TrajectoryPoint {
    const date = point.recordedAt instanceof Date ? point.recordedAt : new Date(point.recordedAt as string | number);
    return {
        at: Number.isNaN(date.getTime()) ? '' : date.toISOString(),
        theta: point.theta,
        standardError: point.standardError,
        responsesUsed: typeof point.responsesUsed === 'number' ? point.responsesUsed : null,
    };
}

/**
 * Fit a trajectory through a competency's history.
 *
 * Points are ordered by their recorded timestamp before anything is fitted, because
 * the slope is against position in the series and an unordered input would silently
 * produce a slope through a scrambled sequence. Ties in time keep the order given —
 * `Array.prototype.sort` is stable — so two estimates written in the same
 * millisecond stay in insertion order rather than being reordered arbitrarily.
 *
 * Points that are not finite, or whose timestamp cannot be read, are dropped before
 * the count is checked. Dropping them changes the count, so it is reported: a
 * trajectory fitted from four of six stored points is a different claim from one
 * fitted from six, and a reader is entitled to know which they are looking at.
 */
export function trajectory(
    points: AbilityPoint[],
    options: { minPoints?: number } = {},
): Measured<Trajectory & { dropped: number }> {
    const minPoints = options.minPoints ?? MIN_TREND_POINTS;

    const readable: Array<{ point: AbilityPoint; time: number }> = [];
    let dropped = 0;

    for (const point of points ?? []) {
        const time = timeOf(point);
        if (time === null || !Number.isFinite(point?.theta) || !Number.isFinite(point?.standardError)) {
            dropped += 1;
            continue;
        }
        readable.push({ point, time });
    }

    readable.sort((left, right) => left.time - right.time);

    if (readable.length === 0) {
        return refused('there were no recorded ability estimates to fit a trajectory through');
    }
    if (readable.length < minPoints) {
        return refused(
            `${readable.length} recorded ${readable.length === 1 ? 'estimate' : 'estimates'}, and a trajectory needs at least ${minPoints} — two points always lie on a line`,
        );
    }

    const ordered = readable.map((entry) => entry.point);
    const thetas = ordered.map((point) => point.theta);
    const first = ordered[0];
    const latest = ordered[ordered.length - 1];
    const netChange = latest.theta - first.theta;

    const fitted = slopeOf(thetas);
    const direction = fitted.state === 'computed' ? directionOf(fitted.value, ABILITY_FLAT_BAND) : fitted;

    const stagnation = detectStagnation(thetas, { band: ABILITY_FLAT_BAND });
    const regression = (() => {
        if (fitted.state !== 'computed') return fitted;
        return computed({
            declining: fitted.value < ABILITY_REGRESSION_SLOPE && netChange < 0,
            slope: fitted.value,
        });
    })();

    // Conservative resolvability. The two endpoint errors are added rather than
    // combined in quadrature, because the estimates are not independent — later
    // estimates reuse earlier responses — and adding them is the weaker, safer claim.
    const errorFloor = Math.abs(first.standardError) + Math.abs(latest.standardError);
    const resolvable = Math.abs(netChange) > errorFloor;

    const spanDays = (readable[readable.length - 1].time - readable[0].time) / 86_400_000;

    return computed({
        points: ordered.length,
        first: toOutput(first),
        latest: toOutput(latest),
        netChange,
        slope: fitted,
        direction,
        stagnation,
        regression,
        resolvable,
        spanDays,
        dropped,
    });
}

/** An alert worth showing beside a competency. */
export interface GrowthAlert {
    competencyId: string;
    competencyName: string | null;
    kind: 'regression' | 'stagnation' | 'insufficient';
    /** Always populated — an alert with no evidence is not shown. */
    detail: string;
    slope: number | null;
    points: number;
}

/**
 * The alerts a set of trajectories justifies, in the order they should be read.
 *
 * Regression first: a decline is the one a reader can act on. Stagnation next, which
 * is a prompt rather than a problem. Insufficient last — not having enough history is
 * not a finding about the person, so it is reported as a gap in the record rather
 * than as a property of the candidate.
 *
 * An alert is never emitted for a trajectory whose slope was refused, and it never
 * carries a slope it did not compute: `slope` is null on an insufficient-history
 * alert, because there is no slope and a zero would read as "flat".
 */
export function alertsFor(
    entries: Array<{ competencyId: string; competencyName: string | null; fit: Measured<Trajectory> }>,
): GrowthAlert[] {
    const alerts: GrowthAlert[] = [];

    for (const entry of entries) {
        const { fit } = entry;

        if (fit.state === 'refused') {
            alerts.push({
                competencyId: entry.competencyId,
                competencyName: entry.competencyName,
                kind: 'insufficient',
                detail: fit.reason,
                slope: null,
                points: 0,
            });
            continue;
        }

        if (fit.value.regression.state === 'computed' && fit.value.regression.value.declining) {
            alerts.push({
                competencyId: entry.competencyId,
                competencyName: entry.competencyName,
                kind: 'regression',
                detail: `Fitted at ${fit.value.regression.value.slope.toFixed(3)} logits per estimate across ${fit.value.points} estimates, a net change of ${fit.value.netChange.toFixed(3)}${fit.value.resolvable ? '' : ' — though the change is not larger than the error at its endpoints, so these measurements cannot confirm it'}.`,
                slope: fit.value.regression.value.slope,
                points: fit.value.points,
            });
            continue;
        }

        if (fit.value.stagnation.state === 'computed' && fit.value.stagnation.value.stalled) {
            alerts.push({
                competencyId: entry.competencyId,
                competencyName: entry.competencyName,
                kind: 'stagnation',
                detail: `${fit.value.stagnation.value.runLength} consecutive estimates moved by less than ${ABILITY_FLAT_BAND} logits each, across ${fit.value.points} estimates.`,
                slope: fit.value.slope.state === 'computed' ? fit.value.slope.value : null,
                points: fit.value.points,
            });
        }
    }

    return alerts;
}
