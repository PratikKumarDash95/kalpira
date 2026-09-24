// ============================================
// embeddings.ts — the embedding capability, and who has it
// ============================================
// A separate capability from `AIProvider`, not a method on it.
//
// `AIProvider` describes what an interview model can do — hold a conversation,
// synthesise a transcript. Embedding is a different capability, and one the shipped
// providers do not share: Gemini publishes an embeddings endpoint, Ollama can serve
// one locally, and Anthropic publishes none at all. Folding `embedTexts` into
// `AIProvider` would force `ClaudeProvider` to implement a method it cannot honour,
// and the shape of that dishonesty is a stub that returns zero vectors — the exact
// fabrication the rest of this feature exists to prevent. So the capability is
// optional, and a provider that lacks it says so in a way a caller cannot mistake
// for a result.
//
// EVERY CALL RETURNS `Measured`
//
// A failed embed is not an error to be swallowed and retried into a zero. `refused`
// carries the provider's own message, which the index job stores as the row's
// failure reason — so a corpus that half-indexed reports which texts failed and why,
// rather than silently ranking against a vector that means nothing.
//
// THE DIMENSION IS CHECKED, NEVER PADDED
//
// The column is `vector(768)`. A provider that returns 1024 is not almost right:
// truncating it to fit would store a vector that is not the embedding of the text,
// and comparing it against others would produce similarity scores with no meaning
// while looking entirely normal. So a mismatch is refused, and the reason names the
// model, the dimension it returned, and what changing it would require.

import { GoogleGenAI } from '@google/genai';
import { computed, refused } from '../measured';
import type { Measured } from '../measured';
import {
    EMBED_BATCH_SIZE,
    EMBEDDING_DIM,
    EMBEDDING_MODEL,
    OLLAMA_EMBEDDING_DIM,
    OLLAMA_EMBEDDING_MODEL,
} from '../research/contract';

/** The embedding capability. See the note at the top on why it is not on `AIProvider`. */
export interface EmbeddingProvider {
    readonly provider: string;
    readonly model: string;
    /** The dimension every vector from this provider carries. */
    readonly dim: number;
    /** One vector per input text, in the order given. */
    embedTexts(texts: string[]): Promise<Measured<number[][]>>;
}

/** The dimension mismatch refusal, worded once. */
function dimensionRefusal(model: string, got: number, expected: number): string {
    return `the model "${model}" returned ${got}-dimensional vectors and this deployment stores ${expected}. The vectors are not truncated to fit: a truncated embedding is not the embedding of its text, and ranking against one produces similarity scores that look normal and mean nothing. Storing ${got} dimensions needs a migration to change the column, plus a re-embed of the whole corpus.`;
}

/** Trim a batch, and reject one that is not a list of strings. */
function prepareBatch(texts: string[]): Measured<string[]> {
    if (!Array.isArray(texts)) return refused('the batch was not a list of texts');
    const usable = texts.filter((text) => typeof text === 'string' && text.trim().length > 0);
    if (usable.length === 0) return refused('the batch contained no text to embed');
    return computed(usable);
}

/** The per-batch calls a whole list of texts needs, in order. */
export function batchesOf(texts: string[], size: number = EMBED_BATCH_SIZE): string[][] {
    const out: string[][] = [];
    for (let index = 0; index < texts.length; index += size) {
        out.push(texts.slice(index, index + size));
    }
    return out;
}

// --------------------------------------------
// Gemini
// --------------------------------------------

export class GeminiEmbeddingProvider implements EmbeddingProvider {
    readonly provider = 'gemini';
    readonly model: string;
    readonly dim = EMBEDDING_DIM;

    private ai: GoogleGenAI;

    constructor(model?: string, apiKey?: string | null) {
        // `undefined` means "fall back to the environment"; an explicit empty string
        // means hosted mode, where there is no environment to fall back to.
        const key = apiKey !== undefined ? (apiKey || undefined) : process.env.GEMINI_API_KEY;
        if (!key) throw new Error('GEMINI_API_KEY is required for embeddings');
        this.ai = new GoogleGenAI({ apiKey: key });
        this.model = model || process.env.GEMINI_EMBEDDING_MODEL || EMBEDDING_MODEL;
    }

