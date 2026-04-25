// ============================================
// evaluationPrompt.ts — Dynamic Evaluation Prompt Generator
// Part of the Unified Scoring Engine
// Generates mode-aware, role-aware LLM prompts for response evaluation
// ============================================

/**
 * Supported interview simulation modes.
 * Each mode adjusts the evaluator's tone and strictness.
 */
export type InterviewMode = 'normal' | 'stress' | 'company';

/**
 * Supported difficulty levels.
 * Controls scoring leniency and expectation depth.
 */
export type DifficultyLevel = 'easy' | 'medium' | 'hard';

/**
 * Company simulation presets for the 'company' mode.
 */
export type CompanyPreset =
    | 'google'
    | 'amazon'
    | 'meta'
    | 'startup'
    | 'consulting'
    | 'generic';

/**
 * Input parameters for prompt generation.
 */
export interface EvaluationPromptParams {
    /** The question that was asked */
    questionText: string;
    /** The candidate's answer */
    userAnswer: string;
    /** Target job role (e.g., "Senior Backend Engineer") */
    role: string;
    /** Difficulty level of the question */
    difficulty: DifficultyLevel;
    /** Interview simulation mode */
    mode: InterviewMode;
    /** Category of the question (e.g., "technical", "behavioral") */
    category: string;
    /** Optional company preset for 'company' mode */
    companyPreset?: CompanyPreset;
}

// ============================================
// Mode-specific personality and tone configuration
// ============================================

function getModeDirective(mode: InterviewMode, companyPreset?: CompanyPreset): string {
    switch (mode) {
        case 'stress':
            return [
                'You are a demanding, high-pressure interviewer.',
                'You have very high standards and expect precision.',
                'Score strictly. Penalize vagueness, hesitation markers, and filler words.',
                'Be critical but fair. Identify every weakness.',
                'Your feedback should be direct and unforgiving, pointing out exactly where the candidate fell short.',
            ].join(' ');

        case 'company': {
            const companyDirectives: Record<CompanyPreset, string> = {
                google: [
                    'You are a Google L5+ interviewer.',
                    'Evaluate for Googleyness: intellectual curiosity, ownership, collaboration.',
                    'Expect scalability thinking, clean algorithmic reasoning, and trade-off analysis.',
                    'Score harshly on depth — surface-level answers score below 40.',
                ].join(' '),
                amazon: [
                    'You are an Amazon Bar Raiser interviewer.',
                    'Evaluate using Leadership Principles: Ownership, Dive Deep, Bias for Action, Customer Obsession.',
                    'Expect STAR-format behavioral answers with measurable outcomes.',
                    'Score harshly if the candidate does not quantify impact.',
                ].join(' '),
                meta: [
                    'You are a Meta E5+ interviewer.',
                    'Evaluate for impact-driven thinking, move-fast mentality, and systems reasoning.',
                    'Expect clear problem decomposition and practical solutions.',
                    'Score harshly on communication — unclear explanations score below 35.',
                ].join(' '),
                startup: [
                    'You are a startup CTO interviewer.',
                    'Evaluate for scrappiness, breadth of knowledge, and ability to wear multiple hats.',
                    'Value practical solutions over theoretical perfection.',
                    'Score favorably for resourcefulness and pragmatism.',
                ].join(' '),
                consulting: [
                    'You are a McKinsey/BCG case interviewer.',
                    'Evaluate for structured thinking, hypothesis-driven analysis, and clear communication.',
                    'Expect MECE frameworks and data-driven reasoning.',
                    'Score harshly on logic — unstructured answers score below 30.',
                ].join(' '),
                generic: [
                    'You are a senior technical interviewer at a Fortune 500 company.',
                    'Evaluate for technical depth, communication clarity, and professional maturity.',
                    'Expect well-structured answers with concrete examples.',
                ].join(' '),
            };
            return companyDirectives[companyPreset || 'generic'];
        }

        case 'normal':
        default:
            return [
                'You are a fair, experienced technical interviewer.',
                'Evaluate the candidate objectively.',
                'Balance encouragement with honest feedback.',
                'Identify both strengths and areas for improvement.',
                'Be constructive in your feedback.',
            ].join(' ');
    }
}

