// ============================================
// calibration.ts — Item bank calibration (database orchestration)
// Part of the Competency Measurement Engine (Feature 1)
//
// Thin DB layer over the pure estimators in calibrationMath.ts. All statistics
// live there; this file only fetches rows, groups them into items, and persists
// the results.
//
// The unit of calibration is the normalised question TEXT, not the Question row.
// See itemIdentity.ts for why: Question rows are created one-per-response and are
// never reused, so only the text repeats across candidates.
// ============================================

import supabaseDb from '@/lib/supabaseDb';
import {
    CORRECTNESS_THRESHOLD,
    MIN_SAMPLE_SIZE,
    deriveCorrectness,
    dimensionForCategory,
    estimateItemParametersFromSamples,
    itemParamsForDifficulty,
    type CalibrationSample,
    type DimensionScores,
} from './calibrationMath';
import { itemKeyFor, itemLabel } from './itemIdentity';
import { DEFAULT_TARGET_SE, type ItemParams } from './irt';

export interface CalibrationSummary {
    /** Distinct items found in the response history. */
    itemsConsidered: number;
    itemsCalibrated: number;
    /** Items with too few responses to fit — their existing parameters stand. */
    itemsSkipped: number;
    itemsNewlyRetired: number;
    itemsUnretired: number;
    /** Responses that could not be attributed to an identifiable item. */
    unattributableResponses: number;
    threshold: number;
    minSampleSize: number;
}

/** A response joined to the question it answered. */
interface ResponseWithQuestion {
    responseId: string;
    sessionId: string;
    questionId: string;
    questionText: string;
    category: string | null;
    difficulty: string | null;
    competencyId: string | null;
    scores: DimensionScores;
}

/**
 * Recalibrates the item bank from accumulated response history.
 *
 * Scope: every item with any response history, or the explicit `itemKeys` subset
 * when supplied (an admin re-running one item).
 *
 * Samples are built per item as:
 *   · correctness — the response's target-dimension score vs CORRECTNESS_THRESHOLD
 *   · restScore   — the same dimension summed over the *other* responses in the
 *                   same session. Using the rest score rather than the total
 *                   avoids the item correlating with itself, which would inflate
 *                   discrimination for every item.
 *
 * Items below MIN_SAMPLE_SIZE keep whatever parameters they already had. If they
 * have no row yet, none is created — a missing ItemParameter is the signal to
 * fall back to the difficulty-derived default.
 *
 * Note on cost: the Supabase wrapper filters in application code rather than in
 * SQL, so this loads the response history into memory. That is acceptable at the
 * scale this platform runs at today and is the reason calibration is an explicit
 * admin action rather than something on a request path. The upgrade path is a
 * SQL aggregate view; the estimator call above it would not change.
 */
