// AI Provider Factory
// Returns the appropriate provider based on study or environment configuration

import { AIProvider } from '../ai';
import { GeminiProvider } from './gemini';
import { ClaudeProvider } from './claude';
import { OllamaProvider } from './ollama';
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
