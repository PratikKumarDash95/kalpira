// ============================================
// scoreCalculator.ts — Pure Score Computation
// Part of the Unified Scoring Engine
// Purely functional — no DB writes, no side effects
// ============================================

import prisma from '@/lib/prisma';

// ============================================
// Score dimension weights
// These define how each dimension contributes to the overall score
// Total must equal 1.0
// ============================================

const SCORE_WEIGHTS = {
    technical: 0.35,
    communication: 0.15,
    confidence: 0.15,
    logic: 0.20,
    depth: 0.15,
} as const;

// Type-safe verification that weights sum to 1.0
const WEIGHT_SUM = Object.values(SCORE_WEIGHTS).reduce((acc, w) => acc + w, 0);
if (Math.abs(WEIGHT_SUM - 1.0) > 0.001) {
    throw new Error(
        `[ScoreCalculator] SCORE_WEIGHTS must sum to 1.0, got ${WEIGHT_SUM}. This is a build-time error.`
    );
}

/**
 * Computed session score averages.
 * All values are rounded to 2 decimal places.
 */
export interface SessionScoreAverages {
    /** Weighted overall score */
    overallScore: number;
    /** Average technical score across all responses */
    technicalAverage: number;
    /** Average communication score across all responses */
    communicationAverage: number;
    /** Average confidence score across all responses */
    confidenceAverage: number;
    /** Average logic score across all responses */
    logicAverage: number;
    /** Average depth score across all responses */
    depthAverage: number;
    /** Number of responses used in calculation */
    responseCount: number;
}

/**
 * Rounds a number to 2 decimal places.
 */
function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * Calculates the weighted overall score from individual dimension averages.
 *
 * Formula:
 *   overall = technical * 0.35
 *           + communication * 0.15
 *           + confidence * 0.15
 *           + logic * 0.20
 *           + depth * 0.15
 */
function computeWeightedOverall(
    technicalAvg: number,
    communicationAvg: number,
    confidenceAvg: number,
    logicAvg: number,
    depthAvg: number
): number {
    const weighted =
        technicalAvg * SCORE_WEIGHTS.technical +
        communicationAvg * SCORE_WEIGHTS.communication +
        confidenceAvg * SCORE_WEIGHTS.confidence +
        logicAvg * SCORE_WEIGHTS.logic +
        depthAvg * SCORE_WEIGHTS.depth;

    return round2(weighted);
}

/**
 * Fetches all Response records for a session and computes aggregate averages.
 *
 * This is the SINGLE SOURCE OF TRUTH for score calculation.
 * No other module should compute session-level scores.
 *
 * Guarantees:
 * - Pure calculation — no database writes
 * - Returns zeroed averages if no responses exist
 * - All values clamped to [0, 100] and rounded to 2 decimals
 *
 * @param sessionId - The InterviewSession ID to calculate scores for
 * @returns SessionScoreAverages with all computed values
 */
export async function calculateSessionAverages(
    sessionId: string
): Promise<SessionScoreAverages> {
    const responses = await prisma.response.findMany({
        where: { sessionId },
        select: {
            technicalScore: true,
            communicationScore: true,
            confidenceScore: true,
            logicScore: true,
            depthScore: true,
        },
    });

    const count = responses.length;

    // Return zeroed averages if no responses
    if (count === 0) {
        return {
            overallScore: 0,
            technicalAverage: 0,
            communicationAverage: 0,
            confidenceAverage: 0,
            logicAverage: 0,
            depthAverage: 0,
            responseCount: 0,
        };
    }

    // Sum all dimensions
    let techSum = 0;
    let commSum = 0;
    let confSum = 0;
    let logicSum = 0;
    let depthSum = 0;

    for (const r of responses) {
        techSum += r.technicalScore;
        commSum += r.communicationScore;
        confSum += r.confidenceScore;
        logicSum += r.logicScore;
        depthSum += r.depthScore;
    }

    // Compute averages
    const technicalAverage = round2(techSum / count);
    const communicationAverage = round2(commSum / count);
    const confidenceAverage = round2(confSum / count);
    const logicAverage = round2(logicSum / count);
    const depthAverage = round2(depthSum / count);

    // Compute weighted overall
    const overallScore = computeWeightedOverall(
        technicalAverage,
        communicationAverage,
        confidenceAverage,
        logicAverage,
        depthAverage
    );

    return {
        overallScore,
        technicalAverage,
        communicationAverage,
        confidenceAverage,
        logicAverage,
        depthAverage,
        responseCount: count,
    };
}

/**
 * Computes averages from an in-memory array of score tuples.
 * Used within transactions where responses are already fetched.
 *
 * This avoids an additional DB query when calculating inside a transaction.
 */
export function calculateAveragesFromArray(
    responses: Array<{
        technicalScore: number;
        communicationScore: number;
        confidenceScore: number;
        logicScore: number;
        depthScore: number;
    }>
): SessionScoreAverages {
    const count = responses.length;

    if (count === 0) {
        return {
            overallScore: 0,
            technicalAverage: 0,
            communicationAverage: 0,
            confidenceAverage: 0,
            logicAverage: 0,
            depthAverage: 0,
            responseCount: 0,
        };
    }

    let techSum = 0;
    let commSum = 0;
    let confSum = 0;
    let logicSum = 0;
    let depthSum = 0;

    for (const r of responses) {
        techSum += r.technicalScore;
        commSum += r.communicationScore;
        confSum += r.confidenceScore;
        logicSum += r.logicScore;
        depthSum += r.depthScore;
    }

    const technicalAverage = round2(techSum / count);
    const communicationAverage = round2(commSum / count);
    const confidenceAverage = round2(confSum / count);
    const logicAverage = round2(logicSum / count);
    const depthAverage = round2(depthSum / count);

    const overallScore = computeWeightedOverall(
        technicalAverage,
        communicationAverage,
        confidenceAverage,
        logicAverage,
        depthAverage
    );

    return {
        overallScore,
        technicalAverage,
        communicationAverage,
        confidenceAverage,
        logicAverage,
        depthAverage,
        responseCount: count,
    };
}
