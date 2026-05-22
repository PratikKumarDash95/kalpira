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
// Optional shared-secret protection for the verbose health endpoint.
// Set HEALTH_TOKEN in the env to require a matching `X-Health-Token` header.
function requireHealthToken(req, res, next) {
  const expected = process.env.HEALTH_TOKEN;
  if (!expected) return next(); // open if not configured
  const got = req.headers['x-health-token'];
  if (got !== expected) {
    return res.status(401).json({ status: 'unauthorized' });
  }
  return next();
}

// Strip provider internals from public responses (errors, model lists)
// unless the caller authenticated with HEALTH_TOKEN.
function redactProviders(providers, isAuthorized) {
  if (isAuthorized) return providers;
  const redacted = {};
  for (const [key, value] of Object.entries(providers)) {
    redacted[key] = { available: !!value?.available };
  }
  return redacted;
}

router.get('/health', requireHealthToken, async (req, res) => {
  try {
    const providers = await aiRouter.healthCheckAll();

    const availableCount = Object.values(providers).filter((p) => p.available).length;
    const totalCount = Object.keys(providers).length;

    let status = 'down';
    if (availableCount === totalCount) status = 'ok';
    else if (availableCount > 0) status = 'degraded';

    const isAuthorized = !!process.env.HEALTH_TOKEN && req.headers['x-health-token'] === process.env.HEALTH_TOKEN;

    return res.status(200).json({
      status,
      providers: redactProviders(providers, isAuthorized),
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

router.get('/health/ollama', requireHealthToken, async (req, res) => {
  try {
    const { ollamaService } = require('../services/ai');
    const result = await ollamaService.healthCheck();
    const isAuthorized = !!process.env.HEALTH_TOKEN && req.headers['x-health-token'] === process.env.HEALTH_TOKEN;

    return res.status(200).json({
      ollamaRunning: result.available,
      availableModels: isAuthorized ? (result.models || []) : [],
      error: isAuthorized ? (result.error || null) : null,
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
