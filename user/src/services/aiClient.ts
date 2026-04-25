// ============================================
// AI API Client — Frontend → Express Backend
// ============================================
// Usage from any React component:
//
//   import { aiClient } from '@/services/aiClient';
//   const result = await aiClient.askInterview({ role, difficulty });
//   const health = await aiClient.checkHealth();
// ============================================

const AI_BACKEND_URL = process.env.NEXT_PUBLIC_AI_BACKEND_URL || 'http://localhost:3001';

interface AIResponse {
    success: boolean;
    provider: 'ollama' | 'gemini' | 'openai' | 'ai-router' | 'server';
    model: string;
    output: string | null;
    meta?: {
        error?: string;
        code?: string;
        totalDuration?: number;
        evalCount?: number;
        attempts?: Array<{ provider: string; error: string }>;
    };
}

interface HealthResponse {
    status: 'ok' | 'degraded' | 'down' | 'error';
    providers: Record<string, {
        available: boolean;
        models?: string[];
        error?: string;
    }>;
    timestamp: string;
}

interface OllamaHealthResponse {
    ollamaRunning: boolean;
    availableModels: string[];
    error: string | null;
}

interface AskParams {
    mode?: 'offline' | 'online' | 'hybrid';
    role: string;
    difficulty: 'easy' | 'medium' | 'hard';
    userContext?: string;
    weakSkills?: string[];
    previousMistakes?: string[];
    model?: string;
}

interface EvaluateParams {
    mode?: 'offline' | 'online' | 'hybrid';
    role: string;
    question: string;
    answer: string;
    model?: string;
}

async function _fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${AI_BACKEND_URL}${path}`;

    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });

    if (!response.ok && response.status >= 500) {
        throw new Error(`AI Backend error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
}

export const aiClient = {
    /**
     * Generate interview question/follow-up via AI.
     */
    async askInterview(params: AskParams): Promise<AIResponse> {
        return _fetch<AIResponse>('/api/interview/ask', {
            method: 'POST',
            body: JSON.stringify(params),
        });
    },

    /**
     * Evaluate a candidate's answer via AI.
     */
    async evaluateAnswer(params: EvaluateParams): Promise<AIResponse> {
        return _fetch<AIResponse>('/api/interview/evaluate', {
            method: 'POST',
            body: JSON.stringify(params),
        });
    },

    /**
     * Full health check across all AI providers.
     */
    async checkHealth(): Promise<HealthResponse> {
        return _fetch<HealthResponse>('/api/ai/health');
    },

    /**
     * Ollama-specific health check.
     */
    async checkOllamaHealth(): Promise<OllamaHealthResponse> {
        return _fetch<OllamaHealthResponse>('/api/ai/health/ollama');
    },

    /**
     * Simple ping to check if the backend is running.
     */
    async ping(): Promise<{ status: string; uptime: number; timestamp: string }> {
        return _fetch('/api/ping');
    },
};
