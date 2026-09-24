// ============================================
// growthService.ts — a candidate's trajectories through their recorded ability
// ============================================
// The orchestration half of `growthMath.ts`. That file fits a line and decides whether the
// movement is larger than its own error; this one reads `AbilityHistory`, turns its rows into
// points, and presents the fit.
//
// WHY `AbilityHistory` AND NOT `ReadinessIndex`
//
// Feature 1 appends an ability estimate per competency per recomputation, and `ReadinessIndex`
// overwrites a single score in place. Only the first can support a trajectory — the second has
// one point by construction, and fitting a line through it would be a restatement of the
// current score dressed as a trend. This file therefore never reads `ReadinessIndex`, and the
// absence is deliberate rather than an omission.
//
// WHERE THE ROWS BECOME POINTS, AND WHY ONLY HERE
//
// `growthMath.ts` drops a point whose timestamp will not parse or whose value is not finite,
// and reports how many it dropped. That count is a real signal, so this file does the same
// filtering itself — once, in `readPoints` — and hands the fit only readable points. The fit's
// own `dropped` is therefore zero by construction and is not read; the number a reader sees is
// this file's, and there is exactly one place it comes from. The alternative, letting the fit
// drop them and trusting its count, would put points on the returned series that contributed
// nothing to the line.
//
// WHAT A REFUSED FIT IS, AND WHAT IT IS NOT
//
// A competency with one or two stored estimates has no trajectory, and the refusal says so in
// those words. The recorded points are still returned — the refusal is about the line, not
// about the data, and a chart can plot two dots and no trend. What it does not get is a flat
// line or a slope of zero: a zero slope is a measurement ("this did not move"), and a
// competency measured twice has not been shown to be stable.
//
// THE RESOLVABILITY FLAG IS THE POINT OF THE WHOLE FILE
//
// Each estimate carries a standard error, so a slope through noisy points is a confident-looking
// number derived from uncertain inputs. `resolvable` is false when the net change is not larger
// than the errors at its two endpoints. `growthMath.ts` is explicit that this conservatism is
// not a formal test — the estimates reuse responses and are correlated — and this file carries
// that wording through to the surface rather than letting a chart draw the line unremarked.

import supabaseDb from '../supabaseDb';
import { computed, refused, present } from '../measured';
import type { Measured } from '../measured';
import {
    alertsFor,
    trajectory,
    type AbilityPoint,
    type GrowthAlert,
    type Trajectory,
    type TrajectoryPoint,
} from './growthMath';
import type { Direction } from './trendMath';
import {
    ABILITY_FLAT_BAND,
    ABILITY_REGRESSION_SLOPE,
    GROWTH_CAVEATS,
    MIN_TREND_POINTS,
} from './contract';

/** Ceiling on the competencies one response fits, so a wide graph cannot stall a page. */
export const MAX_COMPETENCIES = 50;
/** Ceiling on the estimates one trajectory is fitted through, newest kept. */
export const MAX_TRAJECTORY_POINTS = 500;

// --------------------------------------------
// Shapes
// --------------------------------------------

/** One competency's trajectory as a reader consumes it. */
export interface TrajectoryView {
    competencyId: string;
    competencySlug: string | null;
    /** Null when the competency row is gone. The estimate is still reported, unnamed. */
    competencyName: string | null;
    status: 'fitted' | 'not_computable';
    notComputableReason: string | null;
    /**
     * The estimates that were fitted, oldest first. Present even when the fit was refused,
     * because two recorded estimates are two facts about a candidate whether or not they
     * support a line.
     */
    points: TrajectoryPoint[];
    /** Stored estimates dropped for an unreadable date or a non-numeric value. */
    dropped: number;
    pointCount: number;
    /** Null on a refused fit. Never zero — zero is a measurement. */
    netChange: number | null;
    spanDays: number | null;
    /** Null when there was no fit to judge — not false, which would be a claim. */
    resolvable: boolean | null;
    /** What `resolvable: false` costs the reader, worded once and carried with the figure. */
    resolvabilityNote: string | null;
    slope: { value: number | null; notComputableReason: string | null };
    direction: { value: Direction | null; notComputableReason: string | null };
    stagnation: {
        value: { stalled: boolean; since: string | null; runLength: number } | null;
        notComputableReason: string | null;
    };
    regression: {
        value: { declining: boolean; slope: number } | null;
        notComputableReason: string | null;
    };
}

