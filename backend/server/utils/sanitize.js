// ============================================
// Input Sanitization & Length Guards
// ============================================
// Defense against prompt injection and oversized inputs.

const MAX_CONTEXT_LEN = 4_000;
const MAX_ANSWER_LEN = 8_000;
const MAX_QUESTION_LEN = 2_000;
const MAX_ROLE_LEN = 200;
const MAX_SKILL_ITEMS = 20;
const MAX_SKILL_LEN = 200;

// Strip control characters (except tab \x09, newline \x0A, carriage return \x0D)
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function clipString(value, maxLen) {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .replace(CONTROL_CHAR_REGEX, '')
    .replace(/```/g, "'''");
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

function clipArray(value, maxItems, maxLen) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === 'string' && v.trim())
    .slice(0, maxItems)
    .map((v) => clipString(v, maxLen));
}

function sanitizeAskInput(body) {
  return {
    role: clipString(body.role, MAX_ROLE_LEN),
    difficulty: typeof body.difficulty === 'string' ? body.difficulty.toLowerCase() : '',
    userContext: clipString(body.userContext, MAX_CONTEXT_LEN),
    weakSkills: clipArray(body.weakSkills, MAX_SKILL_ITEMS, MAX_SKILL_LEN),
    previousMistakes: clipArray(body.previousMistakes, MAX_SKILL_ITEMS, MAX_SKILL_LEN),
  };
}

function sanitizeEvaluateInput(body) {
  return {
    role: clipString(body.role, MAX_ROLE_LEN),
    question: clipString(body.question, MAX_QUESTION_LEN),
    answer: clipString(body.answer, MAX_ANSWER_LEN),
  };
}

const ALLOWED_MODES = ['offline', 'online', 'hybrid'];
const ALLOWED_DIFFICULTIES = ['easy', 'medium', 'hard'];

function validateMode(mode) {
  return ALLOWED_MODES.includes(mode) ? mode : null;
}

function validateDifficulty(difficulty) {
  return ALLOWED_DIFFICULTIES.includes(difficulty) ? difficulty : null;
}

function validateModel(model) {
  if (model === undefined || model === null) return null;
  if (typeof model !== 'string') return null;
  if (!/^[a-zA-Z0-9._\-:/]{1,128}$/.test(model)) return null;
  return model;
}

module.exports = {
  sanitizeAskInput,
  sanitizeEvaluateInput,
  validateMode,
  validateDifficulty,
  validateModel,
  ALLOWED_MODES,
  ALLOWED_DIFFICULTIES,
};
