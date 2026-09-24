// ============================================
// clusterMath.ts — grouping themes by meaning, reproducibly
// ============================================
// Pure. No database, no network, no clock.
//
// Synthesis emits theme labels as free text. "Pricing objections", "concerns about
// cost" and "budget pushback" are one theme to a reader and three unrelated strings
// to a database, so nothing can be counted over time until labels acquire an
// identity. This module is what gives them one.
//
// WHY THE RESULT HAS TO BE REPRODUCIBLE
//
// A cluster id is written onto every occurrence that belongs to it, and a trend is
// the count of occurrences per period. If a sweep produced different clusters from
// identical input, every occurrence would be re-pointed, counts would move without
// any new interview having happened, and the trend line would report the
// clustering's noise as a change in the world. So the initialisation is seeded and
// the iteration order is fixed: same input, same clusters, every time.
//
// WHY INCREMENTAL ASSIGNMENT EXISTS BESIDE FULL CLUSTERING
//
// Re-clustering the whole corpus on every sweep has the same defect one level up:
// cluster A and cluster B can swap members, or a cluster can be renumbered, and a
// series that was stable becomes a series that jumped. `assignToNearest` is the
// normal path — a new theme joins the cluster it is closest to, and existing ids
// never move. `kmeans` is for a deliberate rebuild, exposed as its own operation
// rather than run implicitly, because it is the step that can rewrite history.

import { computed, refused } from '../measured';
import type { Measured } from '../measured';
import {
    MAX_CLUSTER_ITERATIONS,
    MAX_CLUSTERS,
} from './contract';
import { centroid, cosineSimilarity, isUsableVector } from './vectorMath';

/** A point to cluster. `id` is carried through untouched and only used for output. */
export interface ClusterPoint {
    id: string;
    vector: number[];
}

/** One cluster of the result. */
export interface Cluster {
    /** Position in the result, stable for a given input and k. */
    index: number;
    /** Unit vector on the same sphere as the members. */
    centroid: number[];
    memberIds: string[];
}

export interface ClusterResult {
    clusters: Cluster[];
    k: number;
    iterations: number;
    converged: boolean;
    /** Distinct points that could be compared; unusable ones are excluded. */
    pointsUsed: number;
    pointsSkipped: number;
}

/**
 * A seeded PRNG (mulberry32).
 *
 * `Math.random` would make the initialisation differ between runs, and k-means only
 * guarantees a local optimum — so two sweeps over identical data could settle on
 * different clusterings and rewrite every count. The seed is a parameter so a caller
 * can reproduce a specific run, and defaults to a constant so the ordinary path is
 * stable without anyone having to think about it.
 */
