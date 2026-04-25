// ============================================
// Gemini Service — Cloud AI Provider (Placeholder)
// ============================================

const BaseAIService = require('./BaseAIService');
const { AI_PROVIDERS, GEMINI_CONFIG } = require('../../constants');

class GeminiService extends BaseAIService {
  constructor() {
    super(AI_PROVIDERS.GEMINI);
    this.baseUrl = GEMINI_CONFIG.BASE_URL;
    this.defaultModel = GEMINI_CONFIG.DEFAULT_MODEL;
    this.timeoutMs = GEMINI_CONFIG.TIMEOUT_MS;
    this.apiKey = process.env.GEMINI_API_KEY || null;
  }

  /**
   * @param {Object} params
   * @param {string} [params.model]
   * @param {string} params.prompt
   * @param {Object} [params.options]
   * @returns {Promise<{success: boolean, provider: string, model: string, output: string, meta?: object}>}
   */
  async generate({ model, prompt, options = {} }) {
    const targetModel = model || this.defaultModel;

    if (!this.apiKey) {
      return this._buildError(
        Object.assign(new Error('Gemini API key not configured. Set GEMINI_API_KEY environment variable.'), {
          code: 'API_KEY_MISSING',
        }),
        targetModel
      );
    }

    // TODO: Implement Gemini API call
    // const response = await axios.post(
    //   `${this.baseUrl}/models/${targetModel}:generateContent?key=${this.apiKey}`,
    //   { contents: [{ parts: [{ text: prompt }] }] },
    //   { timeout: this.timeoutMs }
    // );

    return this._buildError(
      Object.assign(new Error('Gemini service is not yet implemented.'), {
        code: 'NOT_IMPLEMENTED',
      }),
      targetModel
    );
  }

  /**
   * @returns {Promise<{available: boolean, models?: string[], error?: string}>}
   */
  async healthCheck() {
    if (!this.apiKey) {
      return {
        available: false,
        models: [],
        error: 'Gemini API key not configured.',
      };
    }

    // TODO: Implement Gemini health check
    return {
      available: false,
      models: [],
      error: 'Gemini health check not yet implemented.',
    };
  }
}

module.exports = new GeminiService();