export async function calibrateItemBank(
    options: { itemKeys?: string[]; minSampleSize?: number } = {}
): Promise<CalibrationSummary> {
    const minSampleSize = options.minSampleSize ?? MIN_SAMPLE_SIZE;

    const responses = await supabaseDb.response.findMany({
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

    const questions = await supabaseDb.question.findMany({
        select: { id: true, text: true, category: true, difficulty: true, competencyId: true },
    });
    const questionById = new Map<string, any>(questions.map((q: any) => [q.id, q]));

    // Join responses to their questions, then group by session so rest scores
    // can be computed within each sitting.
    const bySession = new Map<string, ResponseWithQuestion[]>();
    let unattributableResponses = 0;

    for (const response of responses) {
        const question = questionById.get(response.questionId);
        if (!question || !question.text) {
            unattributableResponses += 1;
            continue;
        }

        const entry: ResponseWithQuestion = {
            responseId: response.id,
            sessionId: response.sessionId,
            questionId: response.questionId,
            questionText: question.text,
            category: question.category ?? null,
            difficulty: question.difficulty ?? null,
            competencyId: question.competencyId ?? null,
            scores: {
                technicalScore: Number(response.technicalScore) || 0,
                communicationScore: Number(response.communicationScore) || 0,
                confidenceScore: Number(response.confidenceScore) || 0,
                logicScore: Number(response.logicScore) || 0,
                depthScore: Number(response.depthScore) || 0,
            },
        };

        const bucket = bySession.get(entry.sessionId);
        if (bucket) bucket.push(entry);
        else bySession.set(entry.sessionId, [entry]);
    }

    // Group into items by normalised text.
    const samplesByItemKey = new Map<string, CalibrationSample[]>();
    const metaByItemKey = new Map<
        string,
        { sampleText: string; category: string | null; competencyId: string | null; difficulty: string | null }
    >();

    for (const sessionResponses of bySession.values()) {
        for (const entry of sessionResponses) {
            const itemKey = itemKeyFor(entry.questionText);
            // An empty key means the text normalised to nothing. Counting those
            // as one item would merge every unidentifiable question together.
            if (!itemKey) {
                unattributableResponses += 1;
                continue;
            }
            if (options.itemKeys?.length && !options.itemKeys.includes(itemKey)) continue;

            const dimension = dimensionForCategory(entry.category);
            const restScore = sessionResponses.reduce(
                (sum, other) =>
                    other.responseId === entry.responseId
                        ? sum
                        : sum + (Number(other.scores[dimension]) || 0),
                0
            );

            const sample: CalibrationSample = {
                correct: deriveCorrectness(entry.scores, entry.category),
                restScore,
            };

            const bucket = samplesByItemKey.get(itemKey);
            if (bucket) bucket.push(sample);
            else samplesByItemKey.set(itemKey, [sample]);

            if (!metaByItemKey.has(itemKey)) {
                metaByItemKey.set(itemKey, {
                    sampleText: itemLabel(entry.questionText, 300),
                    category: entry.category,
                    competencyId: entry.competencyId,
                    difficulty: entry.difficulty,
                });
            }
        }
    }

    const summary: CalibrationSummary = {
        itemsConsidered: samplesByItemKey.size,
        itemsCalibrated: 0,
        itemsSkipped: 0,
        itemsNewlyRetired: 0,
        itemsUnretired: 0,
        unattributableResponses,
        threshold: CORRECTNESS_THRESHOLD,
        minSampleSize,
    };

    for (const [itemKey, samples] of samplesByItemKey) {
        if (samples.length < minSampleSize) {
            summary.itemsSkipped += 1;
            continue;
        }

        const result = estimateItemParametersFromSamples(samples);
        if (!result) {
            summary.itemsSkipped += 1;
            continue;
        }

        const meta = metaByItemKey.get(itemKey)!;
        const existing = await supabaseDb.itemParameter.findFirst({ where: { itemKey } });

        const payload = {
            itemKey,
            sampleText: meta.sampleText,
            category: meta.category,
            competencyId: meta.competencyId,
            a: result.a,
            b: result.b,
            c: result.c,
            sampleSize: result.sampleSize,
            proportionCorrect: result.proportionCorrect,
            isRetired: result.isRetired,
            retiredReason: result.retiredReason,
            calibratedAt: new Date().toISOString(),
        };

        if (existing) {
            await supabaseDb.itemParameter.update({ where: { id: existing.id }, data: payload });
            if (result.isRetired && !existing.isRetired) summary.itemsNewlyRetired += 1;
            if (!result.isRetired && existing.isRetired) summary.itemsUnretired += 1;
        } else {
            await supabaseDb.itemParameter.create({ data: payload });
            if (result.isRetired) summary.itemsNewlyRetired += 1;
        }

        summary.itemsCalibrated += 1;
    }

    return summary;
}

/** Parameters in force for an item, plus where they came from. */
export interface ResolvedItemParameters extends ItemParams {
    isRetired: boolean;
    sampleSize: number;
    /** True when fitted from data; false when falling back to the difficulty label. */
    calibrated: boolean;
    source: 'calibrated' | 'difficulty-default' | 'uncalibrated-default';
}

/**
 * Resolves the parameters in force for a question text.
 *
 * Calibrated row first; otherwise the default implied by the legacy difficulty
 * label. Exported so selection and ability estimation share exactly one
 * definition of "what parameters does this item have".
 */
export async function resolveItemParametersForText(
    text: string,
    difficulty?: string | null
): Promise<ResolvedItemParameters> {
    const itemKey = itemKeyFor(text);

    if (itemKey) {
        const row = await supabaseDb.itemParameter.findFirst({ where: { itemKey } });
        if (row && row.sampleSize > 0) {
            return {
                a: row.a,
                b: row.b,
                c: row.c,
                isRetired: Boolean(row.isRetired),
                sampleSize: row.sampleSize,
                calibrated: true,
                source: 'calibrated',
            };
        }
    }

    const fallback = itemParamsForDifficulty(difficulty);
    return {
        ...fallback,
        isRetired: false,
        sampleSize: 0,
        calibrated: false,
        source: difficulty ? 'difficulty-default' : 'uncalibrated-default',
    };
}

/** Batched variant, for selecting over a bank without a query per item. */
export async function loadCalibratedParameters(): Promise<Map<string, ResolvedItemParameters>> {
    const rows = await supabaseDb.itemParameter.findMany({
        select: { itemKey: true, a: true, b: true, c: true, sampleSize: true, isRetired: true },
    });

    const map = new Map<string, ResolvedItemParameters>();
    for (const row of rows) {
        map.set(row.itemKey, {
            a: row.a,
            b: row.b,
            c: row.c,
            isRetired: Boolean(row.isRetired),
            sampleSize: row.sampleSize,
            calibrated: row.sampleSize > 0,
            source: row.sampleSize > 0 ? 'calibrated' : 'uncalibrated-default',
        });
    }
    return map;
}

/** Target SE the adaptive session aims for. Re-exported for callers importing only this module. */
export const TARGET_STANDARD_ERROR = DEFAULT_TARGET_SE;
