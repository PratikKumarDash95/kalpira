// ============================================
// similarityMath.ts — near-duplicate detection across a study
// Feature 3 — Integrity & Authenticity Suite
// ============================================
//
// Answers in, near-duplicate pairs and clusters out. Pure: no database, no network,
// no randomness that varies between runs.
//
// WHAT THIS CATCHES, AND THE ONE THING IT CANNOT
//
// It catches an answer that travelled. A leaked question bank, a model answer
// circulated in a WhatsApp group, a coaching institute's template handed to forty
// candidates — all of those produce answers that are not identical but are far too
// alike to have been written independently, and near-duplicate detection finds them
// where an exact-match check finds nothing.
//
// What it cannot do is establish direction. If two answers are 0.9 similar, this
// module knows they resemble each other and nothing else. It does not know who wrote
// first, who copied, whether either knew, or whether both simply read the same book.
// The registry's `whatItCannotSay` for these signals says the same thing in fewer
// words, and every cluster this file emits is a reason to look at two answers
// together — never a finding about a person.
//
// WHY MINHASH RATHER THAN COMPARING EVERY PAIR DIRECTLY
//
// Exact Jaccard over shingle sets is O(n²) set intersections, and each intersection
// is over sets of hundreds of shingles. MinHash compresses every answer to a
// fixed-length signature once, after which a comparison is 128 integer comparisons —
// turning a study of 200 candidates from ~20,000 large set operations into 20,000
// small array scans. The estimate is approximate, and the approximation is disclosed
// below rather than hidden.

import { tokenize } from './stylometryMath';

/** Words per shingle. Five is long enough that shared phrasing is meaningful. */
export const SHINGLE_SIZE = 5;

/**
 * Number of hash functions in a MinHash signature.
 *
 * 128 gives a standard error of roughly 1/√128 ≈ 0.09 on the similarity estimate.
 * That is coarser than it sounds: the registry fires `nearDuplicateAnswer` at 0.75
 * with a tolerance of 0.25, so an error of ±0.09 moves the deduction by a few points
 * at the margin and never turns a clearly-unrelated pair into a clearly-related one.
 * Raising it to 256 would halve the error and double the work for a difference no
 * reviewer would notice.
 */
export const MINHASH_SIZE = 128;

/**
 * Fewest shingles an answer needs before it may be compared with anything.
 *
 * THIS IS THE MOST IMPORTANT CONSTANT IN THE FILE.
 *
 * Shingling is a set operation, and sets of one element are all equal to each other.
 * Two candidates who each answered "I would use a hash map" produce one shingle each,
 * and those shingles are either identical — Jaccard 1.0, maximum similarity — or
 * nothing. Without this floor, the shortest answers in every study would pair up with
 * each other at maximum similarity, and near-duplicate detection would spend its
 * entire output flagging people for giving a five-word answer. Twenty shingles is
 * roughly twenty-five words: long enough that agreement between two answers means
 * something.
 */
export const MIN_SHINGLES_FOR_COMPARISON = 20;

/**
 * How many answers one similarity batch should consider.
 *
 * Pairwise comparison is quadratic, and the service is expected to chunk a study
 * larger than this rather than build the full cross-product in memory. Documented
 * here because the limit belongs to the algorithm, not to the caller's convenience.
 */
export const MAX_ANSWERS_PER_BATCH = 500;

/** Seed for the hash family. Fixed, so two runs over the same study agree exactly. */
export const MINHASH_SEED = 0x5eed1234;

// --------------------------------------------
// Shingling
// --------------------------------------------

/**
 * Word shingles over normalised text.
 *
 * Built from the same tokenizer the stylometry layer uses, so "React.js" and
 * "react js" shingle alike — an answer copied through a chat client that mangles
 * punctuation should still match the original.
 */
