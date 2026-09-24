// ============================================
// benchmarkService.ts — peer pools, and the floor that suppresses a percentile
// ============================================
// The orchestration half of `benchmarkMath.ts`. That file does the arithmetic and enforces the
// publication floor; this one decides WHO is in the pool, which is the harder question.
//
// A PERCENTILE IS ONLY AS DEFENSIBLE AS ITS POOL
//
// `summariseCohort` counts scores, and it is explicit that the caller must pass one score per
// person — "a pool of five that is really two people is exactly the de-anonymisation the floor
// exists to prevent". The uniqueness of `ReadinessIndex."userId"` is what makes that free here:
// there is structurally at most one row per candidate, so a pool assembled from that table
// cannot double-count anyone. This file never assembles scores from `InterviewSession`, where a
// candidate with three sessions would be counted three times.
//
// WHY POOL MEMBERSHIP IS NOT JUST "HAS A ReadinessIndex ROW"
//
// `readinessEngine.updateReadinessIndex` writes `readinessScore: 0` when a candidate has no
// sessions at all — see the `if (!latestSession)` branch. That zero is not a measurement; it is
// the absence of one stored as a number, and it is precisely the fabrication the platform's
// refusal doctrine exists to prevent. Counting such a row as a peer would drag every percentile
// down and would describe a person who was never assessed.
//
// So membership requires a COMPLETED, non-terminal interview session, in both scopes. The score
// then comes from `ReadinessIndex`, and a candidate who completed a session but has no score row
// is reported as unscored rather than given a zero. The two scopes differ only in the filter:
// a study pool is the candidates who interviewed on that study, and the global pool is everyone
// who has completed anything.
//
// This distinction is worth the extra query. A benchmark is the one number in this feature that
// describes other people, and a pool that is 40% never-assessed candidates would make every
// percentile in the product wrong in the same direction.
//
// THE RANK HAS NO FLOOR AND THE BENCHMARK DOES
//
// `percentileRank` deliberately does not enforce the publication floor: it describes the
// subject's own position and discloses nothing about anyone else. Withholding it because too few
// peers exist would keep someone's own information from them. But a rank against three peers is
// not a stable benchmark, so `rankIsPublished` distinguishes the two cases and the note says
// which one a reader is looking at. `bandFor` is only called when the benchmark was published,
// so a band label can never appear beside a suppressed pool.
//
// WHAT THIS FILE READS, AND WHAT IT COSTS
//
// `InterviewSession` is filtered by equality on `studyId` for a study pool — one indexed query.
// The global pool needs the complement of `completedAt: null`, which PostgREST cannot express
// through this shim (`{ not: null }` is not a queryable operator — see `canQueryWhere`), so the
// global pool reads the session table and filters in JS. That is acceptable for an operator-facing
// benchmark and it is stated here rather than discovered later.

import supabaseDb from '../supabaseDb';
import { computed, refused, present } from '../measured';
import type { Measured } from '../measured';
import {
    bandFor,
    benchmarkPercentileLabels,
    percentileRank,
    summariseCohort,
    type CohortBenchmark,
} from './benchmarkMath';
import { BENCHMARK_CAVEATS, MIN_BENCHMARK_COHORT } from './contract';

/**
 * Session modes that mean the interview did not produce a measurement.
 *
 * Spelled again from `lib/kv.ts`, which uses the same three for `countPendingSessions` but does
 * not export the list. Kept as a literal rather than widened into a shared constant because the
 * two uses answer different questions — that one asks whether a study is still awaiting work,
 * this one asks whether a session produced a score — and a name they both import would invite
 * one of them to change the other's meaning. If the vocabulary grows, both move together.
 */
const TERMINAL_SESSION_MODES = ['terminated', 'absent', 'rejected'];

/** The scopes a peer pool may be drawn from. */
export type BenchmarkScope = 'study' | 'global';

