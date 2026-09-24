// ============================================
// vectorMath.ts — cosine similarity, centroids and ranking, pure
// ============================================
// Pure. No database, no network, no clock.
//
// Two consumers, and they must agree exactly:
//
//   · the SQL function `match_embeddings`, which ranks in Postgres so the HNSW
//     index can serve the query;
//   · the fallback below, which ranks in JavaScript when that function is absent.
//
// A fallback that ranked differently from the indexed path would give a deployment
// with an older database different search results from one without, and the
// difference would be invisible: both return a plausible list. So `cosineSimilarity`
// here is written to be the arithmetic the SQL `<=>` operator performs —
// `1 - (a <=> b)` — with the same refusals rather than a silently different answer.
//
// THE REFUSALS ARE THE POINT
//
// Cosine similarity between two vectors of different lengths is not a small number
// or a large one; it has no value. Cosine similarity involving a zero vector has no
// value either — the angle is undefined, and the arithmetic would return NaN. Both
// are refused with a reason rather than passed along, because a NaN that reaches a
// sort does not throw: it silently produces an arbitrary order, and a search result
// list in an arbitrary order looks exactly like a ranked one.

import { computed, refused } from '../measured';
import type { Measured, MeasuredNumber } from '../measured';

/** Two vectors are comparable only if they have the same number of components. */
export function sameLength(a: number[], b: number[]): boolean {
    return a.length === b.length && a.length > 0;
}

/** True when every component is a finite number. */
export function isFiniteVector(vector: number[]): boolean {
    if (!Array.isArray(vector) || vector.length === 0) return false;
    return vector.every((value) => typeof value === 'number' && Number.isFinite(value));
}

/** Euclidean length. Zero means the vector carries no direction. */
export function magnitude(vector: number[]): number {
    let sum = 0;
    for (const value of vector) sum += value * value;
    return Math.sqrt(sum);
}

/** The inner product. */
export function dot(a: number[], b: number[]): number {
    let sum = 0;
    const length = Math.min(a.length, b.length);
    for (let index = 0; index < length; index += 1) sum += a[index] * b[index];
    return sum;
}

/**
 * A vector that can be compared: finite, non-empty, and not all zeros.
 *
 * The zero vector is the case worth naming. It is a legal array and a legal
 * embedding — a provider that failed to embed anything may return one — and it has
 * no direction, so every cosine similarity involving it is undefined rather than 0.
 * A stored zero vector is a row that would match nothing and be matched by nothing.
 */
export function isUsableVector(vector: unknown, expectedDim?: number): boolean {
    if (!Array.isArray(vector) || vector.length === 0) return false;
    if (expectedDim !== undefined && vector.length !== expectedDim) return false;
    if (!vector.every((value) => typeof value === 'number' && Number.isFinite(value))) return false;
    return magnitude(vector) > 0;
}

/**
 * Cosine similarity in [-1, 1], or a refusal.
 *
 * This is `1 - (a <=> b)` in the SQL that `match_embeddings` runs, and the refusals
 * mirror the cases where that expression is meaningless.
 */
export function cosineSimilarity(a: number[], b: number[]): MeasuredNumber {
    if (!Array.isArray(a) || !Array.isArray(b)) {
        return refused('a vector was not an array');
    }
    if (a.length === 0 || b.length === 0) {
        return refused('a vector was empty, and an empty vector has no direction');
    }
    if (a.length !== b.length) {
        return refused(
            `the vectors have ${a.length} and ${b.length} dimensions, and only vectors of equal length can be compared`,
        );
    }
    if (!isFiniteVector(a) || !isFiniteVector(b)) {
        return refused('a vector contained a value that is not a finite number');
    }

    const denominator = magnitude(a) * magnitude(b);
    if (denominator === 0) {
        return refused('a vector had zero magnitude, so the angle between them is undefined');
    }

    const value = dot(a, b) / denominator;
    // Floating point can land a true 1 at 1.0000000000000002. Clamping keeps a
    // similarity usable as a percentage without changing any real ordering.
    return computed(Math.max(-1, Math.min(1, value)));
}

/** The unit vector in the same direction, or a refusal for a zero vector. */
export function normalise(vector: number[]): Measured<number[]> {
    if (!isFiniteVector(vector)) {
        return refused('the vector was empty or contained a value that is not a finite number');
    }
    const length = magnitude(vector);
    if (length === 0) {
        return refused('the vector had zero magnitude, so it has no direction to normalise to');
    }
    return computed(vector.map((value) => value / length));
}

/**
 * The centroid of a set of vectors, as a unit vector.
 *
 * The mean is taken and then normalised, which is the spherical mean — the point on
 * the unit sphere closest to all of them. The unnormalised mean would drift toward
 * the origin as its members disagreed, and a centroid near the origin has a small
 * magnitude, so cosine similarity against it would be dominated by rounding rather
 * than by agreement. Cluster membership is decided by cosine, so the centroid has to
 * live on the same sphere the members do.
 *
 * An empty set is refused: the centroid of nothing is not the origin, it is nothing.
 */
