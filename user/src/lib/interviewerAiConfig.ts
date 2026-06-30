import { DEFAULT_GEMINI_MODEL, StudyConfig } from '@/types';

export const INTERVIEWER_AI_PROVIDER = 'gemini' as const;
export const INTERVIEWER_AI_MODEL = DEFAULT_GEMINI_MODEL;

export function withInterviewerAiConfig(config: StudyConfig): StudyConfig {
  return {
    ...config,
    aiProvider: INTERVIEWER_AI_PROVIDER,
    aiModel: INTERVIEWER_AI_MODEL,
    speechToTextEnabled: true,
    textToSpeechEnabled: true,
  };
}
