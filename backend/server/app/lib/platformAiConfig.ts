import { DEFAULT_GEMINI_MODEL, StudyConfig } from '@/types';

// Platform AI config for candidate self-service studies/practices. Candidates no
// longer bring their own API keys — their self-created work runs on the platform's
// configured AI (env keys resolved in researcherContext/providers), exactly like
// the interviewer flow. This strips any client-supplied provider/model so the
// removed key UI can never leave a study pointing at a provider the user can't use.
export const PLATFORM_AI_PROVIDER = 'gemini' as const;
export const PLATFORM_AI_MODEL = DEFAULT_GEMINI_MODEL;

export function withPlatformAiConfig(config: StudyConfig): StudyConfig {
  return {
    ...config,
    aiProvider: PLATFORM_AI_PROVIDER,
    aiModel: PLATFORM_AI_MODEL,
  };
}
