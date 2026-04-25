// ============================================
// AI Router — Intelligent Provider Dispatch
// ============================================
//
// Responsibilities:
//   1. Accept a mode (offline / online / hybrid) + generation params
//   2. Resolve which AI service to call
//   3. Handle hybrid fallback: online → offline
//   4. Normalize all responses to a uniform envelope
//   5. Zero knowledge of HTTP — this is a pure service layer
//
// Adding a new provider:
//   1. Create server/services/ai/NewService.js extending BaseAIService
//   2. Register it in _providerMap below
//   3. Done. No route changes needed.
// ============================================

const { AI_MODES, AI_PROVIDERS } = require('../constants');
const { ollamaService, geminiService, openaiService } = require('../services/ai');

class AIRouter {
  constructor() {
    /** @type {Record<string, import('../services/ai/BaseAIService')>} */
    this._providerMap = {
      [AI_PROVIDERS.OLLAMA]: ollamaService,
      [AI_PROVIDERS.GEMINI]: geminiService,
      [AI_PROVIDERS.OPENAI]: openaiService,
    };

    /** Mode-to-provider resolution order */
    this._modeStrategy = {
      [AI_MODES.OFFLINE]: [AI_PROVIDERS.OLLAMA],
      [AI_MODES.ONLINE]: [AI_PROVIDERS.GEMINI, AI_PROVIDERS.OPENAI],
      [AI_MODES.HYBRID]: [AI_PROVIDERS.GEMINI, AI_PROVIDERS.OPENAI, AI_PROVIDERS.OLLAMA],
    };
  }

  /**
   * Route a generation request to the appropriate AI provider.
   *
   * @param {Object} params
   * @param {string} params.mode - 'offline' | 'online' | 'hybrid'
   * @param {string} params.prompt - Fully built prompt string
   * @param {string} [params.model] - Override model name
   * @param {Object} [params.options] - Provider-specific options
   * @returns {Promise<{success: boolean, provider: string, model: string, output: string|null, meta?: object}>}
   */
  async route({ mode, prompt, model, options = {} }) {
    const providerChain = this._resolveProviderChain(mode);

    if (!providerChain.length) {
      return this._buildRouterError(`Invalid mode: "${mode}". Use: ${Object.values(AI_MODES).join(', ')}`);
    }

    // Walk the provider chain; first success wins
    const errors = [];
    for (const providerKey of providerChain) {
      const service = this._providerMap[providerKey];
      if (!service) {
        errors.push({ provider: providerKey, error: 'Provider not registered.' });
        continue;
      }

      const result = await service.generate({ model, prompt, options });

      if (result.success) {
        return result;
      }

      errors.push({ provider: providerKey, error: result.meta?.error || 'Unknown error' });
    }

    // All providers failed
    return {
      success: false,
      provider: 'ai-router',
      model: model || 'unknown',
      output: null,
      meta: {
        error: 'All providers in the chain failed.',
        code: 'ALL_PROVIDERS_FAILED',
        attempts: errors,
      },
    };
  }

  /**
   * Run health checks across all registered providers.
   *
   * @returns {Promise<Record<string, {available: boolean, models?: string[], error?: string}>>}
   */
  async healthCheckAll() {
    const results = {};
    const entries = Object.entries(this._providerMap);

    const checks = await Promise.allSettled(
      entries.map(([key, service]) => service.healthCheck().then((r) => ({ key, ...r })))
    );

    for (const check of checks) {
      if (check.status === 'fulfilled') {
        const { key, ...rest } = check.value;
        results[key] = rest;
      } else {
        // Should not happen since healthCheck catches internally, but safety net
        results['unknown'] = { available: false, error: check.reason?.message };
      }
    }

    return results;
  }

  /**
   * Register a new AI service at runtime.
   *
   * @param {string} providerKey
   * @param {import('../services/ai/BaseAIService')} serviceInstance
   */
  registerProvider(providerKey, serviceInstance) {
    this._providerMap[providerKey] = serviceInstance;
  }

  // ---- Internals ----

  _resolveProviderChain(mode) {
    return this._modeStrategy[mode] || [];
  }

  _buildRouterError(message) {
    return {
      success: false,
      provider: 'ai-router',
      model: 'none',
      output: null,
      meta: { error: message, code: 'ROUTER_ERROR' },
    };
  }
}

// Export singleton
module.exports = new AIRouter();