export function shingles(text: string, size: number = SHINGLE_SIZE): Set<string> {
    const tokens = tokenize(text);
    const result = new Set<string>();
    if (tokens.length < size) return result;

    for (let i = 0; i + size <= tokens.length; i += 1) {
        result.add(tokens.slice(i, i + size).join(' '));
    }
    return result;
}

/**
 * Exact Jaccard similarity between two shingle sets.
 *
 * Not used in the scoring path — the MinHash estimate is — but exported because the
 * verify script needs ground truth to measure the estimate against, and because a
 * reviewer asking "how similar are these really?" deserves a real answer rather than
 * the approximation.
 */
export function exactJaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let intersection = 0;
    // Iterate the smaller set; the result is symmetric.
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const shingle of small) {
        if (large.has(shingle)) intersection += 1;
    }
    return intersection / (a.size + b.size - intersection);
}

// --------------------------------------------
// Hashing
// --------------------------------------------

/** FNV-1a, 32-bit. The base hash every signature slot is derived from. */
function fnv1a(text: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        // 16777619 is the FNV prime; Math.imul keeps the multiply in 32-bit range.
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

/**
 * Deterministic coefficients for the hash family.
 *
 * Generated once from a fixed seed rather than hardcoded, so the family can be
 * regenerated at a different size without a table of magic numbers. Universal
 * hashing needs `a` odd and both `a` and `b` in range; mulberry32 supplies that and
 * `| 1` forces the odd bit.
 */
function coefficients(): Array<[number, number]> {
    let state = MINHASH_SEED >>> 0;
    const next = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return (t ^ (t >>> 14)) >>> 0;
    };
    return Array.from({ length: MINHASH_SIZE }, () => [next() | 1, next()] as [number, number]);
}

const COEFFICIENTS = coefficients();

/**
 * The MinHash signature of a shingle set: for each hash function, the smallest hash
 * value any shingle in the set produces.
 *
 * The property that makes this work is that the probability of two sets sharing a
 * minimum under a random hash equals their Jaccard similarity — so the fraction of
 * signature slots that agree is an unbiased estimate of it.
 */
export function minHashSignature(shingleSet: Set<string>): Uint32Array {
    const signature = new Uint32Array(MINHASH_SIZE).fill(0xffffffff);
    if (shingleSet.size === 0) return signature;

    for (const shingle of shingleSet) {
        const base = fnv1a(shingle);
        for (let i = 0; i < MINHASH_SIZE; i += 1) {
            const [a, b] = COEFFICIENTS[i];
            const hashed = (Math.imul(a, base) + b) >>> 0;
            if (hashed < signature[i]) signature[i] = hashed;
        }
    }
    return signature;
}

/** Share of signature slots that agree. The estimate this whole file exists for. */
export function estimateJaccard(a: Uint32Array, b: Uint32Array): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let agreeing = 0;
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] === b[i]) agreeing += 1;
    }
    return agreeing / a.length;
}

// --------------------------------------------
// Comparing a study's answers
// --------------------------------------------

export interface ComparableAnswer {
    responseId: string;
    text: string;
    /** Optional grouping, so answers to different questions are not compared. */
    questionId?: string | null;
}

export interface SimilarityPair {
    responseAId: string;
    responseBId: string;
    similarity: number;
    clusterId: string | null;
}

export interface SimilarityResult {
    pairs: SimilarityPair[];
    /** Every answer considered, whether or not it paired with anything. */
    considered: number;
    /** Answers too short to compare. Reported so their absence is not silent. */
    skippedTooShort: number;
    /**
     * True when the estimate rather than an exact computation produced these numbers.
     * Always true today; carried in the payload so a reader is never told a MinHash
     * estimate is an exact figure.
     */
    approximate: true;
    caveats: string[];
}

