// Client-side service that calls API routes
// API keys are kept server-side - this file runs in the browser

import {
  StudyConfig,
  ParticipantProfile,
  InterviewMessage,
  SynthesisResult,
  BehaviorData,
  AIInterviewResponse,
  QuestionProgress
} from '@/types';

// Helper to build headers with optional auth token
const buildHeaders = (participantToken?: string | null): HeadersInit => {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (participantToken) {
    headers['Authorization'] = `Bearer ${participantToken}`;
  }
  return headers;
};

// Generate AI interviewer response
export const generateInterviewResponse = async (
  history: InterviewMessage[],
  studyConfig: StudyConfig,
  participantProfile: ParticipantProfile | null,
  questionProgress: QuestionProgress,
  currentContext: string,
  participantToken?: string | null
): Promise<AIInterviewResponse> => {
  try {
    const response = await fetch('/api/interview', {
      method: 'POST',
      headers: buildHeaders(participantToken),
      body: JSON.stringify({
        history,
        studyConfig,
        participantProfile,
        questionProgress,
        currentContext
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error generating interview response:', error);
    return {
      message: `(Client Error: ${error instanceof Error ? error.message : String(error)}) I appreciate you sharing that. What else comes to mind?`,
      questionAddressed: null,
      phaseTransition: null,
      profileUpdates: [],
      shouldConclude: false
    };
  }
};

// Get initial interview greeting
export const getInterviewGreeting = async (
  studyConfig: StudyConfig,
  participantToken?: string | null
): Promise<string> => {
  try {
    const response = await fetch('/api/greeting', {
      method: 'POST',
      headers: buildHeaders(participantToken),
      body: JSON.stringify({ studyConfig })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.greeting;
  } catch (error) {
    console.error('Error getting interview greeting:', error);
    return `Thank you for participating in this study! I'm excited to learn from your experiences. We'll explore about ${studyConfig.coreQuestions.length} questions together. To get started, could you share a bit about yourself and your background?`;
  }
};

// Synthesize interview patterns
export const synthesizeInterview = async (
  history: InterviewMessage[],
  studyConfig: StudyConfig,
  behaviorData: BehaviorData,
  participantProfile: ParticipantProfile | null,
  participantToken?: string | null
): Promise<SynthesisResult> => {
  try {
    const response = await fetch('/api/synthesis', {
      method: 'POST',
      headers: buildHeaders(participantToken),
      body: JSON.stringify({
        history,
        studyConfig,
        behaviorData,
        participantProfile
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error synthesizing interview:', error);
    return {
      statedPreferences: [],
      revealedPreferences: [],
      themes: [],
      contradictions: [],
      keyInsights: ['Analysis pending...'],
      bottomLine: 'Interview synthesis in progress.'
    };
  }
};

// Generate participant link
export const generateParticipantLink = async (
  studyConfig: StudyConfig
): Promise<{ token: string; url: string }> => {
  try {
    const response = await fetch('/api/generate-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studyConfig })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error generating participant link:', error);
    throw error;
  }
};

// Verify participant token
export const verifyParticipantToken = async (
  token: string
): Promise<{ valid: boolean; data?: StudyConfig }> => {
  try {
    const response = await fetch(`/api/generate-link?token=${encodeURIComponent(token)}`);
    return await response.json();
  } catch (error) {
    console.error('Error verifying token:', error);
    return { valid: false };
  }
};
