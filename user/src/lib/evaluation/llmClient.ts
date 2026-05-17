// ============================================
// llmClient.ts — Abstracted LLM Caller
// Part of the Unified Scoring Engine
// Clean interface for calling any LLM provider
// Uses real provider integrations only.
// ============================================

/**
 * Configuration for the LLM client.
 * Extensible for future provider-specific settings.
 */
export interface LLMClientConfig {
    /** The AI provider to use */
    provider: 'gemini' | 'anthropic';
    /** API key for the provider */
    apiKey?: string;
    /** Model identifier override */
    model?: string;
    /** Maximum tokens for the response */
    maxTokens?: number;
    /** Temperature for response generation (0 = deterministic, 1 = creative) */
    temperature?: number;
}

/**
 * Result from an LLM call.
 */
export interface LLMCallResult {
    /** Whether the call succeeded */
    success: boolean;
    /** The raw text response from the LLM */
    content: string;
    /** Error message if the call failed */
    error?: string;
    /** Token usage metadata */
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

// ============================================
// Default configuration
// ============================================

const DEFAULT_CONFIG: LLMClientConfig = {
    provider: 'gemini',
    maxTokens: 2048,
    temperature: 0.2,
};

// ============================================
// Main LLM caller
// ============================================

/**
 * Calls the configured LLM with the given prompt and returns the raw text response.
 *
 * This function is the single point of integration with LLM providers.
 * To switch providers, modify only this function.
 *
 * @param prompt - The full evaluation prompt
 * @param config - Optional configuration override
 * @returns LLMCallResult with the raw response text
 */
export async function callLLM(
    prompt: string,
    config?: Partial<LLMClientConfig>
): Promise<LLMCallResult> {
    const finalConfig: LLMClientConfig = { ...DEFAULT_CONFIG, ...config };

    try {
        switch (finalConfig.provider) {
            case 'gemini':
                return await callGemini(prompt, finalConfig);

            case 'anthropic':
                return await callAnthropic(prompt, finalConfig);

            default:
                return {
                    success: false,
                    content: '',
                    error: `Unsupported LLM provider: ${finalConfig.provider}`,
                };
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown LLM error';
        console.error(`[LLMClient] Call failed (provider: ${finalConfig.provider}):`, message);
        return {
            success: false,
            content: '',
            error: `LLM call failed: ${message}`,
        };
    }
}

// ============================================
// Provider implementations
// ============================================

/**
 * Gemini provider — uses @google/genai SDK.
 * Activated when provider is 'gemini' and apiKey is set.
 */
async function callGemini(prompt: string, config: LLMClientConfig): Promise<LLMCallResult> {
    if (!config.apiKey) {
        return { success: false, content: '', error: 'Gemini API key not provided' };
    }

    try {
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey: config.apiKey });

        const response = await ai.models.generateContent({
            model: config.model || 'gemini-2.5-flash',
            contents: prompt,
            config: {
                temperature: config.temperature ?? 0.2,
                maxOutputTokens: config.maxTokens ?? 2048,
                responseMimeType: 'application/json',
            },
        });

        const text = response.text ?? '';

        if (!text) {
            return { success: false, content: '', error: 'Gemini returned empty response' };
        }

        return {
            success: true,
            content: text,
            usage: {
                promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
                completionTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
                totalTokens: response.usageMetadata?.totalTokenCount ?? 0,
            },
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown Gemini error';
        return { success: false, content: '', error: `Gemini call failed: ${message}` };
    }
}

/**
 * Anthropic/Claude provider — uses @anthropic-ai/sdk.
 * Activated when provider is 'anthropic' and apiKey is set.
 */
async function callAnthropic(prompt: string, config: LLMClientConfig): Promise<LLMCallResult> {
    if (!config.apiKey) {
        return { success: false, content: '', error: 'Anthropic API key not provided' };
    }

    try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const client = new Anthropic({ apiKey: config.apiKey });

        const response = await client.messages.create({
            model: config.model || 'claude-sonnet-4-5-20250514',
            max_tokens: config.maxTokens ?? 2048,
            temperature: config.temperature ?? 0.2,
            messages: [
                {
                    role: 'user',
                    content: prompt,
                },
            ],
        });

        const textBlock = response.content.find((block) => block.type === 'text');
        const text = textBlock && 'text' in textBlock ? textBlock.text : '';

        if (!text) {
            return { success: false, content: '', error: 'Anthropic returned empty response' };
        }

        return {
            success: true,
            content: text,
            usage: {
                promptTokens: response.usage.input_tokens,
                completionTokens: response.usage.output_tokens,
                totalTokens: response.usage.input_tokens + response.usage.output_tokens,
            },
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown Anthropic error';
        return { success: false, content: '', error: `Anthropic call failed: ${message}` };
    }
}