/** The pool a benchmark was drawn from, and what was left out of it. */
export interface PoolMembership {
    scope: BenchmarkScope;
    scopeKey: string | null;
    /** Sessions read for this scope, before any filter. */
    sessionsConsidered: number;
    /** Sessions that completed and did not end in a terminal mode. */
    sessionsCounted: number;
    /** Sessions excluded because the interview did not happen or was terminated. */
    sessionsTerminal: number;
    /** Completed sessions with no `completedAt`, i.e. still open. */
    sessionsIncomplete: number;
    /** Distinct candidates with at least one counted session, before scores are considered. */
    candidates: number;
    /** Candidates in the pool with a recorded score. These are the scores the floor counts. */
    candidatesScored: number;
    /** Candidates who completed a session but have no score recorded. Reported, never zeroed. */
    candidatesUnscored: number;
}

export interface BenchmarkView {
    /** The candidate this was computed for, or null for a pool-only view. */
    subjectUserId: string | null;
    scope: BenchmarkScope;
    scopeKey: string | null;
    /** The subject's own score, or why there is none. Never included in the pool twice. */
    subjectScore: { value: number | null; notComputableReason: string | null };
    benchmark: { value: CohortBenchmark | null; notComputableReason: string | null };
    rank: { value: number | null; notComputableReason: string | null };
    /** Where the subject's score sits against the reported percentiles. Null when suppressed. */
    band: string | null;
    /** False when the pool was below the publication floor, so the rank is not a benchmark. */
    rankIsPublished: boolean;
    /** What the rank is worth given the pool, worded where the rank is read. */
    rankNote: string | null;
    /** False when a rank was computed but the pool is too small to publish percentiles from. */
    pool: PoolMembership;
    percentiles: string[];
    caveats: string[];
}

// --------------------------------------------
// The pool
// --------------------------------------------

/** A pool's membership, its scores and the subject's score if they are in it. */
interface Pool {
    membership: PoolMembership;
    /** One score per candidate id. The map's key set is exactly the floor's denominator. */
    scoresByUser: Map<string, number>;
}

/**
 * Assemble a peer pool.
 *
 * Returns the membership figures alongside the scores so the two cannot drift: the count a
 * refusal states and the count the floor applied are the same `scoresByUser.size`.
 */
async function buildPool(scope: BenchmarkScope, scopeKey: string | null): Promise<Pool> {
    const sessions =
        scope === 'study'
            ? ((await supabaseDb.interviewSession.findMany({
                  where: { studyId: scopeKey ?? '' },
              })) as Array<Record<string, any>>)
            : ((await supabaseDb.interviewSession.findMany({})) as Array<Record<string, any>>);

    const candidateIds = new Set<string>();
    let sessionsCounted = 0;
    let sessionsTerminal = 0;
    let sessionsIncomplete = 0;

    for (const session of sessions) {
        if (TERMINAL_SESSION_MODES.includes(String(session.mode))) {
            sessionsTerminal += 1;
            continue;
        }
        if (!session.completedAt) {
            sessionsIncomplete += 1;
            continue;
        }
        const userId = session.userId ? String(session.userId) : '';
        if (!userId) continue;
        sessionsCounted += 1;
        candidateIds.add(userId);
    }

    const scoresByUser = new Map<string, number>();
    if (candidateIds.size > 0) {
        // `in` is not pushed to PostgREST by this shim — it loads the table and filters in JS
        // (see `canQueryWhere`). `ReadinessIndex` holds at most one row per candidate, so this
        // is a small table and the whole-table read is the cheapest honest option available.
        const indexes = (await supabaseDb.readinessIndex.findMany({
            where: { userId: { in: [...candidateIds] } },
        })) as Array<Record<string, any>>;

        for (const row of indexes) {
            const userId = row.userId ? String(row.userId) : '';
            if (!userId || !candidateIds.has(userId)) continue;
            const score = Number(row.readinessScore);
            // A non-finite score is not a score. Skipping it here means the candidate is
            // reported in `candidatesUnscored` rather than entering the pool as a NaN, which
            // would pass a `length` check and poison every percentile computed from it.
            if (!Number.isFinite(score)) continue;
            scoresByUser.set(userId, score);
        }
    }

    return {
        membership: {
            scope,
            scopeKey,
            sessionsConsidered: sessions.length,
            sessionsCounted,
            sessionsTerminal,
            sessionsIncomplete,
            candidates: candidateIds.size,
            candidatesScored: scoresByUser.size,
            candidatesUnscored: candidateIds.size - scoresByUser.size,
        },
        scoresByUser,
    };
}

