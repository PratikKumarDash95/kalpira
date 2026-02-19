// ============================================
// Prompt Builder — Deterministic, Reusable, Decoupled
// ============================================

const { DIFFICULTY_LEVELS } = require('../constants');

/**
 * Builds a structured system prompt for AI interview generation.
 *
 * @param {Object} params
 * @param {string} params.role - Target job role (e.g. "Senior Backend Engineer")
 * @param {string} params.difficulty - One of DIFFICULTY_LEVELS
 * @param {string[]} [params.weakSkills] - Skills the candidate struggles with
 * @param {string[]} [params.previousMistakes] - Past mistakes to probe
 * @param {string} [params.focusArea] - Optional focus area (e.g. "system design")
 * @returns {string} Fully constructed system prompt
 */
function buildInterviewPrompt({ role, difficulty, weakSkills = [], previousMistakes = [], focusArea = '' }) {
  const difficultyDirective = _getDifficultyDirective(difficulty);
  const weakSkillsBlock = _buildWeakSkillsBlock(weakSkills);
  const mistakesBlock = _buildMistakesBlock(previousMistakes);
  const focusBlock = focusArea ? `\nFocus Area: Prioritize questions around "${focusArea}".` : '';

  return [
    `You are a professional technical interviewer conducting a ${difficulty} interview for the role of ${role}.`,
    '',
    difficultyDirective,
    '',
    'Interview Protocol:',
    '- Ask one question at a time.',
    '- Wait for the candidate\'s response before proceeding.',
    '- Provide brief, constructive feedback after each answer.',
    '- Adapt follow-up questions based on the candidate\'s responses.',
    '- Evaluate technical accuracy, communication clarity, and depth of understanding.',
    '',
    weakSkillsBlock,
    mistakesBlock,
    focusBlock,
    '',
    'Response Format:',
    '- Keep questions concise and specific.',
    '- Grade responses on a 1-10 scale internally.',
    '- Probe deeper on vague or surface-level answers.',
    '- Conclude with a brief performance summary when instructed.',
  ].filter(Boolean).join('\n');
}

/**
 * Builds a follow-up prompt enriched with user context.
 *
 * @param {Object} params
 * @param {string} params.role
 * @param {string} params.userContext - Free-form context from the user
 * @param {string} params.difficulty
 * @returns {string}
 */
function buildContextualPrompt({ role, userContext, difficulty }) {
  return [
    buildInterviewPrompt({ role, difficulty }),
    '',
    'Additional Context from Candidate:',
    userContext,
    '',
    'Use this context to tailor your questions. Reference specific technologies, projects, or experiences mentioned.',
  ].join('\n');
}

/**
 * Builds a prompt for evaluating a single candidate response.
 *
 * @param {Object} params
 * @param {string} params.question - The interview question
 * @param {string} params.answer - The candidate's answer
 * @param {string} params.role
 * @returns {string}
 */
function buildEvaluationPrompt({ question, answer, role }) {
  return [
    `You are evaluating a candidate's response for the role of ${role}.`,
    '',
    `Question: ${question}`,
    `Candidate's Answer: ${answer}`,
    '',
    'Provide a structured evaluation in JSON format:',
    '{',
    '  "technicalScore": <1-10>,',
    '  "communicationScore": <1-10>,',
    '  "confidenceScore": <1-10>,',
    '  "logicScore": <1-10>,',
    '  "depthScore": <1-10>,',
    '  "feedback": "<constructive feedback>",',
    '  "idealAnswer": "<brief ideal answer outline>",',
    '  "improvementTip": "<specific improvement suggestion>"',
    '}',
  ].join('\n');
}

// ---- Private Helpers ----

function _getDifficultyDirective(difficulty) {
  const directives = {
    [DIFFICULTY_LEVELS.EASY]: 'Difficulty: Ask fundamental, introductory-level questions. Be encouraging and supportive.',
    [DIFFICULTY_LEVELS.MEDIUM]: 'Difficulty: Ask intermediate questions that require practical experience. Expect reasonable depth.',
    [DIFFICULTY_LEVELS.HARD]: 'Difficulty: Ask advanced questions covering edge cases, trade-offs, and system-level thinking. Be rigorous.',
  };
  return directives[difficulty] || directives[DIFFICULTY_LEVELS.MEDIUM];
}

function _buildWeakSkillsBlock(weakSkills) {
  if (!weakSkills.length) return '';
  return [
    'Known Weak Areas (probe these):',
    ...weakSkills.map((s) => `  - ${s}`),
  ].join('\n');
}

function _buildMistakesBlock(previousMistakes) {
  if (!previousMistakes.length) return '';
  return [
    'Previous Mistakes to Revisit:',
    ...previousMistakes.map((m) => `  - ${m}`),
  ].join('\n');
}

module.exports = {
  buildInterviewPrompt,
  buildContextualPrompt,
  buildEvaluationPrompt,
};
