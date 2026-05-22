// ============================================
// FreeModel Service — Cloud AI Provider
// ============================================

const axios = require('axios');
const BaseAIService = require('./BaseAIService');
const { AI_PROVIDERS, FREEMODEL_CONFIG } = require('../../constants');

class FreeModelService extends BaseAIService {
  constructor() {
    super(AI_PROVIDERS.FREEMODEL);
    this.baseUrl = FREEMODEL_CONFIG.BASE_URL;
    this.defaultModel = FREEMODEL_CONFIG.DEFAULT_MODEL;
    this.timeoutMs = FREEMODEL_CONFIG.TIMEOUT_MS;
    this.apiKey = process.env.FREEMODEL_API_KEY || null;
  }

  async generate({ model, prompt, options = {} }) {
    const targetModel = model || this.defaultModel;

    if (!this.apiKey) {
      return this._buildError(
        Object.assign(new Error('FreeModel API key not configured. Set FREEMODEL_API_KEY environment variable.'), {
          code: 'API_KEY_MISSING',
        }),
        targetModel
      );
    }

    try {
      // Default FreeModel request shape — adjust if your provider differs
      const url = `${this.baseUrl.replace(/\/$/, '')}/v1/generate`;
      const payload = {
        model: targetModel,
        prompt: prompt,
        ...options,
      };

      const resp = await axios.post(url, payload, {
        timeout: this.timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      // Attempt to normalize common response shapes
      const data = resp.data || {};
      let output = null;

      if (typeof data.output === 'string') output = data.output;
      else if (data.choices && data.choices[0] && data.choices[0].text) output = data.choices[0].text;
      else if (data.choices && data.choices[0] && data.choices[0].message) {
        const msg = data.choices[0].message;
        output = typeof msg === 'string' ? msg : (msg.content || null);
      }
      else if (data.result && typeof data.result === 'string') output = data.result;

      if (!output || typeof output !== 'string' || !output.trim()) {
        return this._buildError(
          Object.assign(new Error('FreeModel returned an empty or unrecognized response.'), {
            code: 'EMPTY_RESPONSE',
          }),
          targetModel
        );
      }

      return {
        success: true,
        provider: this.providerName,
        model: targetModel,
        output,
        meta: { raw: data },
      };
    } catch (err) {
      return this._buildError(err, targetModel);
    }
  }

  async healthCheck() {
    if (!this.apiKey) {
      return {
        available: false,
        models: [],
        error: 'FreeModel API key not configured.',
      };
    }

    try {
      const url = `${this.baseUrl.replace(/\/$/, '')}/v1/models`;
      await axios.get(url, {
        timeout: 5000,
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return {
        available: true,
        models: [this.defaultModel],
      };
    } catch (err) {
      return {
        available: false,
        models: [],
        error: err.message || 'FreeModel endpoint unreachable.',
      };
    }
  }
}

module.exports = new FreeModelService();
