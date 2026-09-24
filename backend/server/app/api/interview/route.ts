// POST /api/interview - Generate AI interview response
// Server-side only - API keys never sent to client
// Requires valid participant token to prevent quota abuse

import { NextResponse } from 'next/server';
import { getInterviewProvider } from '@/lib/providers';
import { getParticipantRequestContext } from '@/lib/researcherContext';
import {
  StudyConfig,
  ParticipantProfile,
  InterviewMessage,
  QuestionProgress,
  AIInterviewResponse
} from '@/types';
import { withInterviewerAiConfig } from '@/lib/interviewerAiConfig';
import { withPlatformAiConfig } from '@/lib/platformAiConfig';
import {
  appendScoredDecision,
  hashInput,
  readScoreSet,
  redactOutput,
} from '@/lib/fairness/decisionLog';
import { INTERVIEW_PROMPT_VERSION } from '@/lib/prompts';

// Payload size limits to prevent abuse
const MAX_HISTORY_MESSAGES = 100;
const MAX_CONTEXT_LENGTH = 10000;
const MAX_MESSAGE_LENGTH = 5000;

const unavailableResponse = (message: string): AIInterviewResponse => ({
  message,
  questionAddressed: null,
  phaseTransition: null,
  profileUpdates: [],
  shouldConclude: false,
  errorCode: 'provider_unavailable',
});

const providerSetupMessage = (studyConfig: StudyConfig): string => {
  if (studyConfig.aiProvider === 'claude') {
    return 'The AI interviewer is not configured yet. Please add an Anthropic API key in Settings, then try again.';
  }

  if (studyConfig.aiProvider === 'ollama') {
    return 'The AI interviewer is not configured yet. Please make sure Ollama is running and the selected model is available, then try again.';
  }

  return 'The AI interviewer is not configured yet. Please add a Gemini API key in Settings, then try again.';
};

export async function POST(request: Request) {
  try {
    // Verify participant token and resolve researcher context
    const { valid, context, studyId, isAdmin, error } = await getParticipantRequestContext(request);
    if (!valid || !context) {
      return NextResponse.json(
        { error: error || 'Valid participant token required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    let {
      history,
      studyConfig,
      participantProfile,
      questionProgress,
      currentContext
    } = body as {
      history: InterviewMessage[];
      studyConfig: StudyConfig;
      participantProfile: ParticipantProfile | null;
      questionProgress: QuestionProgress;
      currentContext: string;
    };

    // Validate required fields
    if (!history || !studyConfig || !questionProgress) {
      return NextResponse.json(
        { error: 'Missing required fields: history, studyConfig, questionProgress' },
        { status: 400 }
      );
    }

    // Apply payload size limits
    history = history.slice(-MAX_HISTORY_MESSAGES).map(msg => ({
      ...msg,
      content: msg.content?.slice(0, MAX_MESSAGE_LENGTH) || ''
    }));
    currentContext = (currentContext || '').slice(0, MAX_CONTEXT_LENGTH);
    if (participantProfile?.rawContext) {
      participantProfile = {
        ...participantProfile,
        rawContext: participantProfile.rawContext.slice(0, MAX_CONTEXT_LENGTH)
      };
    }

    // Verify token's studyId matches the requested study (prevents token reuse across studies)
    // Skip for admin users (researchers previewing their studies)
    if (!isAdmin && studyId && studyConfig.id && studyId !== studyConfig.id) {
      return NextResponse.json(
        { error: 'Token not valid for this study' },
        { status: 403 }
      );
    }

    // The request body must never choose the AI provider or model: force a
    // server-controlled config on EVERY path. Persisted studies (and assignment
    // links) use the interviewer config; practice/self-service studies use the
    // platform config. Practice ids are `study-…`, which used to fall through
    // here with the client's aiProvider/aiModel untouched.
    if (studyConfig.interviewerAssignment || (studyConfig.id && !studyConfig.id.startsWith('study-'))) {
      studyConfig = withInterviewerAiConfig(studyConfig);
    } else {
      studyConfig = withPlatformAiConfig(studyConfig);
    }

    // Get the configured AI provider with researcher's API keys
    let provider;
    try {
      provider = getInterviewProvider(studyConfig, {
        geminiApiKey: context.geminiApiKey,
        anthropicApiKey: context.anthropicApiKey,
        ollamaBaseUrl: process.env.OLLAMA_BASE_URL || null,
      });
    } catch (providerError) {
      console.error('Interview provider configuration error:', providerError);
      return NextResponse.json(unavailableResponse(providerSetupMessage(studyConfig)));
    }

    // Generate response using the provider
    const result = await provider.generateInterviewResponse(
      history,
      studyConfig,
      participantProfile,
      questionProgress,
      currentContext
    );

    // ── Feature 4: record the decision, before anyone can profit from claiming it ──
    //
    // This is the moment a score comes into existence, and the only moment at which its
    // provenance is known first-hand. Everything downstream — the browser, the save
    // handler, the audit — trusts THIS row and not the request body, which is why it is
    // written here rather than reconstructed later from whatever the client chooses to
    // send.
    //
    // Written even when the model returned no scores, so that a later link can tell "the
    // model was asked and produced none" from "nothing was ever recorded". It is skipped
    // only when the provider reported a failure, since a crashed call is not a decision.
    //
    // `appendScoredDecision` never throws: a database problem must not fail an interview
    // in progress. It returns a null id instead, and the client then forwards null, which
    // labels the answer's scores 'unverified' rather than pretending they were traced.
    let decisionId: string | null = null;
    if (!result.errorCode) {
      const read = readScoreSet(result.scores);
      const identity = provider.describeModel?.() ?? {
        provider: studyConfig.aiProvider ?? null,
        model: studyConfig.aiModel ?? null,
      };

      const logged = await appendScoredDecision({
        studyId: studyConfig.id ?? null,
        userId: context.userId ?? null,
        provider: identity.provider,
        modelId: identity.model,
        inputHash: hashInput({
          studyId: studyConfig.id ?? null,
          promptVersion: INTERVIEW_PROMPT_VERSION,
          messages: history.map((message) => ({ role: message.role, content: message.content })),
        }),
        // The redacted structure, never the raw response: the log must not become a second
        // copy of the candidate's own words. See `redactOutput`.
        output: redactOutput(result),
        scores: read.state === 'measured' ? read.scores : null,
      });
      decisionId = logged.decisionId;
    }

    return NextResponse.json({ ...result, decisionId });
  } catch (error) {
    console.error('Interview API error:', error);
    return NextResponse.json(
      { error: 'Failed to generate interview response' },
      { status: 500 }
    );
  }
}