    async embedTexts(texts: string[]): Promise<Measured<number[][]>> {
        const batch = prepareBatch(texts);
        if (batch.state !== 'computed') return batch;

        try {
            const response = await this.ai.models.embedContent({
                model: this.model,
                contents: batch.value,
            });

            const embeddings = response?.embeddings ?? [];
            if (embeddings.length !== batch.value.length) {
                return refused(
                    `the provider returned ${embeddings.length} embeddings for ${batch.value.length} texts, so they cannot be matched to their sources`,
                );
            }

            const vectors: number[][] = [];
            for (const entry of embeddings) {
                const values = entry?.values;
                if (!Array.isArray(values) || values.length !== EMBEDDING_DIM) {
                    return refused(dimensionRefusal(this.model, Array.isArray(values) ? values.length : 0, EMBEDDING_DIM));
                }
                if (!values.every((value) => Number.isFinite(value))) {
                    return refused(`the model "${this.model}" returned a vector containing a value that is not a finite number`);
                }
                vectors.push(values);
            }

            return computed(vectors);
        } catch (error) {
            // The provider's own words, kept verbatim. A quota error and a bad model
            // name need different fixes and must not read the same in a job's error.
            return refused(`the embedding provider failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

// --------------------------------------------
// Ollama
// --------------------------------------------

export class OllamaEmbeddingProvider implements EmbeddingProvider {
    readonly provider = 'ollama';
    readonly model: string;
    readonly dim = OLLAMA_EMBEDDING_DIM;

    private baseUrl: string;

    constructor(model?: string, baseUrl?: string) {
        this.baseUrl = baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        this.model = model || process.env.OLLAMA_EMBEDDING_MODEL || OLLAMA_EMBEDDING_MODEL;
    }

    async embedTexts(texts: string[]): Promise<Measured<number[][]>> {
        const batch = prepareBatch(texts);
        if (batch.state !== 'computed') return batch;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2 * 60 * 1000);

        try {
            const response = await fetch(`${this.baseUrl}/api/embed`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: this.model, input: batch.value }),
                signal: controller.signal,
            });

            if (!response.ok) {
                return refused(`the Ollama server at ${this.baseUrl} answered ${response.status} for model "${this.model}"`);
            }

            const payload: any = await response.json();
            const embeddings = payload?.embeddings;
            if (!Array.isArray(embeddings) || embeddings.length !== batch.value.length) {
                return refused(
                    `the Ollama server returned ${Array.isArray(embeddings) ? embeddings.length : 'no'} embeddings for ${batch.value.length} texts`,
                );
            }

            for (const values of embeddings) {
                if (!Array.isArray(values) || values.length !== OLLAMA_EMBEDDING_DIM) {
                    return refused(dimensionRefusal(this.model, Array.isArray(values) ? values.length : 0, OLLAMA_EMBEDDING_DIM));
                }
            }

            return computed(embeddings as number[][]);
        } catch (error) {
            return refused(
                `the Ollama server at ${this.baseUrl} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
            );
        } finally {
            clearTimeout(timeout);
        }
    }
}

// --------------------------------------------
// The provider that has no embedding endpoint
// --------------------------------------------

/**
 * The provider returned when the deployment is configured for Claude.
 *
 * Anthropic publishes no embeddings endpoint, so there is nothing to call. This is a
 * provider rather than an exception because the caller needs a *reason* to record
 * against the job and show beside the search box; a thrown error at construction
 * would take down routes that have nothing to do with embeddings, and a null would
 * make the caller guess why search is empty. Every call refuses, with the same
 * sentence a reader sees in the interface.
 */
export class UnsupportedEmbeddingProvider implements EmbeddingProvider {
    readonly provider: string;
    readonly model = 'none';
    readonly dim = EMBEDDING_DIM;

    private reason: string;

    constructor(provider: string, reason: string) {
        this.provider = provider;
        this.reason = reason;
    }

    async embedTexts(_texts: string[]): Promise<Measured<number[][]>> {
        return refused(this.reason);
    }
}

/** What a deployment running on Claude is told when it asks for semantic search. */
export const NO_EMBEDDING_ENDPOINT =
    'this deployment uses Claude, and Anthropic publishes no embeddings endpoint. Semantic search and theme clustering need an embedding model — configure a Gemini API key, or point OLLAMA_BASE_URL at a local Ollama server.';