export interface GrowthOverview {
    userId: string;
    competencies: TrajectoryView[];
    alerts: GrowthAlert[];
    /** Estimates read for this candidate, across every competency, before any were dropped. */
    recordedEstimates: number;
    /** Competencies in the graph with no recorded estimate for this candidate at all. */
    competenciesWithoutHistory: number;
    /** Competencies dropped for the per-response ceiling. */
    competenciesOmitted: number;
    caveats: string[];
    band: { flat: number; regression: number; minPoints: number };
}

// --------------------------------------------
// Reading
// --------------------------------------------

/**
 * Every competency's trajectory for one candidate.
 *
 * Ordered so the reader meets the worrying ones first: a regression, then a stall, then a
 * competency with too little history to say, then the rest by how much they moved. The order is
 * a presentation choice and it is stated here so nobody has to infer it — a chart sorted by
 * name buries the one line a candidate most needs to see.
 *
 * The competency graph is loaded once for the whole response rather than per trajectory. A
 * competency whose row is missing — deleted between the estimate and this read — is still
 * reported, with a null name: dropping it would make a competency the candidate was measured in
 * vanish from their own timeline, which is worse than an unnamed row.
 */
export async function growthOverview(
    userId: string,
    options: { competencyIds?: string[] | null; competencyLimit?: number } = {},
): Promise<Measured<GrowthOverview>> {
    if (!userId) return refused('no candidate was named, so there is no history to fit a trajectory through');

    const rows = (await supabaseDb.abilityHistory.findMany({ where: { userId } })) as Array<Record<string, any>>;

    const byCompetency = new Map<string, Array<Record<string, any>>>();
    for (const row of rows) {
        const competencyId = row.competencyId ? String(row.competencyId) : '';
        if (!competencyId) continue;
        const list = byCompetency.get(competencyId);
        if (list) list.push(row);
        else byCompetency.set(competencyId, [row]);
    }

    const competencies = (await supabaseDb.competency.findMany({})) as Array<Record<string, any>>;
    const competencyById = new Map<string, Record<string, any>>();
    for (const row of competencies) competencyById.set(String(row.id), row);

    const requested =
        options.competencyIds && options.competencyIds.length > 0 ? new Set(options.competencyIds) : null;

    // Which competencies this response is about. With an explicit request the graph is the
    // request; without one it is whatever the candidate has history in — a competency nobody
    // was ever measured in is not a gap in this candidate's record, it is just unused.
    const inScope = requested
        ? [...requested]
        : [...byCompetency.keys()].filter((id) => competencyById.has(id));

    const withHistory = inScope.filter((id) => (byCompetency.get(id) ?? []).length > 0);

    const limit = Math.max(1, Math.min(options.competencyLimit ?? MAX_COMPETENCIES, MAX_COMPETENCIES));
    // Sampled most first, because when the ceiling bites it should keep the competencies with
    // the most evidence. The final order is applied after every fit, below.
    const selected = withHistory
        .slice()
        .sort((left, right) => (byCompetency.get(right) ?? []).length - (byCompetency.get(left) ?? []).length)
        .slice(0, limit);

    const views: TrajectoryView[] = [];
    const alertInputs: Array<{
        competencyId: string;
        competencyName: string | null;
        fit: Measured<Trajectory>;
    }> = [];

    for (const competencyId of selected) {
        const row = competencyById.get(competencyId);
        const name = row && typeof row.name === 'string' ? row.name : null;
        const slug = row && typeof row.slug === 'string' ? row.slug : null;

        const read = readPoints(byCompetency.get(competencyId) ?? []);
        const fit = trajectory(read.points);
        views.push(presentTrajectory(competencyId, slug, name, read.points, read.dropped, fit));
        alertInputs.push({ competencyId, competencyName: name, fit });
    }

    const alerts = alertsFor(alertInputs);

    const bandOf = (view: TrajectoryView): number => {
        const alert = alerts.find((candidate) => candidate.competencyId === view.competencyId);
        if (alert?.kind === 'regression') return 0;
        if (alert?.kind === 'stagnation') return 1;
        if (view.status === 'not_computable') return 2;
        return 3;
    };

    views.sort((left, right) => {
        const byBand = bandOf(left) - bandOf(right);
        if (byBand !== 0) return byBand;
        // Within a band, the largest movement first. A refused fit has no movement and is
        // sorted last by a sentinel below every real magnitude — it is not given a zero,
        // because zero would place it among the competencies that genuinely did not move.
        const leftChange = left.netChange === null ? -1 : Math.abs(left.netChange);
        const rightChange = right.netChange === null ? -1 : Math.abs(right.netChange);
        if (rightChange !== leftChange) return rightChange - leftChange;
        const leftName = left.competencyName ?? left.competencyId;
        const rightName = right.competencyName ?? right.competencyId;
        return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
    });

    const totalDropped = views.reduce((sum, view) => sum + view.dropped, 0);
    const competenciesOmitted = Math.max(0, withHistory.length - selected.length);
    const competenciesWithoutHistory = Math.max(0, inScope.length - withHistory.length);

    const caveats = [...GROWTH_CAVEATS];
    if (totalDropped > 0) {
        caveats.push(
            `${totalDropped} stored ${totalDropped === 1 ? 'estimate was' : 'estimates were'} unreadable and left out of the fit. A trajectory fitted from fewer points than the record holds is a different claim from one fitted from all of them.`,
        );
    }
    if (views.some((view) => view.resolvable === false)) {
        caveats.push(
            'At least one trajectory moved by less than the error at its endpoints. The line is drawn from recorded estimates, and those measurements cannot confirm the change.',
        );
    }
    if (competenciesOmitted > 0) {
        caveats.push(
            `${competenciesOmitted} further ${competenciesOmitted === 1 ? 'competency has' : 'competencies have'} recorded history and ${competenciesOmitted === 1 ? 'is' : 'are'} not shown here, because one response fits at most ${limit}.`,
        );
    }

    return computed({
        userId,
        competencies: views,
        alerts,
        recordedEstimates: rows.length,
        competenciesWithoutHistory,
        competenciesOmitted,
        caveats,
        band: {
            flat: ABILITY_FLAT_BAND,
            regression: ABILITY_REGRESSION_SLOPE,
            minPoints: MIN_TREND_POINTS,
        },
    });
}