export function centroid(vectors: number[][]): Measured<number[]> {
    const usable = vectors.filter((vector) => isUsableVector(vector));
    if (usable.length === 0) {
        return refused('no usable vectors, so there is no centroid to compute');
    }
    const dim = usable[0].length;
    if (!usable.every((vector) => vector.length === dim)) {
        return refused('the vectors have differing dimensions, so they have no common centroid');
    }

    const mean = new Array<number>(dim).fill(0);
    for (const vector of usable) {
        for (let index = 0; index < dim; index += 1) mean[index] += vector[index];
    }
    for (let index = 0; index < dim; index += 1) mean[index] /= usable.length;

    return normalise(mean);
}

/** One candidate, with the vector that will be compared. */
export interface Rankable {
    id: string;
    vector: number[];
    /** Anything the caller wants carried through to the ranked result. */
    payload?: unknown;
}

/** A candidate with its similarity to the query. */
export interface Ranked<T extends Rankable = Rankable> {
    id: string;
    similarity: number;
    payload: T['payload'];
}

/** Ranking options. */
export interface RankOptions {
    /** Results below this similarity are dropped. Defaults to no floor. */
    minSimilarity?: number;
    /** At most this many results. Defaults to all of them. */
    limit?: number;
}

/**
 * Rank candidates against a query vector, nearest first.
 *
 * Deterministic in a way that matters: ties are broken by id, ascending, rather than
 * by input order. Two candidates at an identical similarity — common at the
 * similarity floor, where several unrelated passages cluster — would otherwise be
 * ordered by however the database happened to return them, so the same query would
 * give different results on different days without anything having changed.
 *
 * Candidates whose vectors cannot be compared are dropped rather than scored. They
 * are not a zero: a zero similarity is a real, low similarity, and it would sort
 * above nothing while looking like a measurement.
 */
export function rankBySimilarity<T extends Rankable>(
    query: number[],
    candidates: T[],
    options: RankOptions = {},
): Ranked<T>[] {
    const { minSimilarity, limit } = options;
    const scored: Ranked<T>[] = [];

    for (const candidate of candidates) {
        const similarity = cosineSimilarity(query, candidate.vector);
        if (similarity.state !== 'computed') continue;
        if (minSimilarity !== undefined && similarity.value < minSimilarity) continue;
        scored.push({ id: candidate.id, similarity: similarity.value, payload: candidate.payload });
    }

    scored.sort((left, right) => {
        if (right.similarity !== left.similarity) return right.similarity - left.similarity;
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });

    if (limit !== undefined && limit >= 0) return scored.slice(0, limit);
    return scored;
}

/**
 * How many candidates were skipped because their vectors could not be compared.
 *
 * Returned alongside results so a caller can disclose it. A search that silently
 * ignored a third of the corpus because those rows have a zero or mismatched vector
 * returns a shorter list that looks complete, which is the failure mode this whole
 * module is built to avoid.
 */
export function countUnusable(candidates: Array<{ vector: number[] }>, expectedDim?: number): number {
    return candidates.filter((candidate) => !isUsableVector(candidate.vector, expectedDim)).length;
}

// --------------------------------------------
// The wire format
// --------------------------------------------
// pgvector has a text representation — `[1,2,3]` — and it is what PostgREST sends
// and returns for a `vector` column. These two functions are the only place that
// format is understood, so a change to it is a change in one file rather than in
// every query.
//
// They sit beside the arithmetic rather than in the service layer because a
// round-trip through the database must not alter a vector. If `parseVector` accepted
// something `toVectorLiteral` would not produce, a stored vector could come back
// different from the one written and every similarity computed against it would be
// subtly wrong — with no error anywhere to notice.

/** A vector in pgvector's text form: `[1,2,3]`, no spaces. */
export function toVectorLiteral(vector: number[]): Measured<string> {
    if (!isFiniteVector(vector)) {
        return refused('the vector could not be written: it was empty, or contained a value that is not a finite number');
    }
    return computed(`[${vector.join(',')}]`);
}

/**
 * A vector read back from the database.
 *
 * Refused rather than defaulted for anything that is not a bracket-delimited list of
 * finite numbers. A `null` here means a row whose vector did not survive the round
 * trip, and turning that into an empty array would let it be ranked against a real
 * query and score zero — a fabricated result rather than a missing one.
 */
export function parseVector(value: unknown): Measured<number[]> {
    if (Array.isArray(value)) {
        return isFiniteVector(value) ? computed(value as number[]) : refused('the stored vector contained a value that is not a finite number');
    }
    if (typeof value !== 'string') {
        return refused('the stored vector was not a vector');
    }

    const trimmed = value.trim();
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
        return refused('the stored vector was not in the expected [1,2,3] form');
    }

    const body = trimmed.slice(1, -1).trim();
    if (body.length === 0) return refused('the stored vector was empty');

    const parts = body.split(',');
    const out: number[] = [];
    for (const part of parts) {
        const parsed = Number(part.trim());
        if (!Number.isFinite(parsed)) {
            return refused(`the stored vector contained a component that is not a number`);
        }
        out.push(parsed);
    }

    return computed(out);
}
