// ============================================
// Interview Routes — Thin Controller Layer
// ============================================

const express = require('express');
const router = express.Router();
const aiRouter = require('../router');
const { buildInterviewPrompt, buildContextualPrompt, buildEvaluationPrompt } = require('../utils/promptBuilder');
const { AI_MODES } = require('../constants');

/**
 * POST /api/interview/ask
 *
 * Generate the next interview question or follow-up.
 *
 * Body:
 *   mode        - 'offline' | 'online' | 'hybrid'
 *   role        - Target job role
 *   difficulty  - 'easy' | 'medium' | 'hard'
 *   userContext - Free-form context from the candidate (optional)
 *   weakSkills  - Array of weak skill names (optional)
 *   previousMistakes - Array of previous mistakes (optional)
 *   model       - Override model name (optional)
 */
router.post('/ask', async (req, res) => {
  try {
    const {
      mode = AI_MODES.OFFLINE,
      role,
      difficulty,
      userContext,
      weakSkills = [],
      previousMistakes = [],
      model,
    } = req.body;

    if (!role || !difficulty) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: role, difficulty.',
      });
    }

    const prompt = userContext
      ? buildContextualPrompt({ role, userContext, difficulty })
      : buildInterviewPrompt({ role, difficulty, weakSkills, previousMistakes });

    const result = await aiRouter.route({ mode, prompt, model });

    const statusCode = result.success ? 200 : 502;
    return res.status(statusCode).json(result);
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
    const {
      mode = AI_MODES.OFFLINE,
      role,
      question,
      answer,
      model,
    } = req.body;

    if (!role || !question || !answer) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: role, question, answer.',
      });
    }

    const prompt = buildEvaluationPrompt({ question, answer, role });
    const result = await aiRouter.route({ mode, prompt, model });

    const statusCode = result.success ? 200 : 502;
    return res.status(statusCode).json(result);
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
