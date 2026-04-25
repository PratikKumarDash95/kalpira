// ============================================
// questionSelector.ts — Intelligent Question Selector
// Part of the Adaptive Difficulty Engine
// Pure database logic — no LLM, no scoring
// ============================================

import prisma from '@/lib/prisma';
import type { DifficultyLevel } from './difficultyEngine';

/** Parameters for selecting the next question */
export interface QuestionSelectionParams {
    /** The current interview session ID */
    sessionId: string;
    /** The target difficulty level for the next question */
    difficulty: DifficultyLevel;
    /** Optional category filter (e.g., "technical", "behavioral") */
    category?: string;
    /** Optional weak topics to prioritize */
    weakTopics?: string[];
}

/** Shape of the returned question (matches Prisma Question model) */
export interface SelectedQuestion {
    id: string;
    text: string;
    difficulty: string;
    category: string;
}

/**
 * Selects the next question for an adaptive interview session.
 *
 * Selection strategy (ordered by priority):
 * 1. Match difficulty + category OR intersect weak topics, excluding already asked
 * 2. Fallback: match difficulty only, excluding already asked
 * 3. Final fallback: maintain difficulty, random question (may include repeats)
 *
 * Guarantees:
 * - Never calls LLM
 * - Never throws unless DB is unreachable
 * - Returns null only if the question bank is completely empty
 * - Randomized selection within matching candidates
 *
 * @param params - Selection parameters
 * @returns A selected question or null if none available
 */
export async function selectNextQuestion(
    params: QuestionSelectionParams
): Promise<SelectedQuestion | null> {
    const { sessionId, difficulty, category, weakTopics } = params;

    // Step 1: Build exclusion list — all questions already asked in this session
    const askedQuestions = await prisma.question.findMany({
        where: { sessionId },
        select: { id: true },
    });
    const excludedIds = askedQuestions.map((q) => q.id);

    // Step 2: Try primary selection — difficulty + (category OR weak topics)
    const primaryResult = await attemptPrimarySelection(
        difficulty,
        excludedIds,
        category,
        weakTopics
    );
    if (primaryResult) {
        return primaryResult;
    }

    // Step 3: Fallback — difficulty only, no category/weak topic filter
    const fallbackResult = await attemptDifficultyOnlySelection(difficulty, excludedIds);
    if (fallbackResult) {
        return fallbackResult;
    }

    // Step 4: Final fallback — any question at this difficulty (including repeats)
    const finalResult = await attemptFinalFallback(difficulty);
    return finalResult;
}

/**
 * Attempts to select a question matching difficulty and category/weak topics.
 * Uses OR logic: either category matches or question category intersects weak topics.
 */
async function attemptPrimarySelection(
    difficulty: DifficultyLevel,
    excludedIds: string[],
    category?: string,
    weakTopics?: string[]
): Promise<SelectedQuestion | null> {
    // Build category filters
    const categoryFilters: Array<{ category: string }> = [];

    if (category) {
        categoryFilters.push({ category });
    }

    // Add weak topics as additional category matches
    if (weakTopics && weakTopics.length > 0) {
        for (const topic of weakTopics) {
            const normalized = topic.trim().toLowerCase();
            if (normalized.length > 0) {
                categoryFilters.push({ category: normalized });
            }
        }
    }

    // If no category filters available, skip primary selection
    if (categoryFilters.length === 0) {
        return null;
    }

    const candidates = await prisma.question.findMany({
        where: {
            difficulty,
            id: { notIn: excludedIds.length > 0 ? excludedIds : undefined },
            OR: categoryFilters,
        },
        select: {
            id: true,
            text: true,
            difficulty: true,
            category: true,
        },
    });

    return pickRandom(candidates);
}

/**
 * Attempts to select any question matching the difficulty, excluding already asked.
 */
async function attemptDifficultyOnlySelection(
    difficulty: DifficultyLevel,
    excludedIds: string[]
): Promise<SelectedQuestion | null> {
    const candidates = await prisma.question.findMany({
        where: {
            difficulty,
            id: { notIn: excludedIds.length > 0 ? excludedIds : undefined },
        },
        select: {
            id: true,
            text: true,
            difficulty: true,
            category: true,
        },
    });

    return pickRandom(candidates);
}

/**
 * Final fallback: any question at the given difficulty, ignoring exclusion list.
 */
async function attemptFinalFallback(
    difficulty: DifficultyLevel
): Promise<SelectedQuestion | null> {
    const candidates = await prisma.question.findMany({
        where: { difficulty },
        select: {
            id: true,
            text: true,
            difficulty: true,
            category: true,
        },
    });

    return pickRandom(candidates);
}

/**
 * Picks a random element from an array. Returns null if array is empty.
 */
function pickRandom(items: SelectedQuestion[]): SelectedQuestion | null {
    if (items.length === 0) {
        return null;
    }
    const index = Math.floor(Math.random() * items.length);
    return items[index];
}
