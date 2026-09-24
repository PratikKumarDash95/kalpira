// ============================================
// embeddingService.ts — writing vectors, and knowing when not to
// ============================================
// Owns every write to `Embedding`. Nothing else in the feature inserts a vector, so
// the idempotency rule has one home.
//
// THE HASH IS WHAT MAKES A RE-INDEX FREE
//
// A source's chunks are hashed before anything is sent to a provider. A chunk whose
// hash matches the row already stored for its position is skipped without a call, so
// sweeping a corpus of a thousand interviews that have not changed costs nothing, and
// the cost of indexing tracks the amount of new text rather than the size of the
// archive. Without this, every sweep re-bills for the whole corpus.
//
// The comparison is by hash AND by position. A chunk whose hash matches a *different*
// index is not the same chunk — text edited at the top of a transcript shifts every
// chunk below it — so a mismatch re-embeds rather than rearranging.
//
// WHAT A FAILURE LOOKS LIKE
//
// A provider that refuses is not an exception here. Every failure is collected with
// its chunk index and the provider's own words, and a run in which nothing at all
// could be embedded returns a refusal carrying the first reason — which is what the
// search interface shows when a deployment has no embedding endpoint. A run that
// partly succeeded returns the counts and the failures, because "173 of 180 chunks
// indexed, 7 refused" is a different fact from "indexing failed" and a reader needs
// to be able to tell them apart.

import { computed, refused } from '../measured';
import type { Measured } from '../measured';
import supabaseDb from '../supabaseDb';
import type { EmbeddingProvider } from '../providers/embeddings';
import { chunkText, contentHash, isBlank } from './chunking';
import { toVectorLiteral } from './vectorMath';
import { EMBED_BATCH_SIZE, type EmbeddingOwnerType } from './contract';

export interface EmbedSourceParams {
    ownerType: EmbeddingOwnerType;
    ownerId: string;
    userId?: string | null;
    studyId?: string | null;
    /** The source text. Chunked here — callers pass text, not chunks. */
    text: string;
    /**
     * Units the caller has already split, used instead of chunking `text`.
     *
     * A transcript is a list of messages, and the unit a search should return is the answer
     * rather than the interview containing it — which is `chunkTranscript`'s job, and it needs
     * the message list, not a string. Rather than let a caller write vectors itself (breaking the
     * rule that every `Embedding` row is written here), the caller passes what it split and this
     * function keeps the hashing, the skipping, the batching and the pruning.
     *
     * The chunk INDEX is the position in this array, so a caller whose splitter changes its
     * boundaries invalidates the stored positions. `contentHash` catches that: the chunk at a
     * given index no longer matches, so it is re-embedded rather than left pointing at text that
     * has moved.
     */
    chunks?: string[] | null;
    provider: EmbeddingProvider;
}

export interface EmbedOutcome {
    ownerType: string;
    ownerId: string;
    model: string;
    dim: number;
    /** Chunks whose vector was written in this run. */
    stored: number;
    /** Chunks whose stored hash already matched, so no call was made. */
    skipped: number;
    /** Chunks whose text was blank and so could not be a unit at all. */
    empty: number;
    /** Chunks the provider refused. */
    failed: number;
    failures: Array<{ chunkIndex: number; reason: string }>;
    /** Rows deleted because the source is now shorter than it was. */
    pruned: number;
}

/**
 * Embed a source's text and store one vector per chunk.
 *
 * Returns a refusal only when nothing could be embedded at all. A partial result is
 * returned as a computed outcome carrying its failures, so a caller can report
 * "indexed 173 of 180" rather than choosing between silence and an error.
 */
