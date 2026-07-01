// ============================================
// roadmapGenerator.ts — 30-Day Improvement Plan Generator
// Part of the Roadmap Engine (Step 8)
// Pure logic — no DB, no LLM, deterministic
// ============================================

/** Valid difficulty levels */
export type DifficultyLevel = 'easy' | 'medium' | 'hard';

/** A single action item within a week */
export interface WeekTask {
    /** Topic or skill to focus on */
    topic: string;
    /** What the user should do */
    action: string;
    /** How often per week */
    frequency: string;
    /** Priority level */
    priority: 'high' | 'medium' | 'low';
}

/** Structured 30-day roadmap */
export interface Roadmap {
    week1: WeekTask[];
    week2: WeekTask[];
    week3: WeekTask[];
    week4: WeekTask[];
}

/** Parameters for roadmap generation */
export interface RoadmapParams {
    /** User's top weak skills (ordered by frequency) */
    weakSkills: string[];
    /** Average technical score from latest session */
    technicalAverage: number;
    /** Average communication score from latest session */
    communicationAverage: number;
    /** Average logic score from latest session */
    logicAverage: number;
    /** Current difficulty level */
    difficulty: DifficultyLevel;
}

/** Threshold below which a category is considered "low scoring" */
const LOW_SCORE_THRESHOLD = 65;

/**
 * Identifies scoring categories that are below the low-score threshold.
 */
function identifyLowCategories(params: RoadmapParams): string[] {
    const low: string[] = [];
    if (params.technicalAverage < LOW_SCORE_THRESHOLD) low.push('technical skills');
    if (params.communicationAverage < LOW_SCORE_THRESHOLD) low.push('communication');
    if (params.logicAverage < LOW_SCORE_THRESHOLD) low.push('logical reasoning');
    return low;
}

/**
 * Gets the top N weak skills, with safe defaults if fewer available.
 */
function getTopWeakSkills(weakSkills: string[], count: number): string[] {
    return weakSkills.slice(0, count);
}

/**
 * Determines practice intensity based on difficulty level.
 */
function getPracticeIntensity(difficulty: DifficultyLevel): {
    dailyProblems: string;
    mockFrequency: string;
} {
    switch (difficulty) {
        case 'easy':
            return { dailyProblems: '2–3 problems/day', mockFrequency: '1 mock interview/week' };
        case 'medium':
            return { dailyProblems: '3–5 problems/day', mockFrequency: '2 mock interviews/week' };
        case 'hard':
            return { dailyProblems: '4–6 problems/day', mockFrequency: '3 mock interviews/week' };
    }
}

/**
 * Generates a structured 30-day improvement roadmap.
 *
 * Strategy:
 * - Week 1: Focus on top 2 weak skills + fundamentals
 * - Week 2: Medium-level practice + timed problems + low-scoring categories
 * - Week 3: Mock interviews + behavioral practice
 * - Week 4: Stress simulation + high-difficulty problems
 *
 * Guarantees:
 * - No LLM calls — pure logic
 * - Deterministic given same inputs
 * - Never throws
 * - Always returns a valid 4-week plan (even if weak skills are empty)
 * - Never mutates input
 *
 * @param params - Roadmap generation parameters
 * @returns A structured 4-week Roadmap
 */