/** One competency's trajectory, or the reason it has none. */
export async function competencyTrajectory(
    userId: string,
    competencyId: string,
): Promise<Measured<TrajectoryView>> {
    if (!userId) return refused('no candidate was named, so there is no history to fit a trajectory through');
    if (!competencyId) return refused('no competency was named, so there is nothing to fit');

    const rows = (await supabaseDb.abilityHistory.findMany({
        where: { userId, competencyId },
    })) as Array<Record<string, any>>;

    const row = await supabaseDb.competency.findUnique({ where: { id: competencyId } });
    const name = row && typeof row.name === 'string' ? row.name : null;
    const slug = row && typeof row.slug === 'string' ? row.slug : null;

    const read = readPoints(rows);
    return computed(presentTrajectory(competencyId, slug, name, read.points, read.dropped, trajectory(read.points)));
}

// --------------------------------------------
// Rows to points
// --------------------------------------------

/**
 * `AbilityHistory` rows as fittable points, oldest first.
 *
 * The only place a stored estimate becomes an `AbilityPoint`, so a row that cannot be placed on
 * a timeline is counted here and nowhere else. Ordering happens before truncation and both
 * happen before the fit: the ceiling keeps the newest estimates, because an older one that has
 * been superseded is the one a reader can most afford to lose, and a truncated series that kept
 * the oldest would report a slope through history the candidate has since moved past.
 */