function mulberry32(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * The k a corpus should be clustered into when the caller has no opinion.
 *
 * The square-root rule — sqrt(n/2) — is a heuristic, and it is labelled as one. It
 * is bounded below at 1 and above by `MAX_CLUSTERS` so a corpus of unrelated labels
 * cannot be shredded into near-singletons, where every cluster means nothing and the
 * count of clusters looks like a finding.
 */
export function suggestK(pointCount: number): number {
    if (pointCount <= 1) return Math.max(pointCount, 0);
    const estimated = Math.round(Math.sqrt(pointCount / 2));
    return Math.max(1, Math.min(estimated, MAX_CLUSTERS, pointCount));
}

/**
 * Cluster points by cosine similarity (spherical k-means).
 *
 * Members are assigned to the centroid they are most similar to, and centroids are
 * the normalised mean of their members. The normalisation is not cosmetic: cluster
 * membership is decided by cosine, so a centroid off the unit sphere would be
 * compared on a different scale from the points it is meant to represent.
 *
 * An emptied cluster keeps its previous centroid rather than being dropped. Dropping
 * it would make k depend on the data, so a caller asking for 8 clusters could get 6
 * and never learn why; keeping it means k is what the caller asked for and the
 * cluster reports zero members, which is a fact they can act on.
 */
export function kmeans(
    points: ClusterPoint[],
    k: number,
    options: { seed?: number; maxIterations?: number } = {},
): Measured<ClusterResult> {
    const usable = points.filter((point) => isUsableVector(point.vector));
    const skipped = points.length - usable.length;

    if (usable.length === 0) {
        return refused('no points had a usable vector, so there is nothing to cluster');
    }
    if (!Number.isInteger(k) || k < 1) {
        return refused(`the requested cluster count was ${k}, and clustering needs at least one`);
    }
    if (k > usable.length) {
        return refused(
            `the requested cluster count was ${k} for ${usable.length} comparable ${usable.length === 1 ? 'point' : 'points'}, and a cluster needs at least one member`,
        );
    }

    const dim = usable[0].vector.length;
    const comparable = usable.filter((point) => point.vector.length === dim);
    if (comparable.length < k) {
        return refused(
            `${usable.length - comparable.length} points had a different number of dimensions from the rest, leaving ${comparable.length} comparable ${comparable.length === 1 ? 'point' : 'points'} for ${k} clusters`,
        );
    }

    const random = mulberry32(options.seed ?? 20260925);
    const maxIterations = options.maxIterations ?? MAX_CLUSTER_ITERATIONS;

    // ---- k-means++ initialisation -------------------------------------------
    // The first centre is drawn from the points; each next is drawn with probability
    // proportional to its squared distance from the nearest centre already chosen, so
    // the seeds start spread out rather than clustered where the data happens to be
    // dense. Plain random seeding is the usual cause of a k-means run settling in a
    // visibly wrong arrangement.
    const centres: number[][] = [];
    const firstIndex = Math.floor(random() * comparable.length);
    centres.push(comparable[Math.min(firstIndex, comparable.length - 1)].vector);

    while (centres.length < k) {
        const distances = comparable.map((point) => {
            let best = 1;
            for (const centre of centres) {
                const similarity = cosineSimilarity(point.vector, centre);
                if (similarity.state === 'computed') best = Math.min(best, 1 - similarity.value);
            }
            return best * best;
        });
        const total = distances.reduce((sum, value) => sum + value, 0);

        let chosen = -1;
        if (total === 0) {
            // Every point coincides with a centre already chosen, so there is no
            // distance to weight by. Take the first point that is not an exact match
            // of an existing centre, keeping the k centres distinct; if they all are,
            // the corpus is one repeated label and any point will do.
            chosen = comparable.findIndex((point) =>
                !centres.some((centre) => {
                    const similarity = cosineSimilarity(point.vector, centre);
                    return similarity.state === 'computed' && similarity.value >= 1 - 1e-12;
                }),
            );
            if (chosen === -1) chosen = 0;
        } else {
            let target = random() * total;
            for (let index = 0; index < distances.length; index += 1) {
                target -= distances[index];
                if (target <= 0) {
                    chosen = index;
                    break;
                }
            }
            if (chosen === -1) chosen = distances.length - 1;
        }
        centres.push(comparable[chosen].vector);
    }

    // ---- Lloyd iterations ---------------------------------------------------
    let assignment = new Array<number>(comparable.length).fill(-1);
    let iterations = 0;
    let converged = false;

    while (iterations < maxIterations) {
        iterations += 1;
        let changed = false;

        for (let index = 0; index < comparable.length; index += 1) {
            let best = 0;
            let bestSimilarity = -Infinity;
            for (let centreIndex = 0; centreIndex < centres.length; centreIndex += 1) {
                const similarity = cosineSimilarity(comparable[index].vector, centres[centreIndex]);
                if (similarity.state !== 'computed') continue;
                // Strictly greater keeps the lower centre index on an exact tie, which
                // is what makes the outcome independent of iteration order.
                if (similarity.value > bestSimilarity) {
                    bestSimilarity = similarity.value;
                    best = centreIndex;
                }
            }
            if (assignment[index] !== best) {
                assignment[index] = best;
                changed = true;
            }
        }

        for (let centreIndex = 0; centreIndex < centres.length; centreIndex += 1) {
            const members = comparable.filter((_, index) => assignment[index] === centreIndex);
            if (members.length === 0) continue; // keep the previous centre
            const recomputed = centroid(members.map((point) => point.vector));
            if (recomputed.state === 'computed') centres[centreIndex] = recomputed.value;
        }

        if (!changed) {
            converged = true;
            break;
        }
    }

    const clusters: Cluster[] = centres.map((centre, index) => ({
        index,
        centroid: centre,
        memberIds: comparable.filter((_, pointIndex) => assignment[pointIndex] === index).map((point) => point.id),
    }));

    return computed({
        clusters,
        k,
        iterations,
        converged,
        pointsUsed: comparable.length,
        pointsSkipped: skipped + (usable.length - comparable.length),
    });
}

/**
 * The cluster a vector belongs to, or a refusal when none is close enough.
 *
 * The refusal is the feature, not a failure. Without a threshold every theme joins
 * some cluster, so a genuinely new theme — the one a researcher most wants to see —
 * is silently filed under the nearest old one, and its first appearance is lost. A
 * refusal is what lets the caller create a cluster instead.
 */
export function assignToNearest(
    centres: Array<{ id: string; centroid: number[] }>,
    vector: number[],
    threshold: number,
): Measured<{ id: string; similarity: number }> {
    if (centres.length === 0) {
        return refused('there are no existing clusters to assign to');
    }
    if (!isUsableVector(vector)) {
        return refused('the vector was empty, zero, or contained a value that is not a finite number');
    }

    let bestId: string | null = null;
    let bestSimilarity = -Infinity;

    for (const centre of centres) {
        const similarity = cosineSimilarity(vector, centre.centroid);
        if (similarity.state !== 'computed') continue;
        if (similarity.value > bestSimilarity) {
            bestSimilarity = similarity.value;
            bestId = centre.id;
        }
    }

    if (bestId === null) {
        return refused('no cluster had a centroid that could be compared with this vector');
    }
    if (bestSimilarity < threshold) {
        return refused(
            `the closest cluster was ${bestSimilarity.toFixed(3)} similar, below the ${threshold} a match requires`,
        );
    }

    return computed({ id: bestId, similarity: bestSimilarity });
}

/**
 * The label a cluster should be shown under: its most common member label.
 *
 * Not the centroid's nearest neighbour, which is not a label, and not the first
 * member, which depends on insertion order. Ties break on the alphabetically first
 * label so the displayed name does not change between sweeps.
 */
export function representativeLabel(labels: string[]): Measured<string> {
    const counts = new Map<string, number>();
    for (const label of labels) {
        const key = label.trim();
        if (key.length === 0) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (counts.size === 0) {
        return refused('the cluster has no labels to choose a representative from');
    }

    let best: string | null = null;
    let bestCount = -1;
    for (const [label, count] of counts) {
        if (count > bestCount || (count === bestCount && best !== null && label < best)) {
            best = label;
            bestCount = count;
        }
    }
    return computed(best as string);
}
