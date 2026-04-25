// ============================================
// evaluationService.ts — Core Evaluation Orchestrator
// Part of the Unified Scoring Engine
// This is the SINGLE ENTRY POINT for all answer evaluation
// ============================================

import prisma from '@/lib/prisma';
import { generateEvaluationPrompt, type InterviewMode, type DifficultyLevel, type CompanyPreset } from './evaluationPrompt';
import { safeParseEvaluation, type EvaluationResult } from './evaluationSchema';
import { callLLM, type LLMClientConfig } from './llmClient';
import { calculateAveragesFromArray, type SessionScoreAverages } from './scoreCalculator';

// ============================================
// Type Definitions
// ============================================

/**
 * Input required to evaluate a candidate's response.
 */
export interface EvaluationInput {
    /** The InterviewSession ID */
    sessionId: string;
    /** The Question ID being answered */
    questionId: string;
    /** The candidate's answer text */
    userAnswer: string;
    /** The question text (for prompt context) */
    questionText: string;
    /** The question category (e.g., "technical", "behavioral") */
    category: string;
    /** Target job role */
    role: string;
    /** Difficulty level of the question */
    difficulty: DifficultyLevel;
    /** Interview simulation mode */
    mode: InterviewMode;
    /** Optional company preset for company mode */
    companyPreset?: CompanyPreset;
    /** Optional LLM provider configuration override */
    llmConfig?: Partial<LLMClientConfig>;
}

/**
 * Complete output from the evaluation pipeline.
 */
export interface EvaluationOutput {
    /** Whether the evaluation completed successfully */
    success: boolean;
    /** The created Response record ID */
    responseId: string;
    /** The validated evaluation result from the LLM */
    evaluation: EvaluationResult;
    /** Updated session score averages */
    sessionAverages: SessionScoreAverages;
    /** Whether the LLM output was valid (false = fallback was used) */
    llmOutputValid: boolean;
    /** Validation errors if any */
    validationErrors: string[];
    /** Error message if the pipeline failed */
    error?: string;
}

// ============================================
// Safe fallback output — returned when the entire pipeline fails
// ============================================

function createFailureOutput(error: string): EvaluationOutput {
    return {
        success: false,
        responseId: '',
        evaluation: {
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
        },
        sessionAverages: {
            overallScore: 0,
            technicalAverage: 0,
            communicationAverage: 0,
            confidenceAverage: 0,
            logicAverage: 0,
            depthAverage: 0,
            responseCount: 0,
        },
        llmOutputValid: false,
        validationErrors: [error],
        error,
    };
}

// ============================================
// Input validation
// ============================================

function validateInput(input: EvaluationInput): string | null {
    if (!input.sessionId || typeof input.sessionId !== 'string') {
        return 'sessionId is required and must be a string';
    }
    if (!input.questionId || typeof input.questionId !== 'string') {
        return 'questionId is required and must be a string';
    }
    if (!input.userAnswer || typeof input.userAnswer !== 'string') {
        return 'userAnswer is required and must be a non-empty string';
    }
    if (!input.questionText || typeof input.questionText !== 'string') {
        return 'questionText is required and must be a non-empty string';
    }
    if (!input.role || typeof input.role !== 'string') {
        return 'role is required and must be a non-empty string';
    }
    if (!['easy', 'medium', 'hard'].includes(input.difficulty)) {
        return 'difficulty must be "easy", "medium", or "hard"';
    }
    if (!['normal', 'stress', 'company'].includes(input.mode)) {
        return 'mode must be "normal", "stress", or "company"';
    }
    return null;
}

// ============================================
// Core evaluation pipeline
// ============================================

/**
 * Evaluates a candidate's response through the full pipeline:
 *
 * 1. Validate input
 * 2. Generate evaluation prompt
 * 3. Call LLM
 * 4. Parse and validate LLM output
 * 5. Store results atomically via Prisma transaction:
 *    a. Create Response record
 *    b. Re-fetch all session responses
 *    c. Calculate session averages
 *    d. Upsert ScoreBreakdown record
 *    e. Update InterviewSession.averageScore
 *
 * Guarantees:
 * - Transactional integrity (all-or-nothing DB writes)
 * - Never throws to caller (returns structured error)
 * - Fallback evaluation on LLM failure
 * - All scores clamped to [0, 100]
 *
 * @param input - The evaluation input parameters
 * @returns EvaluationOutput with complete results
 */