// --------------------------------------------
// Reading
// --------------------------------------------

/**
 * A benchmark for one candidate against a peer pool.
 *
 * The subject is a member of their own pool — a percentile against everyone but yourself is a
 * different and less useful quantity — and because the pool is keyed by candidate id they cannot
 * be counted twice. If the subject has no score of their own the pool benchmark is still
 * published and the rank is refused with that reason: the comparison is about the pool, and
 * withholding it because one member is unscored would punish the reader for someone else's gap.
 */
export async function benchmarkFor(
    subjectUserId: string | null,
    options: { scope?: BenchmarkScope; scopeKey?: string | null } = {},
): Promise<Measured<BenchmarkView>> {
    const scope: BenchmarkScope = options.scope === 'study' ? 'study' : 'global';
    const scopeKey = scope === 'study' ? options.scopeKey ?? null : null;

    if (scope === 'study' && !scopeKey) {
        return refused('a study pool was requested without naming the study, so there are no peers to draw it from');
    }

    const pool = await buildPool(scope, scopeKey);
    const scores = [...pool.scoresByUser.values()];

    const benchmark = summariseCohort(scores, MIN_BENCHMARK_COHORT);

    const poolIsPublished = benchmark.state === 'computed';
    const cohortSize = poolIsPublished ? benchmark.value.cohortSize : scores.length;
    const minCohortN = poolIsPublished ? benchmark.value.minCohortN : MIN_BENCHMARK_COHORT;

    let subjectScore: Measured<number> = refused('no candidate was named, so there is no score to place in the pool');
    if (subjectUserId) {
        const own = pool.scoresByUser.get(subjectUserId);
        subjectScore = own === undefined
            ? refused(
                  `this candidate has no recorded readiness score, so there is nothing to place against the pool of ${cohortSize}`,
              )
            : computed(own);
    }

    // The rank is only meaningful against a pool the subject could be a member of. A subject
    // outside the pool is still ranked against it — that is the point of comparing — but the
    // note says so, because "p72 of candidates in this study" and "p72 of candidates overall"
    // are different claims and only one of them is true of a candidate who never interviewed
    // on that study.
    const rank =
        subjectScore.state === 'computed'
            ? percentileRank(subjectScore.value, scores)
            : refused(subjectScore.reason);

    const rankIsPublished = rank.state === 'computed' && poolIsPublished;

    const caveats = [...BENCHMARK_CAVEATS];
    if (pool.membership.candidatesUnscored > 0) {
        caveats.push(
            `${pool.membership.candidatesUnscored} ${pool.membership.candidatesUnscored === 1 ? 'candidate in this pool has' : 'candidates in this pool have'} a completed interview and no recorded score. They are not counted as zeros — they are absent from the pool, so every percentile below is drawn from the ${pool.membership.candidatesScored} who were scored.`,
        );
    }
    if (pool.membership.sessionsTerminal > 0) {
        caveats.push(
            `${pool.membership.sessionsTerminal} ${pool.membership.sessionsTerminal === 1 ? 'session was' : 'sessions were'} excluded because the interview did not take place or was terminated. An interview that never happened is not a zero score.`,
        );
    }
    if (!poolIsPublished && rank.state === 'computed') {
        caveats.push(
            `The rank shown is this candidate's own position and is computed from the whole pool, but a percentile over ${cohortSize} says more about individual peers than about the group, so no benchmark is published.`,
        );
    }
    if (subjectUserId && !pool.scoresByUser.has(subjectUserId) && poolIsPublished) {
        caveats.push(
            'This candidate is not in the pool, so their rank places them against peers they are not counted among. The pool size above excludes them.',
        );
    }

    return computed({
        subjectUserId: subjectUserId ?? null,
        scope,
        scopeKey,
        subjectScore: present(subjectScore),
        benchmark: present(benchmark),
        rank: present(rank),
        band: poolIsPublished && subjectScore.state === 'computed' ? bandFor(subjectScore.value, benchmark.value) : null,
        rankIsPublished,
        rankNote: rankNoteFor(rank, poolIsPublished, cohortSize),
        pool: pool.membership,
        percentiles: benchmarkPercentileLabels(),
        caveats,
    });
}

