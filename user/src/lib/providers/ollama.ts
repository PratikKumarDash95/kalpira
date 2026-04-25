// Ollama AI Provider Implementation
// Connects to a local Ollama server via its OpenAI-compatible API
// Designed for privacy-first, offline-capable interview AI

import {
    AIProvider,
    buildInterviewSystemPrompt,
    cleanJSON,
    defaultInterviewResponse,
    defaultSynthesisResult,
    defaultAggregateSynthesisResult
} from '../ai';
import {
    buildGreetingPrompt,
    getDefaultGreeting,
    buildSynthesisPrompt,
    buildAggregateSynthesisPrompt
} from '../prompts';
import {
    StudyConfig,
    ParticipantProfile,
    InterviewMessage,
    SynthesisResult,
    BehaviorData,
    AIInterviewResponse,
    QuestionProgress,
    AggregateSynthesisResult,
    DEFAULT_OLLAMA_MODEL
} from '@/types';

export class OllamaProvider implements AIProvider {
    private baseUrl: string;
    private model: string;

    constructor(model?: string, baseUrl?: string) {
        this.baseUrl = baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        this.model = model ||
            process.env.OLLAMA_MODEL ||
            process.env.AI_MODEL ||
            DEFAULT_OLLAMA_MODEL;
    }

