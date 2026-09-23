// ============================================
// abilityService.ts — Ability estimation orchestration
// Part of the Competency Measurement Engine (Feature 1)
//
// The DB-facing service: reads response history, resolves item parameters and
// competencies, runs the pure estimators, and persists the result.
//
// All statistics live in irt.ts / calibrationMath.ts / competencyGraph.ts /
// selectionMath.ts. This file contains no formulas — only plumbing.
// ============================================

import supabaseDb from '@/lib/supabaseDb';
import { deriveCorrectness, type DimensionScores } from './calibrationMath';
import { resolveItemParametersForText } from './calibration';
import {
    DEFAULT_TARGET_SE,
    confidenceInterval,
    estimateAbility,
    isPreciseEnough,
    thetaToScaleScore,
    type ScoredResponse,
} from './irt';
import {
    propagateMastery,
    rankImprovementTargets,
    type CompetencyEdgeInput,
    type CompetencyNodeEstimate,
} from './competencyGraph';
import { stopDecision, targetDifficultyFor, type StopDecision } from './selectionMath';

// --------------------------------------------
// Competency identity
// --------------------------------------------

/**
 * Slugifies a competency name so the same skill always maps to one row.
 * Kept in step with the name's meaning: punctuation and spacing collapse, case is
 * folded, and everything else is preserved.
 */
