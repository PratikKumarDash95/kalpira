// ============================================
// competencyGraph.ts — Prerequisite propagation
// Part of the Competency Measurement Engine (Feature 1)
//
// PURE MODULE. No DB, no network.
//
// Measurement gives a per-competency ability estimate. The graph turns those into
// a claim a person can act on: "you can't be strong in Kubernetes if containers
// are weak".
//
// The model, stated plainly because it is a judgement call rather than a law:
//
//   effective(node) = own − damping · Σ wᵢ · max(0, own − prereqᵢ) / Σ wᵢ
//
// i.e. a node's effective ability is dragged down in proportion to how far it
// exceeds its prerequisites. If those prerequisites are met, nothing changes; if
// the node claims more than its foundations support, the claim is discounted.
//
// Why not a hard cap at the weakest prerequisite? Because a candidate can
// genuinely know a specific advanced tool without the theory underneath it — a
// hard cap would tell a real person something false. Damping discounts the claim
// without erasing it.
//
// DAMPING = 0.5 means at most half of the gap above prerequisites is discounted.
// ============================================

export const DEFAULT_DAMPING = 0.5;

/** An ability estimate attached to a node of the graph. */
export interface CompetencyNodeEstimate {
    competencyId: string;
    /** Measured ability on the logit scale. */
    theta: number;
    /** Standard error of the estimate. */
    standardError: number;
}

/** A directed relation. `fromId` is the prerequisite of `toId`. */
export interface CompetencyEdgeInput {
    fromId: string;
    toId: string;
    relation: string;
    weight: number;
}

export interface PropagatedEstimate extends CompetencyNodeEstimate {
    /** Ability after prerequisite discounting. */
    effectiveTheta: number;
    /** How much was discounted, in logit units. Always ≥ 0. */
    discount: number;
    /** Prerequisite competencies that dragged this one down, strongest first. */
    limitingCompetencies: Array<{ competencyId: string; shortfall: number }>;
    standardErrorAfterPropagation: number;
}

/**
 * Propagates prerequisite discounts through the graph.
 *
 * Edges whose `relation` is not 'prerequisite' are ignored — a merely *related*
 * skill should never drag an estimate down. Edges whose endpoints are missing
 * from `estimates` are ignored too: an unknown prerequisite is not evidence of
 * weakness, and treating it as such would penalise candidates for gaps in our
 * own data.
 *
 * Cycles are tolerated. A cycle means the graph is wrong, but propagation must
 * still return something finite and stable rather than hang, so each node is
 * resolved against the *measured* estimates of its prerequisites, never against
 * other propagated values. That makes the result well-defined regardless of
 * graph shape, and independent of iteration order.
 */
export function propagateMastery(
    estimates: CompetencyNodeEstimate[],
    edges: CompetencyEdgeInput[],
    damping: number = DEFAULT_DAMPING
): PropagatedEstimate[] {
    const byId = new Map(estimates.map((estimate) => [estimate.competencyId, estimate]));

    // Group prerequisite edges by the node they constrain.
    const prerequisitesByNode = new Map<string, Array<{ prereqId: string; weight: number }>>();
    for (const edge of edges) {
        if (edge.relation !== 'prerequisite') continue;
        if (!byId.has(edge.fromId) || !byId.has(edge.toId)) continue;

        const weight = Number.isFinite(edge.weight) && edge.weight > 0 ? edge.weight : 1;
        const bucket = prerequisitesByNode.get(edge.toId);
        if (bucket) bucket.push({ prereqId: edge.fromId, weight });
        else prerequisitesByNode.set(edge.toId, [{ prereqId: edge.fromId, weight }]);
    }

    return estimates.map((estimate) => {
        const prerequisites = prerequisitesByNode.get(estimate.competencyId) ?? [];

        if (prerequisites.length === 0) {
            return {
                ...estimate,
                effectiveTheta: estimate.theta,
                discount: 0,
                limitingCompetencies: [],
                standardErrorAfterPropagation: estimate.standardError,
            };
        }

        const totalWeight = prerequisites.reduce((sum, p) => sum + p.weight, 0);
        const shortfalls: Array<{ competencyId: string; shortfall: number }> = [];

        let weightedShortfall = 0;
        for (const prerequisite of prerequisites) {
            const prereqEstimate = byId.get(prerequisite.prereqId)!;
            const shortfall = Math.max(0, estimate.theta - prereqEstimate.theta);
            weightedShortfall += shortfall * prerequisite.weight;
            if (shortfall > 0) {
                shortfalls.push({ competencyId: prerequisite.prereqId, shortfall });
            }
        }

        const meanShortfall = totalWeight > 0 ? weightedShortfall / totalWeight : 0;
        const discount = damping * meanShortfall;
        const effectiveTheta = estimate.theta - discount;

        // Propagated uncertainty: the discount is computed from prerequisite
        // estimates which are themselves uncertain, so the error compounds. The
        // discounted share is added in quadrature to the node's own SE.
        const meanPrereqSe =
            prerequisites.reduce(
                (sum, p) => sum + (byId.get(p.prereqId)!.standardError || 0),
                0
            ) / prerequisites.length;
        const propagatedSe = Math.sqrt(
            estimate.standardError ** 2 + (damping * meanPrereqSe) ** 2
        );

        shortfalls.sort((x, y) => y.shortfall - x.shortfall);

        return {
            ...estimate,
            effectiveTheta,
            discount,
            limitingCompetencies: shortfalls,
            standardErrorAfterPropagation: propagatedSe,
        };
    });
}

/**
 * Ranks competencies by how much they are holding the candidate back —
 * effective shortfall below the candidate's own best competency.
 *
 * This is the "what should I work on" ordering: a competency far below the
 * candidate's demonstrated ceiling, with a tight enough estimate to be real,
 * is the most valuable thing to fix. Competencies whose estimates are still too
 * imprecise to trust are pushed down rather than recommended on noise.
 */
export function rankImprovementTargets(
    propagated: PropagatedEstimate[],
    options: { targetSe?: number } = {}
): Array<{ competencyId: string; gap: number; effectiveTheta: number; trustworthy: boolean }> {
    const targetSe = options.targetSe ?? 0.35;
    if (propagated.length === 0) return [];

    const ceiling = Math.max(...propagated.map((estimate) => estimate.effectiveTheta));

    return propagated
        .map((estimate) => ({
            competencyId: estimate.competencyId,
            gap: ceiling - estimate.effectiveTheta,
            effectiveTheta: estimate.effectiveTheta,
            trustworthy: estimate.standardErrorAfterPropagation <= targetSe,
        }))
        .filter((entry) => entry.gap > 0)
        .sort((x, y) => {
            // Trustworthy targets first, then by size of gap.
            if (x.trustworthy !== y.trustworthy) return x.trustworthy ? -1 : 1;
            return y.gap - x.gap;
        });
}