export async function embedSource(params: EmbedSourceParams): Promise<Measured<EmbedOutcome>> {
    const { ownerType, ownerId, userId, studyId, provider } = params;
    const model = provider.model;

    if (!ownerId) return refused('the source had no id, so its vectors could not be addressed');

    // A caller that split the source itself passes what it split; otherwise the text is chunked
    // here. Both paths land on the same `chunks` array, and everything below is identical — the
    // hashing, the skip, the batching and the pruning never learn which path produced it.
    const chunks = Array.isArray(params.chunks)
        ? params.chunks.filter((chunk) => typeof chunk === 'string' && !isBlank(chunk))
        : isBlank(params.text ?? '')
          ? []
          : chunkText(params.text);

    if (chunks.length === 0) {
        // Not a failure: text that is blank after normalisation is not a unit of
        // content, and embedding it would create a row that matches nothing.
        return computed({
            ownerType, ownerId, model, dim: provider.dim,
            stored: 0, skipped: 0, empty: 0, failed: 0, failures: [], pruned: 0,
        });
    }

    const hashes = chunks.map((chunk) => contentHash(chunk));

    // Existing rows for this source and model. `where` is equality-only on purpose —
    // see the note in supabaseDb on which operators can be pushed to PostgREST.
    const existing = await supabaseDb.embedding.findMany({ where: { ownerType, ownerId, model } });
    const byIndex = new Map<number, Record<string, any>>();
    for (const row of existing) byIndex.set(Number(row.chunkIndex ?? 0), row);

    const pending: number[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
        const row = byIndex.get(index);
        if (row && row.contentHash === hashes[index]) continue;
        pending.push(index);
    }

    const outcome: EmbedOutcome = {
        ownerType, ownerId, model, dim: provider.dim,
        stored: 0,
        skipped: chunks.length - pending.length,
        empty: 0,
        failed: 0,
        failures: [],
        pruned: 0,
    };

    let firstRefusal: string | null = null;

    for (let start = 0; start < pending.length; start += EMBED_BATCH_SIZE) {
        const indexes = pending.slice(start, start + EMBED_BATCH_SIZE);
        const batch = indexes.map((index) => chunks[index]);

        const result = await provider.embedTexts(batch);
        if (result.state !== 'computed') {
            if (firstRefusal === null) firstRefusal = result.reason;
            outcome.failed += batch.length;
            for (const index of indexes) outcome.failures.push({ chunkIndex: index, reason: result.reason });
            continue;
        }

        for (let offset = 0; offset < batch.length; offset += 1) {
            const index = indexes[offset];
            const literal = toVectorLiteral(result.value[offset]);
            if (literal.state !== 'computed') {
                outcome.failed += 1;
                outcome.failures.push({ chunkIndex: index, reason: literal.reason });
                continue;
            }

            const payload = {
                ownerType,
                ownerId,
                chunkIndex: index,
                userId: userId ?? null,
                studyId: studyId ?? null,
                contentHash: hashes[index],
                model,
                dim: result.value[offset].length,
                vector: literal.value,
            };

            const row = byIndex.get(index);
            if (row) {
                await supabaseDb.embedding.update({ where: { id: row.id }, data: { ...payload, updatedAt: new Date().toISOString() } });
            } else {
                await supabaseDb.embedding.create({ data: payload });
            }
            outcome.stored += 1;
        }
    }

    // A source that shrank leaves orphaned chunks at higher indices. They are
    // deleted rather than left: a stale vector for text that no longer exists would
    // keep surfacing in search results as a passage a reader cannot find in the
    // transcript they are sent to.
    for (const [index, row] of byIndex) {
        if (index >= chunks.length) {
            await supabaseDb.embedding.delete({ where: { id: row.id } });
            outcome.pruned += 1;
        }
    }

    if (outcome.stored === 0 && outcome.skipped === 0 && firstRefusal !== null) {
        return refused(firstRefusal);
    }

    return computed(outcome);
}

/**
 * Embed the text of one theme label.
 *
 * Separate from `embedSource` because a theme has no chunks — a label is one short
 * unit — and because its failure has a different consequence: an unembedded theme
 * cannot join a cluster, so it stays unclustered and is reported as such rather than
 * being attached to the nearest cluster by a vector that does not exist.
 */
export async function embedLabel(params: {
    ownerType: EmbeddingOwnerType;
    ownerId: string;
    studyId?: string | null;
    label: string;
    provider: EmbeddingProvider;
}): Promise<Measured<{ vector: number[]; hash: string }>> {
    const text = (params.label ?? '').trim();
    if (isBlank(text)) return refused('the label was empty, so there was nothing to embed');

    const result = await params.provider.embedTexts([text]);
    if (result.state !== 'computed') return result;

    const vector = result.value[0];
    if (!Array.isArray(vector) || vector.length === 0) {
        return refused('the provider returned no vector for the label');
    }

    return computed({ vector, hash: contentHash(text) });
}

/** Every stored vector for a source, as literals keyed by chunk index. */
export async function vectorsFor(ownerType: string, ownerId: string, model: string): Promise<Array<Record<string, any>>> {
    return supabaseDb.embedding.findMany({ where: { ownerType, ownerId, model } });
}

/** How many vectors exist for a model — the corpus size the index view reports. */
export async function countEmbeddings(model: string): Promise<number> {
    return supabaseDb.embedding.count({ where: { model } });
}
