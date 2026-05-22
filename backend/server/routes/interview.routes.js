// ============================================
// Interview Routes — Thin Controller Layer
// ============================================

const express = require('express');
const router = express.Router();
const aiRouter = require('../router');
const { buildInterviewPrompt, buildContextualPrompt, buildEvaluationPrompt } = require('../utils/promptBuilder');
const { AI_MODES } = require('../constants');
const {
  sanitizeAskInput,
  sanitizeEvaluateInput,
  validateMode,
  validateDifficulty,
  validateModel,
} = require('../utils/sanitize');

// Map provider result codes to appropriate HTTP status
function statusForResult(result) {
  if (result.success) return 200;
  const code = result?.meta?.code;
  if (code === 'API_KEY_MISSING') return 503;       // server misconfigured
  if (code === 'EMPTY_RESPONSE') return 502;        // upstream returned nothing usable
  if (code === 'TIMEOUT' || code === 'ETIMEDOUT') return 504;
  return 502;                                       // generic upstream failure
}

router.post('/ask', async (req, res) => {
  try {
    const mode = validateMode(req.body.mode) || AI_MODES.OFFLINE;
    const sanitized = sanitizeAskInput(req.body);
    const difficulty = validateDifficulty(sanitized.difficulty);
    const model = validateModel(req.body.model);

    if (!sanitized.role) {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid required field: role.',
      });
    }
    if (!difficulty) {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid required field: difficulty (easy|medium|hard).',
      });
    }

    const prompt = sanitized.userContext
      ? buildContextualPrompt({ role: sanitized.role, userContext: sanitized.userContext, difficulty })
      : buildInterviewPrompt({
          role: sanitized.role,
          difficulty,
          weakSkills: sanitized.weakSkills,
          previousMistakes: sanitized.previousMistakes,
        });

    const result = await aiRouter.route({ mode, prompt, model });
    return res.status(statusForResult(result)).json(result);
  } catch (error) {
    console.error('[InterviewRoute] /ask error:', error);
    return res.status(500).json({
      success: false,
      provider: 'server',
      model: 'none',
      output: null,
      meta: { error: 'Internal server error.', code: 'INTERNAL_ERROR' },
    });
  }
});

/**
 * POST /api/interview/evaluate
 *
 * Evaluate a candidate's response to a question.
 *
 * Body:
 *   mode     - 'offline' | 'online' | 'hybrid'
 *   role     - Target job role
 *   question - The interview question
 *   answer   - The candidate's answer
 *   model    - Override model name (optional)
 */
router.post('/evaluate', async (req, res) => {
  try {
    const mode = validateMode(req.body.mode) || AI_MODES.OFFLINE;
    const sanitized = sanitizeEvaluateInput(req.body);
    const model = validateModel(req.body.model);

    if (!sanitized.role || !sanitized.question || !sanitized.answer) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: role, question, answer.',
      });
    }

    const prompt = buildEvaluationPrompt({
      question: sanitized.question,
      answer: sanitized.answer,
      role: sanitized.role,
    });
    const result = await aiRouter.route({ mode, prompt, model });
    return res.status(statusForResult(result)).json(result);
  } catch (error) {
    console.error('[InterviewRoute] /evaluate error:', error);
    return res.status(500).json({
      success: false,
      provider: 'server',
      model: 'none',
      output: null,
      meta: { error: 'Internal server error.', code: 'INTERNAL_ERROR' },
    });
  }
});

module.exports = router;