export async function evaluateResponse(
    input: EvaluationInput
): Promise<EvaluationOutput> {
    // ── Step 1: Validate input ──
    const inputError = validateInput(input);
    if (inputError) {
        console.error('[EvaluationService] Input validation failed:', inputError);
        return createFailureOutput(inputError);
    }

    // ── Step 2: Verify session and question exist ──
    try {
        const [session, question] = await Promise.all([
            prisma.interviewSession.findUnique({
                where: { id: input.sessionId },
                select: { id: true, userId: true },
            }),
            prisma.question.findUnique({
                where: { id: input.questionId },
                select: { id: true, sessionId: true },
            }),
        ]);

        if (!session) {
            return createFailureOutput(`Session not found: ${input.sessionId}`);
        }
        if (!question) {
            return createFailureOutput(`Question not found: ${input.questionId}`);
        }
        if (question.sessionId !== input.sessionId) {
            return createFailureOutput('Question does not belong to the specified session');
        }
    } catch (dbError) {
        const message = dbError instanceof Error ? dbError.message : 'Unknown DB error';
        console.error('[EvaluationService] DB lookup failed:', message);
        return createFailureOutput(`Database error during validation: ${message}`);
    }

    // ── Step 3: Generate evaluation prompt ──
    const prompt = generateEvaluationPrompt({
        questionText: input.questionText,
        userAnswer: input.userAnswer,
        role: input.role,
        difficulty: input.difficulty,
        mode: input.mode,
        category: input.category || 'general',
        companyPreset: input.companyPreset,
    });

    // ── Step 4: Call LLM ──
    const llmResult = await callLLM(prompt, input.llmConfig);

    let evaluation: EvaluationResult;
    let llmOutputValid = false;
    let validationErrors: string[] = [];

    if (!llmResult.success) {
        console.warn(
            '[EvaluationService] LLM call failed, using fallback:',
            llmResult.error
        );
        validationErrors = [llmResult.error || 'LLM call failed'];
        evaluation = {
            technical_score: 50,
            communication_score: 50,
            confidence_score: 50,
            logic_score: 50,
            depth_score: 50,
            difficulty_recommendation: 'maintain',
            weak_topics: [],
            strengths: [],
            feedback: 'Evaluation could not be completed. Default scores applied.',
            ideal_answer: '',
            improvement_tip: '',
        };
    } else {
        // ── Step 5: Parse and validate LLM output ──
        const parseResult = safeParseEvaluation(llmResult.content);
        evaluation = parseResult.data;
        llmOutputValid = parseResult.success;
        validationErrors = parseResult.errors;

        if (!parseResult.success) {
            console.warn(
                '[EvaluationService] LLM output validation failed, using partial/fallback:',
                parseResult.errors
            );
        }
    }

    // ── Step 6: Atomic database transaction ──
    try {
        const transactionResult = await prisma.$transaction(async (tx) => {
            // 6a. Create the Response record
            const response = await tx.response.create({
                data: {
                    sessionId: input.sessionId,
                    questionId: input.questionId,
                    answerText: input.userAnswer,
                    technicalScore: evaluation.technical_score,
                    communicationScore: evaluation.communication_score,
                    confidenceScore: evaluation.confidence_score,
                    logicScore: evaluation.logic_score,
                    depthScore: evaluation.depth_score,
                    feedback: evaluation.feedback || null,
                    idealAnswer: evaluation.ideal_answer || null,
                    improvementTip: evaluation.improvement_tip || null,
                },
            });

            // 6b. Re-fetch ALL responses for this session (for accurate averages)
            const allResponses = await tx.response.findMany({
                where: { sessionId: input.sessionId },
                select: {
                    technicalScore: true,
                    communicationScore: true,
                    confidenceScore: true,
                    logicScore: true,
                    depthScore: true,
                },
            });

            // 6c. Calculate session averages from in-memory data
            const averages = calculateAveragesFromArray(allResponses);

            // 6d. Upsert ScoreBreakdown
            await tx.scoreBreakdown.upsert({
                where: { sessionId: input.sessionId },
                create: {
                    sessionId: input.sessionId,
                    overallScore: averages.overallScore,
                    technicalAverage: averages.technicalAverage,
                    communicationAverage: averages.communicationAverage,
                    confidenceAverage: averages.confidenceAverage,
                    logicAverage: averages.logicAverage,
                    depthAverage: averages.depthAverage,
                },
                update: {
                    overallScore: averages.overallScore,
                    technicalAverage: averages.technicalAverage,
                    communicationAverage: averages.communicationAverage,
                    confidenceAverage: averages.confidenceAverage,
                    logicAverage: averages.logicAverage,
                    depthAverage: averages.depthAverage,
                },
            });

            // 6e. Update InterviewSession.averageScore
            await tx.interviewSession.update({
                where: { id: input.sessionId },
                data: { averageScore: averages.overallScore },
            });

            return {
                responseId: response.id,
                averages,
            };
        });

        // ── Step 7: Return complete result ──
        return {
            success: true,
            responseId: transactionResult.responseId,
            evaluation,
            sessionAverages: transactionResult.averages,
            llmOutputValid,
            validationErrors,
        };
    } catch (txError) {
        const message = txError instanceof Error ? txError.message : 'Unknown transaction error';
        console.error('[EvaluationService] Transaction failed (rolled back):', message);
        return createFailureOutput(`Database transaction failed: ${message}`);
    }
}

// ============================================
// Re-export types for consumer convenience
// ============================================

export type { EvaluationResult } from './evaluationSchema';
export type { SessionScoreAverages } from './scoreCalculator';
export type { InterviewMode, DifficultyLevel, CompanyPreset } from './evaluationPrompt';
export type { LLMClientConfig } from './llmClient';
