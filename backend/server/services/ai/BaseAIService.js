// ============================================
// Base AI Service — Abstract Contract
// ============================================

/**
 * All AI service implementations must conform to this interface.
 * This is enforced by convention in JavaScript; in TypeScript
 * this would be an abstract class or interface.
 */
class BaseAIService {
  constructor(providerName) {
    if (new.target === BaseAIService) {
      throw new Error('BaseAIService is abstract and cannot be instantiated directly.');
    }
    this.providerName = providerName;
  }

  /**
   * Generate a text response from the AI model.
   *
   * @param {Object} params
   * @param {string} params.model - Model identifier
   * @param {string} params.prompt - Fully constructed prompt
   * @param {Object} [params.options] - Provider-specific options
   * @returns {Promise<{output: string, model: string, meta?: object}>}
   */
  async generate(_params) {
    throw new Error(`${this.providerName}: generate() not implemented.`);
  }

  /**
   * Check if the service is reachable and operational.
   *
   * @returns {Promise<{available: boolean, models?: string[], error?: string}>}
   */
  async healthCheck() {
    throw new Error(`${this.providerName}: healthCheck() not implemented.`);
  }

  /**
   * Build a normalized response envelope.
   */
  _buildResponse({ success, output, model, meta = {} }) {
    return {
      success,
      provider: this.providerName,
      model,
      output,
      meta,
    };
  }

  /**
   * Build a normalized error envelope.
   */
  _buildError(error, model = 'unknown') {
    return {
      success: false,
      provider: this.providerName,
      model,
      output: null,
      meta: {
        error: error.message || String(error),
        code: error.code || 'PROVIDER_ERROR',
      },
    };
  }
}

module.exports = BaseAIService;
