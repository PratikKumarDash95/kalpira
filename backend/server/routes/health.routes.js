// ============================================
// Health Routes — AI Provider Health Checks
// ============================================

const express = require('express');
const router = express.Router();
const aiRouter = require('../router');

/**
 * GET /api/ai/health
 *
 * Returns health status for all registered AI providers.
 *
 * Response:
 * {
 *   status: 'ok' | 'degraded' | 'down',
 *   providers: {
 *     ollama: { available: boolean, models: string[], error?: string },
 *     gemini: { available: boolean, models: string[], error?: string },
 *     openai: { available: boolean, models: string[], error?: string }
 *   },
 *   timestamp: string
 * }
 */
router.get('/health', async (_req, res) => {
  try {
    const providers = await aiRouter.healthCheckAll();

    const availableCount = Object.values(providers).filter((p) => p.available).length;
    const totalCount = Object.keys(providers).length;

    let status = 'down';
    if (availableCount === totalCount) status = 'ok';
    else if (availableCount > 0) status = 'degraded';

    return res.status(200).json({
      status,
      providers,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[HealthRoute] /health error:', error);
    return res.status(500).json({
      status: 'error',
      providers: {},
      timestamp: new Date().toISOString(),
      error: 'Failed to execute health checks.',
    });
  }
});

/**
 * GET /api/ai/health/ollama
 *
 * Ollama-specific health check with model list.
 * Legacy/convenience endpoint matching original requirements.
 */
router.get('/health/ollama', async (_req, res) => {
  try {
    const { ollamaService } = require('../services/ai');
    const result = await ollamaService.healthCheck();

    return res.status(200).json({
      ollamaRunning: result.available,
      availableModels: result.models || [],
      error: result.error || null,
    });
  } catch (error) {
    console.error('[HealthRoute] /health/ollama error:', error);
    return res.status(500).json({
      ollamaRunning: false,
      availableModels: [],
      error: 'Failed to check Ollama status.',
    });
  }
});

module.exports = router;