export function generateRoadmap(params: RoadmapParams): Roadmap {
    const { weakSkills, difficulty } = params;
    const lowCategories = identifyLowCategories(params);
    const intensity = getPracticeIntensity(difficulty);
    const topWeak = getTopWeakSkills(weakSkills, 2);
    const secondaryWeak = getTopWeakSkills(weakSkills.slice(2), 3);

    // ── Week 1: Foundation & Top Weak Skills ──
    const week1: WeekTask[] = [];

    if (topWeak.length > 0) {
        for (const skill of topWeak) {
            week1.push({
                topic: skill,
                action: `Study fundamentals of "${skill}". Review core concepts, practice basic problems, and build a cheat sheet.`,
                frequency: intensity.dailyProblems,
                priority: 'high',
            });
        }
    } else {
        week1.push({
            topic: 'General Fundamentals',
            action: 'Review data structures, algorithms, and system design basics. Build a revision schedule.',
            frequency: intensity.dailyProblems,
            priority: 'high',
        });
    }

    // Add low-scoring category practice for week 1
    for (const cat of lowCategories.slice(0, 1)) {
        week1.push({
            topic: cat,
            action: `Targeted practice for ${cat}. Focus on structured explanations and clarity.`,
            frequency: '30 min/day',
            priority: 'high',
        });
    }

    week1.push({
        topic: 'Self-Assessment',
        action: 'Take a diagnostic practice session to benchmark current skill levels.',
        frequency: 'Once this week',
        priority: 'medium',
    });

    // ── Week 2: Medium-Level Practice & Timed Problems ──
    const week2: WeekTask[] = [];

    week2.push({
        topic: 'Timed Problem Solving',
        action: 'Solve problems under a 25-minute timer. Focus on speed and accuracy.',
        frequency: intensity.dailyProblems,
        priority: 'high',
    });

    // Address remaining low-scoring categories
    for (const cat of lowCategories) {
        week2.push({
            topic: cat,
            action: `Intermediate practice for ${cat}. Work through medium-difficulty scenarios.`,
            frequency: '45 min/day',
            priority: 'medium',
        });
    }

    // Add secondary weak skills
    for (const skill of secondaryWeak) {
        week2.push({
            topic: skill,
            action: `Practice "${skill}" at medium difficulty. Attempt 2–3 problems and review solutions.`,
            frequency: 'Every other day',
            priority: 'medium',
        });
    }

    week2.push({
        topic: 'Mock Interview',
        action: 'Complete a timed mock interview session focusing on areas from Week 1.',
        frequency: intensity.mockFrequency,
        priority: 'high',
    });

    // ── Week 3: Mock Interviews & Behavioral Practice ──
    const week3: WeekTask[] = [];

    week3.push({
        topic: 'Full Mock Interviews',
        action: 'Simulate complete interview rounds. Practice both technical and behavioral questions.',
        frequency: intensity.mockFrequency,
        priority: 'high',
    });

    week3.push({
        topic: 'Behavioral Questions',
        action: 'Practice STAR method responses. Prepare stories for leadership, conflict, and failure scenarios.',
        frequency: '2–3 stories/day',
        priority: 'high',
    });

    if (topWeak.length > 0) {
        week3.push({
            topic: topWeak[0],
            action: `Advanced practice for "${topWeak[0]}". Attempt hard-level problems and edge cases.`,
            frequency: intensity.dailyProblems,
            priority: 'medium',
        });
    }

    week3.push({
        topic: 'Communication Drill',
        action: 'Practice explaining solutions out loud. Record yourself and review for clarity and structure.',
        frequency: '1 session/day',
        priority: 'medium',
    });

    // ── Week 4: Stress Simulation & High-Difficulty ──
    const week4: WeekTask[] = [];

    week4.push({
        topic: 'Stress Interview Simulation',
        action: 'Run interview sessions in "stress" mode. Practice under pressure with tight time limits.',
        frequency: intensity.mockFrequency,
        priority: 'high',
    });

    week4.push({
        topic: 'Hard-Difficulty Problems',
        action: 'Attempt hard-level questions across all categories. Focus on system design and complex algorithms.',
        frequency: intensity.dailyProblems,
        priority: 'high',
    });

    week4.push({
        topic: 'Weakness Review',
        action: `Review all weak areas: ${weakSkills.length > 0 ? weakSkills.slice(0, 4).join(', ') : 'general topics'}. Ensure gaps are closed.`,
        frequency: 'Daily review sessions',
        priority: 'high',
    });

    week4.push({
        topic: 'Final Assessment',
        action: 'Take a comprehensive mock interview covering all categories. Compare scores to Week 1 benchmark.',
        frequency: 'End of week',
        priority: 'high',
    });

    return { week1, week2, week3, week4 };
}