/**
 * Finds near-duplicate answers within one study.
 *
 * SCOPE IS THE CALLER'S RESPONSIBILITY AND IT MATTERS. This compares whatever it is
 * given, so the service must hand it answers to the SAME question within the SAME
 * study. Run this over a whole study's answers to different questions and every
 * candidate who opened with "I'd start by understanding the requirements" pairs with
 * every other — a false positive on a mass scale, produced by a correct algorithm
 * given the wrong population.
 *
 * When `questionId` is present on the inputs, pairs across different questions are
 * dropped here as a second line of defence, because the cost of this mistake is high
 * and the check is cheap.
 *
 * Answers below `MIN_SHINGLES_FOR_COMPARISON` are skipped rather than compared, and
 * counted in `skippedTooShort` so the report can say how many were left out.
 */
export function findSimilarAnswers(
    answers: readonly ComparableAnswer[],
    threshold: number
): SimilarityResult {
    const caveats: string[] = [
        'Similarity is estimated by MinHash over word shingles, so each figure carries an error of roughly ±0.09 and two pairs a few points apart may be in the wrong order.',
        'Similarity shows that two answers resemble each other. It cannot show who wrote first, who copied, or whether either candidate knew — a shared preparation course produces the same result as a leaked answer.',
    ];

    const skippedTooShort = answers.filter((answer) => shingles(answer.text).size < MIN_SHINGLES_FOR_COMPARISON).length;

    const usable = answers
        .map((answer) => ({
            answer,
            shingleSet: shingles(answer.text),
        }))
        .filter((entry) => entry.shingleSet.size >= MIN_SHINGLES_FOR_COMPARISON)
        .map((entry) => ({
            responseId: entry.answer.responseId,
            questionId: entry.answer.questionId ?? null,
            signature: minHashSignature(entry.shingleSet),
        }));

    if (usable.length > MAX_ANSWERS_PER_BATCH) {
        caveats.push(
            `This batch held ${usable.length} answers, above the ${MAX_ANSWERS_PER_BATCH} the pairwise comparison is sized for. Results are still produced; the study should be chunked for large cohorts.`
        );
    }
    if (skippedTooShort > 0) {
        caveats.push(
            `${skippedTooShort} answer${skippedTooShort === 1 ? ' was' : 's were'} too short to compare and ${skippedTooShort === 1 ? 'was' : 'were'} excluded. Short answers cannot be judged similar or dissimilar.`
        );
    }

    // Compare every unordered pair once, keeping the pair ordered for storage.
    const matched: Array<{ a: string; b: string; similarity: number }> = [];
    for (let i = 0; i < usable.length; i += 1) {
        for (let j = i + 1; j < usable.length; j += 1) {
            const left = usable[i];
            const right = usable[j];

            // Answers to different questions are not comparable, even inside a study.
            if (left.questionId && right.questionId && left.questionId !== right.questionId) continue;

            const similarity = estimateJaccard(left.signature, right.signature);
            if (similarity < threshold) continue;

            const [a, b] =
                left.responseId < right.responseId
                    ? [left.responseId, right.responseId]
                    : [right.responseId, left.responseId];
            matched.push({ a, b, similarity });
        }
    }

    const clusterIds = clusterPairs(matched, usable.map((entry) => entry.responseId));

    return {
        pairs: matched.map((pair) => ({
            responseAId: pair.a,
            responseBId: pair.b,
            similarity: pair.similarity,
            clusterId: clusterIds.get(pair.a) ?? null,
        })),
        considered: usable.length,
        skippedTooShort,
        approximate: true,
        caveats,
    };
}

// --------------------------------------------
// Clustering
// --------------------------------------------

/**
 * Groups transitively similar answers.
 *
 * Union-find, because similarity is not transitive and the finding is: if A resembles
 * B and B resembles C, then A, B and C are one circulated answer even when A and C
 * fall below the threshold on their own. Pairwise output alone would report that as
 * two separate findings and overstate how many distinct problems exist — a leaked
 * answer sent to five people is one finding, not ten.
 *
 * Implemented with path compression and union by size, which keeps it effectively
 * linear over the number of pairs.
 *
 * Cluster ids are derived from the smallest member id rather than a counter, so the
 * same input produces the same ids on every run and a recomputation does not shuffle
 * clusters a reviewer has already looked at.
 */