    private async chat(messages: { role: string; content: string }[], jsonMode = false): Promise<string> {
        // Local models can take 2+ minutes for CPU inference — set a generous timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 minutes

        try {
            const response = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    messages,
                    stream: false,
                    ...(jsonMode ? { format: 'json' } : {})
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                throw new Error(`Ollama API error (${response.status}): ${errorText}`);
            }

            const data = await response.json();
            return data.message?.content || '';
        } finally {
            clearTimeout(timeout);
        }
    }

    async generateInterviewResponse(
        history: InterviewMessage[],
        studyConfig: StudyConfig,
        participantProfile: ParticipantProfile | null,
        questionProgress: QuestionProgress,
        currentContext: string
    ): Promise<AIInterviewResponse> {
        const systemInstruction = buildInterviewSystemPrompt(
            studyConfig,
            participantProfile,
            questionProgress,
            currentContext
        );

        const jsonInstructions = `\n\nIMPORTANT: You MUST respond with ONLY a valid JSON object in this exact format:
{
  "message": "Your response to the participant",
  "questionAddressed": null,
  "phaseTransition": null,
  "profileUpdates": [],
  "scores": {"technical": 0, "communication": 0, "confidence": 0, "logic": 0, "depth": 0},
  "shouldConclude": false
}

- "message": Your conversational response (string)
- "questionAddressed": 0-based index of core question addressed, or null
- "phaseTransition": One of "background", "core-questions", "exploration", "feedback", "wrap-up", or null
- "profileUpdates": Array of {fieldId, value, status} objects, or empty array
- "scores": Object with 0-100 scores for technical, communication, confidence, logic, depth (or null)
- "shouldConclude": true if interview should end, false otherwise`;

        try {
            const messages = [
                { role: 'system', content: systemInstruction + jsonInstructions },
                ...history.slice(-10).map(h => ({
                    role: h.role === 'ai' ? 'assistant' : 'user',
                    content: h.content
                }))
            ];

            const text = await this.chat(messages, true);
            const parsed = JSON.parse(cleanJSON(text));
            return {
                message: parsed.message || "That's interesting. Could you tell me more?",
                questionAddressed: parsed.questionAddressed ?? null,
                phaseTransition: parsed.phaseTransition ?? null,
                profileUpdates: parsed.profileUpdates || [],
                scores: parsed.scores || null,
                shouldConclude: parsed.shouldConclude || false
            };
        } catch (error) {
            console.error('Ollama interview response error:', error);
            return { ...defaultInterviewResponse, message: `(Ollama Error: ${error instanceof Error ? error.message : String(error)}) I appreciate you sharing that. What else comes to mind?` };
        }
    }

    async getInterviewGreeting(studyConfig: StudyConfig): Promise<string> {
        const prompt = buildGreetingPrompt(studyConfig);

        try {
            const messages = [
                { role: 'user', content: prompt }
            ];
            const text = await this.chat(messages);
            return text.trim() || getDefaultGreeting(studyConfig);
        } catch (error) {
            console.error('Ollama greeting error:', error);
            return getDefaultGreeting(studyConfig);
        }
    }

    async synthesizeInterview(
        history: InterviewMessage[],
        studyConfig: StudyConfig,
        behaviorData: BehaviorData,
        participantProfile: ParticipantProfile | null
    ): Promise<SynthesisResult> {
        const prompt = buildSynthesisPrompt(history, studyConfig, behaviorData, participantProfile);

        const jsonInstructions = `\n\nIMPORTANT: Respond with ONLY a valid JSON object:
{
  "statedPreferences": ["..."],
  "revealedPreferences": ["..."],
  "themes": [{"theme": "...", "evidence": "...", "frequency": 1}],
  "contradictions": ["..."],
  "keyInsights": ["..."],
  "bottomLine": "..."
}`;

        try {
            const messages = [
                { role: 'user', content: prompt + jsonInstructions }
            ];
            const text = await this.chat(messages, true);
            return JSON.parse(cleanJSON(text)) as SynthesisResult;
        } catch (error) {
            console.error('Ollama synthesis error:', error);
            return defaultSynthesisResult;
        }
    }

    async synthesizeAggregate(
        studyConfig: StudyConfig,
        syntheses: SynthesisResult[],
        interviewCount: number
    ) {
        const prompt = buildAggregateSynthesisPrompt(studyConfig, syntheses, interviewCount);

        const jsonInstructions = `\n\nIMPORTANT: Respond with ONLY a valid JSON object:
{
  "commonThemes": [{"theme": "...", "frequency": 1, "representativeQuotes": ["..."]}],
  "divergentViews": [{"topic": "...", "viewA": "...", "viewB": "..."}],
  "keyFindings": ["..."],
  "researchImplications": ["..."],
  "bottomLine": "..."
}`;

        try {
            const messages = [
                { role: 'user', content: prompt + jsonInstructions }
            ];
            const text = await this.chat(messages, true);
            return JSON.parse(cleanJSON(text));
        } catch (error) {
            console.error('Ollama aggregate synthesis error:', error);
            return defaultAggregateSynthesisResult;
        }
    }

    async generateFollowupStudy(
        parentConfig: StudyConfig,
        synthesis: AggregateSynthesisResult
    ): Promise<{ name: string; researchQuestion: string; coreQuestions: string[] }> {
        const prompt = `You are helping design a follow-up research study.

PARENT STUDY: "${parentConfig.name}"
PARENT SUMMARY: ${synthesis.bottomLine}

KEY FINDINGS:
${synthesis.keyFindings.map((f, i) => `${i + 1}. ${f}`).join('\n')}

RESEARCH IMPLICATIONS:
${(synthesis.researchImplications || []).map((r, i) => `${i + 1}. ${r}`).join('\n') || 'None specified'}

DIVERGENT VIEWS:
${(synthesis.divergentViews || []).map(d => `- ${d.topic}: "${d.viewA}" vs "${d.viewB}"`).join('\n') || 'None identified'}

Generate a follow-up study that digs deeper into gaps or tensions found.

IMPORTANT: Respond with ONLY a valid JSON object:
{
  "name": "Follow-up: ...",
  "researchQuestion": "...",
  "coreQuestions": ["..."]
}`;

        try {
            const messages = [
                { role: 'user', content: prompt }
            ];
            const text = await this.chat(messages, true);
            const result = JSON.parse(cleanJSON(text));
            return {
                name: result.name || `Follow-up: ${parentConfig.name}`,
                researchQuestion: result.researchQuestion || synthesis.keyFindings[0] || '',
                coreQuestions: result.coreQuestions || []
            };
        } catch (error) {
            console.error('Ollama follow-up generation error:', error);
            return {
                name: `Follow-up: ${parentConfig.name}`,
                researchQuestion: `What deeper insights emerge from exploring: ${synthesis.keyFindings[0] || 'the findings'}?`,
                coreQuestions: synthesis.keyFindings.slice(0, 3).map(f =>
                    `Can you tell me more about your experience with: ${f}?`
                )
            };
        }
    }
}