/** A benchmark against the candidates who interviewed on one study. */
export async function studyBenchmarkFor(
    studyId: string,
    subjectUserId?: string | null,
): Promise<Measured<BenchmarkView>> {
    if (!studyId) return refused('no study was named, so there is no pool to draw peers from');
    return benchmarkFor(subjectUserId ?? null, { scope: 'study', scopeKey: studyId });
}

/** A benchmark against every candidate who has completed an interview. */
export async function globalBenchmarkFor(subjectUserId?: string | null): Promise<Measured<BenchmarkView>> {
    return benchmarkFor(subjectUserId ?? null, { scope: 'global' });
}

/**
 * The pool on its own, with no subject.
 *
 * For the surfaces that report what a pool looks like — a study's fairness view, an admin
 * overview — where there is no candidate to place and asking for one would mean inventing a
 * subject. The result is the same shape with `subjectScore` and `rank` refused by name, so a
 * reader cannot mistake a pool description for a benchmark of someone.
 */
export async function poolSummary(
    options: { scope?: BenchmarkScope; scopeKey?: string | null } = {},
): Promise<Measured<BenchmarkView>> {
    return benchmarkFor(null, options);
}

function rankNoteFor(rank: Measured<number>, poolIsPublished: boolean, cohortSize: number): string | null {
    if (rank.state === 'refused') return rank.reason;
    if (poolIsPublished) return `Ranked against ${cohortSize} scored candidates in this pool.`;
    return `Not enough peers to compare against — ${cohortSize} scored ${cohortSize === 1 ? 'candidate' : 'candidates'} in this pool, and a benchmark is published from at least ${MIN_BENCHMARK_COHORT}. This figure is the candidate's own position and is not a stable benchmark.`;
}

// --------------------------------------------
// Publication — the `Benchmark` table
// --------------------------------------------
// `benchmarkFor` above answers "where does this candidate sit". The `Benchmark` table answers a
// different question — "what does the distribution look like for this role, on this competency"
// — and it is the one that has to be stored, because a percentile computed from other people is
// the number the publication floor exists to guard.
//
// The pool here is drawn from `AbilityHistory` rather than from `ReadinessIndex`, because the
// table is keyed by competency and a readiness score is not one. That also solves the
// one-score-per-person rule differently: a candidate has many recorded estimates per competency,
// so the LATEST estimate for each candidate is taken, and a candidate with no estimate in this
// role's sessions contributes nothing rather than a zero. A `ReadinessIndex` row with the engine's
// no-sessions zero cannot leak in here at all, because no `AbilityHistory` row exists for a
// candidate who was never measured.
//
// A role is `InterviewSession."role"` — the only role in the schema. It is a free-text column, so
// two spellings of the same job are two pools; that is a real limitation of the data and it shows
// up as a pool that is smaller than it should be, which fails toward suppression rather than
// toward publishing a percentile over too few.

/** What was published for one competency, and whether the row was rewritten. */
export interface CompetencyPublication {
    competencyId: string;
    competencySlug: string | null;
    cohortSize: number;
    published: boolean;
    /** The floor's reason when suppressed, else null. */
    suppressedReason: string | null;
    /** False when the stored row already said exactly this. */
    written: boolean;
}

export interface BenchmarkPublication {
    roleKey: string;
    /** Candidates with a completed, non-terminal session of this role. */
    candidates: number;
    /** Candidates with at least one recorded estimate in this role's sessions. */
    candidatesWithEstimates: number;
    /** Stored estimates read for this role, before one per candidate was selected. */
    estimatesRead: number;
    competenciesConsidered: number;
    published: number;
    suppressed: number;
    unchanged: number;
    outcomes: CompetencyPublication[];
    caveats: string[];
}

