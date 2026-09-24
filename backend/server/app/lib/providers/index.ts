// AI Provider Factory
// Returns the appropriate provider based on study or environment configuration

import { AIProvider } from '../ai';
import { GeminiProvider } from './gemini';
import { ClaudeProvider } from './claude';
import { OllamaProvider } from './ollama';
import {
  GeminiEmbeddingProvider,
  OllamaEmbeddingProvider,
  UnsupportedEmbeddingProvider,
  NO_EMBEDDING_ENDPOINT,
  type EmbeddingProvider,
} from './embeddings';
import { StudyConfig } from '@/types';
import { isHostedMode } from '../mode';

export type ProviderType = 'gemini' | 'claude' | 'ollama';

// Optional per-request API keys (for hosted/BYOK mode)
export interface AIProviderKeys {
  geminiApiKey?: string | null;
  anthropicApiKey?: string | null;
  ollamaBaseUrl?: string | null;
}

// Pick the default provider when none is explicitly configured.
// When FreeModel (or any Anthropic-compatible proxy) is wired up via
// ANTHROPIC_BASE_URL or FREEMODEL_API_KEY, default to Claude so requests
// flow through that endpoint without needing per-study config.
function getDefaultProvider(): ProviderType {
  if (process.env.AI_PROVIDER) return process.env.AI_PROVIDER as ProviderType;
  if (process.env.ANTHROPIC_BASE_URL || process.env.FREEMODEL_API_KEY) return 'claude';
  return 'gemini';
}

// Get the interview AI provider based on configuration
// Provider priority: studyConfig.aiProvider > getDefaultProvider()
// Model priority: studyConfig.aiModel > env.GEMINI_MODEL/CLAUDE_MODEL/OLLAMA_MODEL > env.AI_MODEL > default
// In hosted mode, pass keys from ResearcherContext; in standalone, keys are null and env vars are used
export function getInterviewProvider(studyConfig?: StudyConfig, keys?: AIProviderKeys): AIProvider {
  const providerType = (studyConfig?.aiProvider as ProviderType) || getDefaultProvider();

  // Pass model from studyConfig (if set) to provider constructor
  const model = studyConfig?.aiModel;

  // In hosted mode, use ONLY researcher-provided keys (no env var fallback)
  // Pass a special sentinel ('') to prevent providers from falling back to env vars
  const hosted = isHostedMode();

  switch (providerType) {
    case 'claude': {
      const key = hosted ? (keys?.anthropicApiKey || '') : (keys?.anthropicApiKey ?? undefined);
      // baseURL is read from env by ClaudeProvider when not passed here
      return new ClaudeProvider(model, key);
    }
    case 'ollama': {
      const baseUrl = keys?.ollamaBaseUrl ?? undefined;
      return new OllamaProvider(model, baseUrl);
    }
    case 'gemini':
    default: {
      const key = hosted ? (keys?.geminiApiKey || '') : (keys?.geminiApiKey ?? undefined);
      return new GeminiProvider(model, key);
    }
  }
}

export { GeminiProvider } from './gemini';
export { ClaudeProvider } from './claude';
export { OllamaProvider } from './ollama';
export {
  GeminiEmbeddingProvider,
  OllamaEmbeddingProvider,
  UnsupportedEmbeddingProvider,
  NO_EMBEDDING_ENDPOINT,
} from './embeddings';
export type { EmbeddingProvider } from './embeddings';

// --------------------------------------------
// The embedding provider
// --------------------------------------------
// Resolution is deliberately NOT "whatever the interview provider is". The two
// capabilities have different providers, and on a Claude deployment the chat provider
// has none at all — so reusing `getInterviewProvider` here would hand back an object
// that cannot embed and make the failure look like a missing feature rather than a
// missing endpoint.
//
// Order:
//   1. EMBEDDING_PROVIDER, when a deployment has stated one.
//   2. Gemini, when a key is configured — the only hosted provider that embeds.
//   3. Ollama, when a base URL is configured — a local deployment embeds locally,
//      which is the point of running one.
//   4. Otherwise a provider that refuses every call with the reason, so the search
//      interface shows why it is empty instead of a bare "no results".
export function getEmbeddingProvider(keys?: AIProviderKeys): EmbeddingProvider {
  const hosted = isHostedMode();
  const explicit = (process.env.EMBEDDING_PROVIDER || '').toLowerCase();

  const geminiKey = keys?.geminiApiKey !== undefined
    ? keys.geminiApiKey
    : process.env.GEMINI_API_KEY;
  const ollamaUrl = keys?.ollamaBaseUrl ?? process.env.OLLAMA_BASE_URL;

  if (explicit === 'ollama' || (!explicit && !geminiKey && ollamaUrl)) {
    return new OllamaEmbeddingProvider(undefined, ollamaUrl ?? undefined);
  }

  if (explicit === 'none') {
    return new UnsupportedEmbeddingProvider('none', NO_EMBEDDING_ENDPOINT);
  }

  if (geminiKey) {
    // In hosted mode the researcher's own key is used and there is no environment to
    // fall back to, so an explicit empty string is passed rather than undefined.
    return new GeminiEmbeddingProvider(undefined, hosted ? (geminiKey || '') : geminiKey);
  }

  return new UnsupportedEmbeddingProvider(getDefaultProvider(), NO_EMBEDDING_ENDPOINT);
}
