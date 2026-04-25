// ============================================
// AI Constants — Single Source of Truth
// ============================================

const AI_PROVIDERS = Object.freeze({
  OLLAMA: 'ollama',
  GEMINI: 'gemini',
  OPENAI: 'openai',
});

const AI_MODES = Object.freeze({
  OFFLINE: 'offline',
  ONLINE: 'online',
  HYBRID: 'hybrid',
});

const OLLAMA_CONFIG = Object.freeze({
  BASE_URL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  GENERATE_ENDPOINT: '/api/generate',
  TAGS_ENDPOINT: '/api/tags',
  DEFAULT_MODEL: process.env.OLLAMA_DEFAULT_MODEL || 'mistral:7b-instruct-q4_K_M',
  TIMEOUT_MS: 60_000,
  STREAM: false,
});

const GEMINI_CONFIG = Object.freeze({
  BASE_URL: 'https://generativelanguage.googleapis.com/v1beta',
  DEFAULT_MODEL: process.env.GEMINI_DEFAULT_MODEL || 'gemini-pro',
  TIMEOUT_MS: 30_000,
});

const OPENAI_CONFIG = Object.freeze({
  BASE_URL: 'https://api.openai.com/v1',
  DEFAULT_MODEL: process.env.OPENAI_DEFAULT_MODEL || 'gpt-4',
  TIMEOUT_MS: 30_000,
});

const DIFFICULTY_LEVELS = Object.freeze({
  EASY: 'easy',
  MEDIUM: 'medium',
  HARD: 'hard',
});

const RESPONSE_STATUS = Object.freeze({
  SUCCESS: true,
  FAILURE: false,
});

module.exports = {
  AI_PROVIDERS,
  AI_MODES,
  OLLAMA_CONFIG,
  GEMINI_CONFIG,
  OPENAI_CONFIG,
  DIFFICULTY_LEVELS,
  RESPONSE_STATUS,
};
