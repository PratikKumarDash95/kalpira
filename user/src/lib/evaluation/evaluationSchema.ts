// ============================================
// evaluationSchema.ts — Zod Validation for LLM Evaluation Output
// Part of the Unified Scoring Engine
// Defines strict schema, safe parsing, and fallback handling
// ============================================

import { z } from 'zod';

// ============================================
// Score clamping transformer
// Ensures all numeric scores are within [0, 100]
// ============================================

const clampedScore = z
    .number()
    .transform((val) => Math.round(Math.min(100, Math.max(0, val)) * 100) / 100);

// ============================================
// Difficulty recommendation enum
// ============================================

const difficultyRecommendation = z.enum(['increase', 'decrease', 'maintain']);

// ============================================
// Core evaluation schema
// Matches the exact JSON structure defined in the prompt
// ============================================

export const EvaluationResultSchema = z.object({
    technical_score: clampedScore,
    communication_score: clampedScore,
    confidence_score: clampedScore,
    logic_score: clampedScore,
    depth_score: clampedScore,
    difficulty_recommendation: difficultyRecommendation,
    weak_topics: z.array(z.string()).default([]),
    strengths: z.array(z.string()).default([]),
    feedback: z.string().min(1, 'Feedback must not be empty'),
    ideal_answer: z.string().min(1, 'Ideal answer must not be empty'),
    improvement_tip: z.string().min(1, 'Improvement tip must not be empty'),
});

/**
 * The validated evaluation result type.
 * Inferred directly from the Zod schema for type safety.
 */
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

// ============================================
// Safe fallback — returned when validation fails
// Guarantees the system never crashes on malformed LLM output
// ============================================

const SAFE_FALLBACK: EvaluationResult = {
    technical_score: 50,
    communication_score: 50,
    confidence_score: 50,
    logic_score: 50,
    depth_score: 50,
    difficulty_recommendation: 'maintain',
    weak_topics: [],
    strengths: [],
    feedback: 'Evaluation failed. Default applied.',
    ideal_answer: '',
    improvement_tip: '',
};

/**
 * Safely parses and validates raw LLM output against the evaluation schema.
 *
 * Guarantees:
 * - All numeric scores are clamped to [0, 100]
 * - All required fields are present
 * - Returns a valid EvaluationResult in ALL cases
 * - Never throws
 *
 * @param rawJson - The raw string output from the LLM
 * @returns A validated EvaluationResult (real or fallback)
 */
export function safeParseEvaluation(rawJson: string): {
    success: boolean;
    data: EvaluationResult;
    errors: string[];
} {
    const errors: string[] = [];

    // Step 1: Attempt JSON parsing
    let parsed: unknown;
    try {
        // Strip potential markdown code fence wrappers
        const cleaned = rawJson
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();

        parsed = JSON.parse(cleaned);
    } catch (parseError) {
        const message =
            parseError instanceof Error ? parseError.message : 'Unknown parse error';
        errors.push(`JSON parse failed: ${message}`);
        console.error(
            '[EvaluationSchema] JSON parse failed:',
            message,
            '\nRaw input (first 500 chars):',
            rawJson.substring(0, 500)
        );
        return { success: false, data: { ...SAFE_FALLBACK }, errors };
    }

    // Step 2: Validate against Zod schema
    const result = EvaluationResultSchema.safeParse(parsed);

    if (result.success) {
        return { success: true, data: result.data, errors: [] };
    }

    // Step 3: Log validation errors and return fallback
    const zodErrors = result.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`
    );
    errors.push(...zodErrors);

    console.error(
        '[EvaluationSchema] Zod validation failed:',
        zodErrors,
        '\nParsed input:',
        JSON.stringify(parsed).substring(0, 500)
    );

    // Step 4: Attempt partial recovery — use valid fields from parsed data
    const partialData = attemptPartialRecovery(parsed);

    return {
        success: false,
        data: partialData,
        errors,
    };
}

/**
 * Attempts to recover valid fields from partially valid LLM output.
 * Any field that fails validation is replaced with its fallback value.
 */
function attemptPartialRecovery(parsed: unknown): EvaluationResult {
    if (typeof parsed !== 'object' || parsed === null) {
        return { ...SAFE_FALLBACK };
    }

    const obj = parsed as Record<string, unknown>;
    const recovered = { ...SAFE_FALLBACK };

    // Attempt to recover numeric scores
    const scoreFields = [
        'technical_score',
        'communication_score',
        'confidence_score',
        'logic_score',
        'depth_score',
    ] as const;

    for (const field of scoreFields) {
        const val = obj[field];
        if (typeof val === 'number' && !isNaN(val)) {
            recovered[field] = Math.round(Math.min(100, Math.max(0, val)) * 100) / 100;
        }
    }

    // Attempt to recover difficulty_recommendation
    const rec = obj['difficulty_recommendation'];
    if (rec === 'increase' || rec === 'decrease' || rec === 'maintain') {
        recovered.difficulty_recommendation = rec;
    }

    // Attempt to recover string arrays
    if (Array.isArray(obj['weak_topics'])) {
        recovered.weak_topics = obj['weak_topics'].filter(
            (item): item is string => typeof item === 'string'
        );
    }
    if (Array.isArray(obj['strengths'])) {
        recovered.strengths = obj['strengths'].filter(
            (item): item is string => typeof item === 'string'
        );
    }

    // Attempt to recover strings
    if (typeof obj['feedback'] === 'string' && obj['feedback'].length > 0) {
        recovered.feedback = obj['feedback'];
    }
    if (typeof obj['ideal_answer'] === 'string' && obj['ideal_answer'].length > 0) {
        recovered.ideal_answer = obj['ideal_answer'];
    }
    if (typeof obj['improvement_tip'] === 'string' && obj['improvement_tip'].length > 0) {
        recovered.improvement_tip = obj['improvement_tip'];
    }

    return recovered;
}