export interface PublishBenchmarksParams {
    roleKey: string;
    /** Restrict to these competencies. Omitted, every competency with estimates is published. */
    competencyIds?: string[] | null;
    /** Compute and report without writing. A caller can see the effect before it lands. */
    dryRun?: boolean;
}

/**
 * Publish this role's competency benchmarks, or record why they are suppressed.
 *
 * The suppressed row is written rather than skipped. A missing row and a row saying "3 candidates,
 * and a benchmark is published from at least 5" are different facts, and the second is the one a
 * reader asking "why is this blank?" needs. It is also what keeps the suppression auditable: the
 * count that caused it is stored beside the timestamps, not recomputed later from a corpus that
 * has since changed.
 *
 * Nothing is invented below the floor. The four percentile columns stay NULL and
 * `suppressedReason` carries the count — the biconditional CHECK on the table enforces exactly
 * that pairing, so a row with a reason and a value is rejected by the database rather than by
 * anyone's discipline.
 */
export async function publishCompetencyBenchmarks(
    params: PublishBenchmarksParams,
): Promise<Measured<BenchmarkPublication>> {
    const roleKey = (params.roleKey ?? '').trim();
    if (!roleKey) {
        return refused('no role was named, so there is no pool to publish a benchmark for');
    }

    // Sessions of this role. Equality on `role`, which PostgREST can serve; the completion and
    // mode filters run in JS because the shim cannot push a `not null` test through `where`.
    const sessions = (await supabaseDb.interviewSession.findMany({
        where: { role: roleKey },
    })) as Array<Record<string, any>>;

    const sessionIds = new Set<string>();
    const candidateIds = new Set<string>();

    for (const session of sessions) {
        if (TERMINAL_SESSION_MODES.includes(String(session.mode))) continue;
        if (!session.completedAt) continue;
        const id = session.id ? String(session.id) : '';
        if (!id) continue;
        sessionIds.add(id);
        if (session.userId) candidateIds.add(String(session.userId));
    }

    if (sessionIds.size === 0) {
        return refused(
            `no completed interview carries the role "${roleKey}", so there is no pool to publish a benchmark from`,
        );
    }

    // `sessionId: { in: [...] }` is answered by loading the table and filtering in JS — see the
    // shim's note on operators. `AbilityHistory` grows by one row per competency per
    // recomputation, so it is not small forever; the narrowing to one role happens here rather
    // than in the database, and that cost is stated rather than hidden.
    const history = (await supabaseDb.abilityHistory.findMany({
        where: { sessionId: { in: [...sessionIds] } },
    })) as Array<Record<string, any>>;

    const requested =
        params.competencyIds && params.competencyIds.length > 0 ? new Set(params.competencyIds) : null;

    /** competencyId -> userId -> the latest estimate, by timestamp. */
    const latest = new Map<string, Map<string, { theta: number; at: number }>>();
    let estimatesRead = 0;

    for (const row of history) {
        const sessionId = row.sessionId ? String(row.sessionId) : '';
        if (!sessionIds.has(sessionId)) continue;
        estimatesRead += 1;

        const competencyId = row.competencyId ? String(row.competencyId) : '';
        const userId = row.userId ? String(row.userId) : '';
        if (!competencyId || !userId) continue;
        if (requested && !requested.has(competencyId)) continue;

        const theta = Number(row.theta);
        if (!Number.isFinite(theta)) continue;

        const at = readTime(row.recordedAt) ?? 0;
        let byUser = latest.get(competencyId);
        if (!byUser) {
            byUser = new Map();
            latest.set(competencyId, byUser);
        }
        const seen = byUser.get(userId);
        // The latest estimate wins. Ties keep the first read, which is deterministic given the
        // query's order — and two estimates written in the same millisecond are the same
        // measurement recorded twice, not a movement to choose between.
        if (!seen || at > seen.at) byUser.set(userId, { theta, at });
    }

    const competencies = (await supabaseDb.competency.findMany({})) as Array<Record<string, any>>;
    const competencyById = new Map<string, Record<string, any>>();
    for (const row of competencies) competencyById.set(String(row.id), row);

    const existingRows = (await supabaseDb.benchmark.findMany({ where: { roleKey } })) as Array<Record<string, any>>;
    const existingByCompetency = new Map<string, Record<string, any>>();
    for (const row of existingRows) {
        if (row.competencyId) existingByCompetency.set(String(row.competencyId), row);
    }

    const now = new Date().toISOString();
    const outcome: BenchmarkPublication = {
        roleKey,
        candidates: candidateIds.size,
        candidatesWithEstimates: 0,
        estimatesRead,
        competenciesConsidered: latest.size,
        published: 0,
        suppressed: 0,
        unchanged: 0,
        outcomes: [],
        caveats: [],
    };

    const scoredCandidates = new Set<string>();

    for (const [competencyId, byUser] of [...latest.entries()].sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
    )) {
        for (const userId of byUser.keys()) scoredCandidates.add(userId);

        const scores = [...byUser.values()].map((entry) => entry.theta);
        const summary = summariseCohort(scores, MIN_BENCHMARK_COHORT);
        const row = competencyById.get(competencyId);
        const slug = row && typeof row.slug === 'string' ? row.slug : null;

        const published = summary.state === 'computed';
        if (published) outcome.published += 1;
        else outcome.suppressed += 1;

        const existing = existingByCompetency.get(competencyId);
        const cohortSize = published ? summary.value.cohortSize : scores.length;
        const suppression = published ? null : summary.reason;

        const unchanged =
            existing !== undefined &&
            Number(existing.cohortSize) === cohortSize &&
            Number(existing.minCohortN) === MIN_BENCHMARK_COHORT &&
            (existing.suppressedReason ?? null) === suppression &&
            (published
                ? numberOrNull(existing.p25) === summary.value.p25 &&
                  numberOrNull(existing.p50) === summary.value.p50 &&
                  numberOrNull(existing.p75) === summary.value.p75 &&
                  numberOrNull(existing.p90) === summary.value.p90
                : true);

        if (unchanged) outcome.unchanged += 1;

        // The data payload is written in full either way — a row crossing the floor upward must
        // lose its suppression reason in the same statement that gains its percentiles, because
        // the table's CHECK rejects the intermediate state.
        const data: Record<string, unknown> = {
            roleKey,
            competencyId,
            competencySlug: slug,
            cohortSize,
            minCohortN: MIN_BENCHMARK_COHORT,
            p25: published ? summary.value.p25 : null,
            p50: published ? summary.value.p50 : null,
            p75: published ? summary.value.p75 : null,
            p90: published ? summary.value.p90 : null,
            suppressedReason: suppression,
            updatedAt: now,
        };

        if (!unchanged && !params.dryRun) {
            if (existing) {
                await supabaseDb.benchmark.update({ where: { id: existing.id }, data });
            } else {
                await supabaseDb.benchmark.create({ data });
            }
        }

        outcome.outcomes.push({
            competencyId,
            competencySlug: slug,
            cohortSize,
            published,
            suppressedReason: suppression,
            written: !unchanged && !params.dryRun,
        });
    }

    outcome.candidatesWithEstimates = scoredCandidates.size;

    if (outcome.candidates > outcome.candidatesWithEstimates) {
        outcome.caveats.push(
            `${outcome.candidates - outcome.candidatesWithEstimates} of the ${outcome.candidates} candidates in this role have no recorded ability estimate, so they are in no pool below. They are absent, not zero.`,
        );
    }
    if (outcome.suppressed > 0) {
        outcome.caveats.push(
            `${outcome.suppressed} of ${outcome.competenciesConsidered} competencies are stored with no percentiles and the reason they have none. A suppressed row is written rather than skipped, so the count that caused it is readable later.`,
        );
    }
    if (params.dryRun) {
        outcome.caveats.push('This was a dry run: nothing was written.');
    }

    return computed(outcome);
}

function numberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A timestamp in milliseconds, or null when the column is not a date. */
function readTime(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    const time = date.getTime();
    return Number.isNaN(time) ? null : time;
}
