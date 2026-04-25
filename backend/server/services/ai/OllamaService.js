// ============================================
// Ollama Service — Local Offline AI Provider
// ============================================

const axios = require('axios');
const BaseAIService = require('./BaseAIService');
const { AI_PROVIDERS, OLLAMA_CONFIG } = require('../../constants');

class OllamaService extends BaseAIService {
  constructor() {
    super(AI_PROVIDERS.OLLAMA);
    this.baseUrl = OLLAMA_CONFIG.BASE_URL;
    this.defaultModel = OLLAMA_CONFIG.DEFAULT_MODEL;
    this.timeoutMs = OLLAMA_CONFIG.TIMEOUT_MS;
  }

  /**
   * @param {Object} params
   * @param {string} [params.model]
   * @param {string} params.prompt
   * @param {Object} [params.options] - Ollama-specific generation options (temperature, top_p, etc.)
   * @returns {Promise<{success: boolean, provider: string, model: string, output: string, meta?: object}>}
   */
  async generate({ model, prompt, options = {} }) {
    const targetModel = model || this.defaultModel;

    try {
      const response = await axios.post(
        `${this.baseUrl}${OLLAMA_CONFIG.GENERATE_ENDPOINT}`,
        {
          model: targetModel,
          prompt,
          stream: OLLAMA_CONFIG.STREAM,
          ...options,
        },
        {
          timeout: this.timeoutMs,
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const { response: generatedText, total_duration, eval_count } = response.data;

      if (!generatedText) {
        throw Object.assign(new Error('Ollama returned empty response'), { code: 'EMPTY_RESPONSE' });
      }

      return this._buildResponse({
        success: true,
        output: generatedText.trim(),
        model: targetModel,
        meta: {
          totalDuration: total_duration,
          evalCount: eval_count,
        },
      });
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        return this._buildError(
          Object.assign(new Error('Ollama is not running. Start it with `ollama serve`.'), {
            code: 'CONNECTION_REFUSED',
          }),
          targetModel
        );
      }

      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        return this._buildError(
          Object.assign(new Error(`Ollama request timed out after ${this.timeoutMs}ms.`), {
            code: 'TIMEOUT',
          }),
          targetModel
        );
      }

      if (error.response?.status === 404) {
        return this._buildError(
          Object.assign(new Error(`Model "${targetModel}" not found. Pull it with \`ollama pull ${targetModel}\`.`), {
            code: 'MODEL_NOT_FOUND',
          }),
          targetModel
        );
      }

      return this._buildError(error, targetModel);
    }
  }

  /**
   * Check Ollama health and list available models.
   *
   * @returns {Promise<{available: boolean, models?: string[], error?: string}>}
   */
  async healthCheck() {
    try {
      const response = await axios.get(
        `${this.baseUrl}${OLLAMA_CONFIG.TAGS_ENDPOINT}`,
        { timeout: 5_000 }
      );

      const models = (response.data?.models || []).map((m) => m.name);

      return {
        available: true,
        models,
      };
    } catch (error) {
      return {
        available: false,
        models: [],
        error: error.code === 'ECONNREFUSED'
          ? 'Ollama is not running.'
          : error.message,
      };
    }
  }
}

module.exports = new OllamaService();