export function clusterPairs(
    pairs: ReadonlyArray<{ a: string; b: string }>,
    allIds: readonly string[]
): Map<string, string> {
    const parent = new Map<string, string>();
    const size = new Map<string, number>();

    for (const id of allIds) {
        parent.set(id, id);
        size.set(id, 1);
    }

    const find = (id: string): string => {
        let root = id;
        while (parent.get(root) !== root) root = parent.get(root) ?? root;
        // Path compression: point everything on the way up straight at the root.
        let cursor = id;
        while (parent.get(cursor) !== root) {
            const next = parent.get(cursor) ?? root;
            parent.set(cursor, root);
            cursor = next;
        }
        return root;
    };

    const union = (a: string, b: string) => {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA === rootB) return;
        const sizeA = size.get(rootA) ?? 1;
        const sizeB = size.get(rootB) ?? 1;
        // Attach the smaller tree under the larger, keeping depth near-constant.
        const [winner, loser] = sizeA >= sizeB ? [rootA, rootB] : [rootB, rootA];
        parent.set(loser, winner);
        size.set(winner, sizeA + sizeB);
    };

    for (const pair of pairs) {
        if (!parent.has(pair.a)) {
            parent.set(pair.a, pair.a);
            size.set(pair.a, 1);
        }
        if (!parent.has(pair.b)) {
            parent.set(pair.b, pair.b);
            size.set(pair.b, 1);
        }
        union(pair.a, pair.b);
    }

    // A cluster of one is not a cluster: an answer that resembles nothing is reported
    // as belonging to no group, because "part of a similar group" must not fire for
    // an answer that stands alone.
    const members = new Map<string, string[]>();
    for (const id of parent.keys()) {
        const root = find(id);
        const bucket = members.get(root) ?? [];
        bucket.push(id);
        members.set(root, bucket);
    }

    const clusterIdByRoot = new Map<string, string>();
    for (const [root, bucket] of members) {
        if (bucket.length < 2) continue;
        const smallest = [...bucket].sort()[0];
        clusterIdByRoot.set(root, `cluster-${smallest}`);
    }

    const assignment = new Map<string, string>();
    for (const id of parent.keys()) {
        const clusterId = clusterIdByRoot.get(find(id));
        if (clusterId) assignment.set(id, clusterId);
    }
    return assignment;
}

/**
 * How many other answers a response is transitively grouped with.
 *
 * This is the value `similarityClusterMember` scores. Counted as cluster size minus
 * one — "how many other people" — because that is the question a reviewer is
 * actually asking, and because a cluster of one is impossible here by construction.
 */
export function clusterMemberCount(
    responseId: string,
    pairs: ReadonlyArray<{ responseAId: string; responseBId: string; clusterId: string | null }>
): number {
    const clusterId = pairs.find(
        (pair) => pair.responseAId === responseId || pair.responseBId === responseId
    )?.clusterId;
    if (!clusterId) return 0;

    const members = new Set<string>();
    for (const pair of pairs) {
        if (pair.clusterId !== clusterId) continue;
        members.add(pair.responseAId);
        members.add(pair.responseBId);
    }
    return Math.max(0, members.size - 1);
}

/**
 * The strongest similarity this response has to any other in the study.
 *
 * Zero when it has none, which is a real measurement here rather than a missing one:
 * "this answer resembles nothing else in the study" is a fact the comparison
 * established, unlike drift-without-a-baseline which is a fact it could not.
 */
export function strongestSimilarity(
    responseId: string,
    pairs: ReadonlyArray<{ responseAId: string; responseBId: string; similarity: number }>
): number {
    let strongest = 0;
    for (const pair of pairs) {
        if (pair.responseAId !== responseId && pair.responseBId !== responseId) continue;
        if (pair.similarity > strongest) strongest = pair.similarity;
    }
    return strongest;
}