function readPoints(rows: Array<Record<string, any>>): { points: AbilityPoint[]; dropped: number } {
    const readable: Array<{ point: AbilityPoint; time: number }> = [];
    let dropped = 0;

    for (const row of rows) {
        const time = timeOf(row.recordedAt);
        const theta = Number(row.theta);
        const standardError = Number(row.standardError);

        if (time === null || !Number.isFinite(theta) || !Number.isFinite(standardError)) {
            dropped += 1;
            continue;
        }

        readable.push({
            time,
            point: {
                recordedAt: new Date(time),
                theta,
                standardError,
                responsesUsed: typeof row.responsesUsed === 'number' ? row.responsesUsed : undefined,
            },
        });
    }

    readable.sort((left, right) => left.time - right.time);

    const kept = readable.length > MAX_TRAJECTORY_POINTS ? readable.slice(-MAX_TRAJECTORY_POINTS) : readable;
    return { points: kept.map((entry) => entry.point), dropped };
}

/** A point's timestamp in milliseconds, or null when it is not a date. */
function timeOf(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    const time = date.getTime();
    return Number.isNaN(time) ? null : time;
}

function emit(point: AbilityPoint): TrajectoryPoint {
    const date = point.recordedAt instanceof Date ? point.recordedAt : new Date(point.recordedAt as string | number);
    return {
        at: date.toISOString(),
        theta: point.theta,
        standardError: point.standardError,
        responsesUsed: typeof point.responsesUsed === 'number' ? point.responsesUsed : null,
    };
}

// --------------------------------------------
// Presentation
// --------------------------------------------

/**
 * A fit as a reader consumes it.
 *
 * A refused fit carries no derived number at all — no zero slope, no zero net change, no
 * `resolvable: false`. The refusal may have been about the points or about their count, and
 * both mean the same thing to a reader: this competency has no trajectory yet, and here is why.
 * The recorded points survive the refusal, because they are not a claim.
 */
function presentTrajectory(
    competencyId: string,
    competencySlug: string | null,
    competencyName: string | null,
    points: AbilityPoint[],
    dropped: number,
    fit: Measured<Trajectory>,
): TrajectoryView {
    const series = points.map(emit);

    if (fit.state === 'refused') {
        return {
            competencyId,
            competencySlug,
            competencyName,
            status: 'not_computable',
            notComputableReason: fit.reason,
            points: series,
            dropped,
            pointCount: series.length,
            netChange: null,
            spanDays: null,
            resolvable: null,
            resolvabilityNote: null,
            slope: { value: null, notComputableReason: fit.reason },
            direction: { value: null, notComputableReason: fit.reason },
            stagnation: { value: null, notComputableReason: fit.reason },
            regression: { value: null, notComputableReason: fit.reason },
        };
    }

    const value = fit.value;
    return {
        competencyId,
        competencySlug,
        competencyName,
        status: 'fitted',
        notComputableReason: null,
        points: series,
        dropped,
        pointCount: series.length,
        netChange: value.netChange,
        spanDays: value.spanDays,
        resolvable: value.resolvable,
        resolvabilityNote:
            value.resolvable === false
                ? `The net change of ${value.netChange.toFixed(3)} logits is smaller than the error at its two endpoints, so these measurements cannot confirm that anything moved. This comparison is deliberately conservative and is not a formal test.`
                : null,
        slope: present(value.slope),
        direction: present(value.direction),
        stagnation: present(value.stagnation),
        regression: present(value.regression),
    };
}
