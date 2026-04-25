// ============================================
// OpenAI Service — Cloud AI Provider (Placeholder)
// ============================================

const BaseAIService = require('./BaseAIService');
const { AI_PROVIDERS, OPENAI_CONFIG } = require('../../constants');

class OpenAIService extends BaseAIService {
  constructor() {
    super(AI_PROVIDERS.OPENAI);
    this.baseUrl = OPENAI_CONFIG.BASE_URL;
    this.defaultModel = OPENAI_CONFIG.DEFAULT_MODEL;
    this.timeoutMs = OPENAI_CONFIG.TIMEOUT_MS;
    this.apiKey = process.env.OPENAI_API_KEY || null;
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
        Object.assign(new Error('OpenAI API key not configured. Set OPENAI_API_KEY environment variable.'), {
          code: 'API_KEY_MISSING',
        }),
        targetModel
      );
    }

    // TODO: Implement OpenAI API call
    // const response = await axios.post(
    //   `${this.baseUrl}/chat/completions`,
    //   {
    //     model: targetModel,
    //     messages: [{ role: 'user', content: prompt }],
    //   },
    //   {
    //     timeout: this.timeoutMs,
    //     headers: {
    //       'Content-Type': 'application/json',
    //       'Authorization': `Bearer ${this.apiKey}`,
    //     },
    //   }
    // );

    return this._buildError(
      Object.assign(new Error('OpenAI service is not yet implemented.'), {
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
        error: 'OpenAI API key not configured.',
      };
    }

    // TODO: Implement OpenAI health check
    return {
      available: false,
      models: [],
      error: 'OpenAI health check not yet implemented.',
    };
  }
}

module.exports = new OpenAIService();