export function slugifyCompetency(name: string): string {
    return (name || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

/** Finds a competency by slug, creating it if absent. */
export async function ensureCompetency(
    name: string,
    options: { description?: string; parentId?: string } = {}
): Promise<{ id: string; name: string; slug: string } | null> {
    const slug = slugifyCompetency(name);
    if (!slug) return null;

    const existing = await supabaseDb.competency.findFirst({ where: { slug } });
    if (existing) return existing;

    return supabaseDb.competency.create({
        data: {
            name: name.trim(),
            slug,
            description: options.description ?? null,
            parentId: options.parentId ?? null,
        },
    });
}

/**
 * Resolves the competency a question belongs to.
 *
 * Explicit `competencyId` wins. Otherwise the legacy `category` is promoted into
 * a competency — this is what lets the measurement engine work against existing
 * data with no manual curation pass. A question with neither is left unattributed
 * rather than dumped into a catch-all bucket, because a catch-all competency would
 * average unrelated skills together and report a meaningless number.
 */
export async function resolveCompetencyForQuestion(question: {
    competencyId?: string | null;
    category?: string | null;
}): Promise<{ id: string; name: string; slug: string } | null> {
    if (question.competencyId) {
        const explicit = await supabaseDb.competency.findFirst({ where: { id: question.competencyId } });
        if (explicit) return explicit;
    }

    const category = (question.category || '').trim();
    if (!category) return null;

    return ensureCompetency(category);
}

// --------------------------------------------
// Profile shapes
// --------------------------------------------

export interface CompetencyAbility {
    competencyId: string;
    name: string;
    slug: string;
    /** Measured ability on the logit scale. */
    theta: number;
    /** Ability after prerequisite discounting. */
    effectiveTheta: number;
    /** How much the prerequisites discounted the estimate (≥ 0). */
    discount: number;
    standardError: number;
    /** 0-100 display scale. Never compute with this. */
    scaleScore: number;
    confidenceInterval: { low: number; high: number };
    /** 1 - SE² — share of the estimate that is signal rather than noise. */
    reliability: number;
    /** Whether SE is within the target — i.e. whether this is actionable yet. */
    isPrecise: boolean;
    responsesUsed: number;
    /** Prerequisites dragging this competency down, strongest first. */
    limitingCompetencies: Array<{ competencyId: string; shortfall: number }>;
    updatedAt: string | null;
}

export interface AbilityProfile {
    userId: string;
    /** Precision-weighted mean ability across measured competencies. */
    overall: {
        theta: number;
        standardError: number;
        scaleScore: number;
        confidenceInterval: { low: number; high: number };
        competencyCount: number;
        /** True when every component estimate is precise enough to act on. */
        isPrecise: boolean;
    };
    competencies: CompetencyAbility[];
    /** Ordered "what to work on next", already filtered to real gaps. */
    improvementTargets: Array<{
        competencyId: string;
        gap: number;
        effectiveTheta: number;
        trustworthy: boolean;
    }>;
    /** Competencies with enough data to be measured at all. */
    measuredCount: number;
    targetStandardError: number;
}

// --------------------------------------------
// History loading
// --------------------------------------------

interface AttributedResponse {
    competencyId: string;
    competencyName: string;
    competencySlug: string;
    scored: ScoredResponse;
    sessionId: string;
}

/**
 * Loads every scorable response for a user and attributes it to a competency.
 *
 * Attribution is the expensive part (a find-or-create per distinct category), so
 * distinct categories are resolved once and memoised within the call rather than
 * per response.
 */
async function loadAttributedResponses(
    userId: string,
    options: { createCompetencies?: boolean } = {}
): Promise<{ attributed: AttributedResponse[]; skipped: number }> {
    const sessions = await supabaseDb.interviewSession.findMany({
        where: { userId },
        select: { id: true },
    });
    if (sessions.length === 0) return { attributed: [], skipped: 0 };

    const sessionIds = sessions.map((session: any) => session.id);

    const responses = await supabaseDb.response.findMany({
        where: { sessionId: { in: sessionIds } },
        select: {
            id: true,
            sessionId: true,
            questionId: true,
            technicalScore: true,
            communicationScore: true,
            confidenceScore: true,
            logicScore: true,
            depthScore: true,
        },
    });
    if (responses.length === 0) return { attributed: [], skipped: 0 };

    const questions = await supabaseDb.question.findMany({
        where: { sessionId: { in: sessionIds } },
        select: { id: true, text: true, category: true, difficulty: true, competencyId: true },
    });
    const questionById = new Map<string, any>(questions.map((q: any) => [q.id, q]));

    const competencyCache = new Map<string, { id: string; name: string; slug: string } | null>();
    const attributed: AttributedResponse[] = [];
    let skipped = 0;

    for (const response of responses) {
        const question = questionById.get(response.questionId);
        if (!question) {
            skipped += 1;
            continue;
        }

        const cacheKey = question.competencyId || `category:${(question.category || '').toLowerCase()}`;
        let competency = competencyCache.get(cacheKey);
        if (competency === undefined) {
            competency = options.createCompetencies === false
                ? await resolveExistingCompetency(question)
                : await resolveCompetencyForQuestion(question);
            competencyCache.set(cacheKey, competency);
        }

        // A question with no competency and no category cannot be attributed; it
        // is skipped rather than pooled into a meaningless bucket.
        if (!competency) {
            skipped += 1;
            continue;
        }

        const scores: DimensionScores = {
            technicalScore: Number(response.technicalScore) || 0,
            communicationScore: Number(response.communicationScore) || 0,
            confidenceScore: Number(response.confidenceScore) || 0,
            logicScore: Number(response.logicScore) || 0,
            depthScore: Number(response.depthScore) || 0,
        };

        const params = await resolveItemParametersForText(question.text || '', question.difficulty);

        attributed.push({
            competencyId: competency.id,
            competencyName: competency.name,
            competencySlug: competency.slug,
            sessionId: response.sessionId,
            scored: {
                item: { a: params.a, b: params.b, c: params.c },
                correct: deriveCorrectness(scores, question.category),
            },
        });
    }

    return { attributed, skipped };
}

/** Read-only variant of competency resolution, for profile reads that must not write. */
async function resolveExistingCompetency(question: {
    competencyId?: string | null;
    category?: string | null;
}): Promise<{ id: string; name: string; slug: string } | null> {
    if (question.competencyId) {
        const explicit = await supabaseDb.competency.findFirst({ where: { id: question.competencyId } });
        if (explicit) return explicit;
    }

    const slug = slugifyCompetency(question.category || '');
    if (!slug) return null;

    return supabaseDb.competency.findFirst({ where: { slug } });
}

// --------------------------------------------
// Recompute
// --------------------------------------------

export interface RecomputeResult {
    profile: AbilityProfile;
    /** Number of competencies whose estimate was written. */
    updated: number;
    /** Responses that could not be attributed to a competency. */
    skippedResponses: number;
    /** Competencies measured with too few responses to be precise yet. */
    imprecise: number;
}

/**
 * Recomputes and persists a user's ability estimates across all competencies.
 *
 * Called after a session completes. Every competency with at least one response
 * is re-estimated from the user's *full* history for that competency — not just
 * the latest session — because ability is a property of the person, not of one
 * sitting, and using the whole history is what makes the SE shrink over time.
 *
 * Writes:
 *   · AbilityEstimate — upserted, one row per (user, competency), the current state
 *   · AbilityHistory  — appended, one row per recomputation, the trajectory
 *
 * The history table is append-only so Feature 5 can derive growth and regression
 * without needing snapshots taken at the right moments.
 */
export async function recomputeUserAbilities(
    userId: string,
    options: { sessionId?: string } = {}
): Promise<RecomputeResult> {
    const { attributed, skipped } = await loadAttributedResponses(userId, { createCompetencies: true });

    const byCompetency = new Map<string, AttributedResponse[]>();
    for (const entry of attributed) {
        const bucket = byCompetency.get(entry.competencyId);
        if (bucket) bucket.push(entry);
        else byCompetency.set(entry.competencyId, [entry]);
    }

    const nodeEstimates: CompetencyNodeEstimate[] = [];

    for (const [competencyId, entries] of byCompetency) {
        const estimate = estimateAbility(entries.map((entry) => entry.scored));

        const existing = await supabaseDb.abilityEstimate.findFirst({
            where: { userId, competencyId },
        });

        const payload = {
            userId,
            competencyId,
            theta: estimate.theta,
            standardError: estimate.standardError,
            responsesUsed: entries.length,
            method: estimate.method,
            updatedAt: new Date().toISOString(),
        };

        if (existing) {
            await supabaseDb.abilityEstimate.update({ where: { id: existing.id }, data: payload });
        } else {
            await supabaseDb.abilityEstimate.create({ data: payload });
        }

        await supabaseDb.abilityHistory.create({
            data: {
                userId,
                competencyId,
                theta: estimate.theta,
                standardError: estimate.standardError,
                sessionId: options.sessionId ?? entries[entries.length - 1]?.sessionId ?? null,
                responsesUsed: entries.length,
                recordedAt: new Date().toISOString(),
            },
        });

        nodeEstimates.push({
            competencyId,
            theta: estimate.theta,
            standardError: estimate.standardError,
        });
    }

    const profile = await buildProfile(userId, nodeEstimates, byCompetency);

    return {
        profile,
        updated: nodeEstimates.length,
        skippedResponses: skipped,
        imprecise: profile.competencies.filter((competency) => !competency.isPrecise).length,
    };
}

/**
 * Reads the stored profile without recomputing or writing anything.
 *
 * Preferable for request paths: the stored estimates are already the result of
 * the last recomputation, and recomputing on a GET would make a read endpoint
 * write to the database.
 */
export async function getAbilityProfile(userId: string): Promise<AbilityProfile> {
    const estimates = await supabaseDb.abilityEstimate.findMany({ where: { userId } });

    const nodeEstimates: CompetencyNodeEstimate[] = estimates.map((row: any) => ({
        competencyId: row.competencyId,
        theta: row.theta,
        standardError: row.standardError,
    }));

    return buildProfile(userId, nodeEstimates, new Map(), estimates);
}

/**
 * Assembles a profile from raw estimates: attaches competency names, propagates
 * prerequisite discounts through the graph, and computes the overall figure.
 *
 * `usageByCompetency` is present on the recompute path (where the per-competency
 * response counts were just computed) and omitted on the read path, where the
 * stored `responsesUsed` is used instead.
 */
async function buildProfile(
    userId: string,
    nodeEstimates: CompetencyNodeEstimate[],
    usageByCompetency: Map<string, AttributedResponse[]>,
    storedEstimates?: any[]
): Promise<AbilityProfile> {
    const competencies = await supabaseDb.competency.findMany({
        select: { id: true, name: true, slug: true },
    });
    const competencyById = new Map<string, any>(competencies.map((c: any) => [c.id, c]));

    const edges = await supabaseDb.competencyEdge.findMany({
        select: { fromId: true, toId: true, relation: true, weight: true },
    });
    const graphEdges: CompetencyEdgeInput[] = edges.map((edge: any) => ({
        fromId: edge.fromId,
        toId: edge.toId,
        relation: edge.relation,
        weight: edge.weight,
    }));

    const propagated = propagateMastery(nodeEstimates, graphEdges);

    const storedByCompetency = new Map<string, any>(
        (storedEstimates ?? []).map((row: any) => [row.competencyId, row])
    );

    const detailed: CompetencyAbility[] = propagated
        .filter((estimate) => competencyById.has(estimate.competencyId))
        .map((estimate) => {
            const competency = competencyById.get(estimate.competencyId)!;
            const stored = storedByCompetency.get(estimate.competencyId);
            const responsesUsed =
                usageByCompetency.get(estimate.competencyId)?.length ??
                stored?.responsesUsed ??
                0;

            return {
                competencyId: estimate.competencyId,
                name: competency.name,
                slug: competency.slug,
                theta: estimate.theta,
                effectiveTheta: estimate.effectiveTheta,
                discount: estimate.discount,
                standardError: estimate.standardError,
                scaleScore: thetaToScaleScore(estimate.effectiveTheta),
                confidenceInterval: confidenceInterval(
                    estimate.effectiveTheta,
                    estimate.standardErrorAfterPropagation
                ),
                reliability: Math.max(0, 1 - estimate.standardErrorAfterPropagation ** 2),
                isPrecise: isPreciseEnough(estimate.standardErrorAfterPropagation),
                responsesUsed,
                limitingCompetencies: estimate.limitingCompetencies,
                updatedAt: stored?.updatedAt ? new Date(stored.updatedAt).toISOString() : null,
            };
        })
        .sort((x, y) => y.effectiveTheta - x.effectiveTheta);

    return {
        userId,
        overall: computeOverall(detailed),
        competencies: detailed,
        improvementTargets: rankImprovementTargets(propagated),
        measuredCount: detailed.length,
        targetStandardError: DEFAULT_TARGET_SE,
    };
}

/**
 * The headline number: a precision-weighted mean of competency abilities.
 *
 * Weighting by 1/SE² is what makes this honest. A plain average would let a
 * competency measured from three responses count as much as one measured from
 * forty — which is how a single lucky session ends up reported as a person's
 * overall ability.
 */
function computeOverall(competencies: CompetencyAbility[]): AbilityProfile['overall'] {
    if (competencies.length === 0) {
        return {
            theta: 0,
            standardError: 1,
            scaleScore: 50,
            confidenceInterval: confidenceInterval(0, 1),
            competencyCount: 0,
            isPrecise: false,
        };
    }

    let weightSum = 0;
    let weightedTheta = 0;
    for (const competency of competencies) {
        const weight = 1 / Math.max(competency.standardError ** 2, 1e-6);
        weightSum += weight;
        weightedTheta += competency.effectiveTheta * weight;
    }

    const theta = weightSum > 0 ? weightedTheta / weightSum : 0;

    // SE of a weighted mean under independence: 1/√(Σw), with w = 1/SE².
    const standardError = weightSum > 0 ? 1 / Math.sqrt(weightSum) : 1;

    return {
        theta,
        standardError,
        scaleScore: thetaToScaleScore(theta),
        confidenceInterval: confidenceInterval(theta, standardError),
        competencyCount: competencies.length,
        // Every component must be precise, not just the aggregate — a confident
        // average over one confident and one vague competency is not a confident
        // profile.
        isPrecise: competencies.every((competency) => competency.isPrecise),
    };
}

// --------------------------------------------
// Adaptive steering
// --------------------------------------------

export interface AdaptiveTarget {
    userId: string;
    competencyId: string | null;
    competencyName: string | null;
    /** Current ability estimate, or 0 with SE = 1 when nothing is measured yet. */
    theta: number;
    standardError: number;
    /**
     * Difficulty to aim the next question at. This is the value to hand to
     * question generation — it replaces the LLM's self-reported
     * increase/decrease/maintain with a measured target.
     */
    targetDifficulty: number;
    /** How far the target sits from the middle of the scale, for prompt phrasing. */
    intensity: 'remedial' | 'below-level' | 'at-level' | 'above-level' | 'stretch';
    stop: StopDecision;
    /** True when the estimate is already precise enough to act on. */
    isPrecise: boolean;
    /** Answers behind this estimate. 0 when nothing has been measured yet. */
    responsesUsed: number;
    /**
     * Whether this target rests on evidence. `prior` means the candidate has no
     * measured ability for the competency, so θ is the starting value 0 and the
     * target is "start in the middle" — a caller that already has a difficulty
     * heuristic should keep using it rather than reading a prior as a measurement.
     */
    source: 'measured' | 'prior';
}

/**
 * Computes what to ask next for a candidate.
 *
 * This is the integration point with the interview flow. The engine does not pick
 * a question from a bank — there is no bank of reusable items in this platform
 * (questions are generated per session). Instead it answers the question the
 * interviewer prompt actually needs: *how hard, and on what*, given everything we
 * have measured about this person so far.
 *
 * When the candidate has no measured history, this returns the prior: θ = 0,
 * SE = 1, target difficulty 0 — i.e. "start in the middle and find out", which is
 * the correct behaviour rather than a guess dressed up as an estimate.
 *
 * When no competency is named, the one picked is the *least certain* — the
 * largest standard error among competencies the candidate has actually answered
 * on, tie-broken by the lower estimate. That is where the next question buys the
 * most information, which is the whole premise of adaptive testing. (Picking the
 * weakest would instead re-measure what is already known, and the profile stores
 * competencies strongest-first, so index 0 would have been the opposite of the
 * right choice.)
 */
export async function getAdaptiveTarget(params: {
    userId: string;
    competencyId?: string | null;
    itemsAnswered?: number;
    itemsAvailable?: number;
    targetSe?: number;
}): Promise<AdaptiveTarget> {
    const profile = await getAbilityProfile(params.userId);

    const competency = params.competencyId
        ? profile.competencies.find((entry) => entry.competencyId === params.competencyId)
        : [...profile.competencies]
              // Only competencies with their own answers can steer generation; a
              // value inherited through a prerequisite is not this person's
              // measured ability on that competency.
              .filter((entry) => entry.responsesUsed > 0)
              .sort(
                  (x, y) =>
                      y.standardError - x.standardError ||
                      x.effectiveTheta - y.effectiveTheta
              )[0];

    const theta = competency?.effectiveTheta ?? profile.overall.theta;
    const standardError = competency?.standardError ?? profile.overall.standardError;
    const targetSe = params.targetSe ?? DEFAULT_TARGET_SE;

    const stop = stopDecision({
        standardError,
        itemsAnswered: params.itemsAnswered ?? 0,
        // Absent an explicit bank, treat items as available: generation can always
        // produce another question. Callers with a fixed bank must pass a real count.
        itemsAvailable: params.itemsAvailable ?? Number.MAX_SAFE_INTEGER,
        theta,
        targetSe,
    });

    return {
        userId: params.userId,
        competencyId: competency?.competencyId ?? null,
        competencyName: competency?.name ?? null,
        theta,
        standardError,
        targetDifficulty: targetDifficultyFor(theta),
        intensity: intensityFor(theta),
        stop,
        isPrecise: isPreciseEnough(standardError, targetSe),
        responsesUsed: competency?.responsesUsed ?? 0,
        source: competency && competency.responsesUsed > 0 ? 'measured' : 'prior',
    };
}

/** Describes where a target difficulty sits on the scale, for prompt phrasing. */
function intensityFor(theta: number): AdaptiveTarget['intensity'] {
    if (theta <= -1.5) return 'remedial';
    if (theta < -0.4) return 'below-level';
    if (theta <= 0.4) return 'at-level';
    if (theta <= 1.5) return 'above-level';
    return 'stretch';
}

/**
 * Ability trajectory for a competency (or the whole profile when omitted).
 *
 * Ordered oldest first so a chart can plot it directly. The full longitudinal
 * analysis — slope, stagnation, regression alerts — belongs to Feature 5; this
 * returns the raw series that feature will consume.
 */
export async function getAbilityHistory(
    userId: string,
    options: { competencyId?: string; limit?: number } = {}
): Promise<Array<{ competencyId: string; theta: number; standardError: number; responsesUsed: number; recordedAt: string }>> {
    const rows = await supabaseDb.abilityHistory.findMany({
        where: options.competencyId
            ? { userId, competencyId: options.competencyId }
            : { userId },
        orderBy: { recordedAt: 'asc' },
    });

    const limited = options.limit ? rows.slice(-options.limit) : rows;

    return limited.map((row: any) => ({
        competencyId: row.competencyId,
        theta: row.theta,
        standardError: row.standardError,
        responsesUsed: row.responsesUsed,
        recordedAt: new Date(row.recordedAt).toISOString(),
    }));
}