function getDifficultyDirective(difficulty: DifficultyLevel): string {
    switch (difficulty) {
        case 'easy':
            return [
                'This is an entry-level question.',
                'Be lenient with scoring.',
                'Accept simplified explanations as long as core concepts are correct.',
                'Scores above 70 are appropriate for correct but basic answers.',
            ].join(' ');
        case 'hard':
            return [
                'This is an advanced-level question.',
                'Be strict with scoring.',
                'Expect deep technical knowledge, edge case awareness, and trade-off discussion.',
                'Only award scores above 80 for truly exceptional answers.',
                'Penalize missing scalability or performance considerations.',
            ].join(' ');
        case 'medium':
        default:
            return [
                'This is a mid-level question.',
                'Score fairly based on completeness and accuracy.',
                'Expect reasonable depth and some discussion of trade-offs.',
                'Scores of 60-80 are appropriate for solid but not exceptional answers.',
            ].join(' ');
    }
}

// ============================================
// The strict JSON output schema definition, embedded in the prompt
// ============================================

const OUTPUT_SCHEMA_INSTRUCTION = `
You MUST respond with ONLY a single valid JSON object. Nothing else.

DO NOT include:
- Markdown formatting
- Backticks or code fences
- Explanatory text before or after the JSON
- Comments inside the JSON
- Trailing commas

The JSON object MUST have EXACTLY these fields with EXACTLY these types:

{
  "technical_score": <number 0-100>,
  "communication_score": <number 0-100>,
  "confidence_score": <number 0-100>,
  "logic_score": <number 0-100>,
  "depth_score": <number 0-100>,
  "difficulty_recommendation": <"increase" | "decrease" | "maintain">,
  "weak_topics": <array of strings>,
  "strengths": <array of strings>,
  "feedback": <non-empty string>,
  "ideal_answer": <non-empty string>,
  "improvement_tip": <non-empty string>
}

Scoring scale:
- 0-20: Completely wrong or no answer
- 21-40: Major gaps, fundamental misunderstanding
- 41-60: Partial understanding, missing key points
- 61-80: Good answer with minor gaps
- 81-100: Excellent, comprehensive, expert-level

NO EXTRA FIELDS. NO MISSING FIELDS. ONLY THE EXACT JSON ABOVE.
`.trim();

// ============================================
// Main prompt generator
// ============================================

/**
 * Generates a complete evaluation prompt for the LLM.
 * The prompt is deterministic given the same inputs.
 */
export function generateEvaluationPrompt(params: EvaluationPromptParams): string {
    const {
        questionText,
        userAnswer,
        role,
        difficulty,
        mode,
        category,
        companyPreset,
    } = params;

    const modeDirective = getModeDirective(mode, companyPreset);
    const difficultyDirective = getDifficultyDirective(difficulty);

    const prompt = [
        // System identity
        `ROLE: AI Interview Evaluator`,
        ``,
        // Mode-specific personality
        `INTERVIEWER PERSONALITY:`,
        modeDirective,
        ``,
        // Difficulty calibration
        `DIFFICULTY CALIBRATION:`,
        difficultyDirective,
        ``,
        // Context
        `EVALUATION CONTEXT:`,
        `- Target Role: ${role}`,
        `- Question Category: ${category}`,
        `- Question Difficulty: ${difficulty}`,
        `- Interview Mode: ${mode}${mode === 'company' ? ` (${companyPreset || 'generic'})` : ''}`,
        ``,
        // The question
        `QUESTION ASKED:`,
        `"${questionText}"`,
        ``,
        // The candidate's answer
        `CANDIDATE'S ANSWER:`,
        `"${userAnswer}"`,
        ``,
        // Scoring criteria
        `SCORING CRITERIA:`,
        `1. technical_score: Correctness of technical content, accuracy of concepts, proper use of terminology.`,
        `2. communication_score: Clarity of explanation, structure of answer, ability to articulate ideas.`,
        `3. confidence_score: Assertiveness, decisiveness, absence of excessive hedging or filler words.`,
        `4. logic_score: Logical reasoning, step-by-step thinking, problem decomposition.`,
        `5. depth_score: Depth of knowledge, awareness of edge cases, trade-offs, and real-world implications.`,
        ``,
        `ADDITIONAL REQUIREMENTS:`,
        `- "difficulty_recommendation": Based on the candidate's performance, recommend whether to increase, decrease, or maintain the difficulty level.`,
        `- "weak_topics": List specific topics/concepts the candidate struggles with (empty array if none).`,
        `- "strengths": List specific strengths demonstrated (empty array if none).`,
        `- "feedback": Provide detailed, actionable feedback on the answer (2-4 sentences minimum).`,
        `- "ideal_answer": Provide what a perfect answer would look like (2-4 sentences minimum).`,
        `- "improvement_tip": Provide one concrete, actionable tip for improvement.`,
        ``,
        // Strict output format
        `OUTPUT FORMAT:`,
        OUTPUT_SCHEMA_INSTRUCTION,
    ].join('\n');

    return prompt;
}
