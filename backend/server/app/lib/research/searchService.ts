// ============================================
// searchService.ts — semantic search, and saying which path served it
// ============================================
// The read half of the corpus. `embeddingService` writes vectors; this ranks them.
//
// WHERE THE RANKING HAPPENS, AND WHY IT IS NOT AN IMPLEMENTATION DETAIL
//
// `order by vector <=> $1` is the one query PostgREST's syntax cannot express, so the ranking
// lives in the SQL function `match_embeddings`, reached through `$rpc`. That is the path a
// deployment wants: the HNSW index is eligible, so Postgres returns the nearest rows without
// scanning the table.
//
// But `$rpc` THROWS when the function is absent — an unapplied migration, an older database, a
// role without execute — and a search box that returns a 500 in that state is worse than one
// that returns the right answer slowly. So there is a fallback: read the candidate vectors and
// rank them in JavaScript with `rankBySimilarity`. `vectorMath.ts` is written so the two agree
// exactly — the same arithmetic, the same refusals — and the outcome says which path ran.
//
// IT SAYS SO BECAUSE THE TWO ARE NOT EQUIVALENT
//
// The results are equivalent. The costs are not: the fallback reads and parses every candidate
// vector, so a corpus of a hundred thousand chunks becomes a hundred thousand parses per query.
// A caller that cannot tell the two apart cannot tell a healthy deployment from one running
// without its index, and would not know to apply the migration. `ranking` and `rankingNote`
// exist so the interface can say it out loud instead of being quietly slow.
//
// THE TIE-BREAK IS THE ONE PLACE THEY GENUINELY DIFFER
//
// `rankBySimilarity` breaks a tie on id, ascending, so the same query returns the same order
// every day. Postgres orders by distance alone and leaves ties to the plan. Two chunks at an
// identical similarity — which happens at the similarity floor, where unrelated passages pile
// up — may therefore order differently between the index path and the fallback. That is
// disclosed rather than papered over, because a result list that reshuffles between reads looks
// like the corpus changed.
//
// WHY THE QUERY IS NOT EMBEDDED THROUGH `embedLabel`
//
// `embedLabel` was the obvious call and it is the wrong one. Its name and its parameters say "a
// theme label, about to be stored" — `ownerType`, `ownerId`, `studyId` — and a search phrase is
// none of those things. It writes nothing today, so the lie would be inert; it would stop being
// inert the day someone gives `embedLabel` the store it looks like it has, and a user's search
// phrase would be persisted as a theme in whichever study happened to be in scope. The provider
// call is made directly here instead, with the same refusals.
//
// A DIMENSION MISMATCH IS A REFUSAL, NEVER A TRUNCATION
//
// `vectorMath.cosineSimilarity` refuses two vectors of unequal length rather than comparing a
// prefix, and `match_embeddings` takes a `vector(768)`. A query vector of any other length would
// either be rejected by Postgres or quietly compared against a prefix of every stored vector, so
// it is refused here with the model, the dimension it produced, and what changing it would cost.

import supabaseDb from '../supabaseDb';
import { computed, refused, present } from '../measured';
import type { Measured } from '../measured';
import type { EmbeddingProvider } from '../providers/embeddings';
import { chunkText, chunkTranscript, contentHash, isBlank } from './chunking';
import { synthesisText } from './themeService';
import {
    countUnusable,
    isUsableVector,
    parseVector,
    rankBySimilarity,
    toVectorLiteral,
    type Rankable,
} from './vectorMath';
import {
    DEFAULT_MATCH_COUNT,
    EMBEDDING_DIM,
    MAX_MATCH_COUNT,
    MIN_SIMILARITY,
    SEARCH_CAVEATS,
} from './contract';

/** Which path produced the ordering. Disclosed on every response. */
export type RankingPath = 'index' | 'fallback';

/** Where a hit came from. Always present — a passage without its source is not evidence. */
export interface SourceRef {
    ownerType: string;
    ownerId: string;
    chunkIndex: number;
    studyId: string | null;
    userId: string | null;
}

export interface SearchHit {
    id: string;
    /** Cosine similarity in [-1, 1]. Higher is closer. */
    similarity: number;
    /** The text that was ranked, when it could be re-derived from the source and verified. */
    excerpt: string | null;
    /** Why there is no excerpt. Null when there is one. */
    excerptReason: string | null;
    /**
     * True when the re-derived chunk's hash matches the hash stored beside the vector.
     *
     * False means the source has changed since it was indexed: the text the rank was computed
     * from is no longer in the source, so no excerpt is shown. Presenting the current text as
     * the ranked passage would be a fabricated quotation.
     */
    verified: boolean;
    source: SourceRef;
}

export interface SearchOutcome {
    query: string;
    model: string;
    dim: number;
    ranking: RankingPath;
    /** One sentence a caller can render verbatim, naming what served the ordering. */
    rankingNote: string;
    requested: number;
    returned: number;
    /** Candidate vectors the ranking considered, across every owner type searched. */
    considered: number;
    /**
     * Results removed by the similarity floor, or why the number is not known.
     *
     * Null on the index path, and the reason says why rather than leaving a zero: the SQL
     * function returns its nearest rows and nothing about the ones it did not return, so how
     * many fell below the floor is not observable from it. A zero here would read as "nothing
     * was filtered", which is a different claim.
     */
    belowFloor: { value: number | null; notComputableReason: string | null };
    /**
     * Candidates that could not be compared at all.
     *
     * Measurable on both paths, by different means: the fallback counts vectors it refused to
     * score, and the index path counts rows whose similarity came back non-finite — which is
     * what a zero vector produces under `<=>`, since the angle is undefined.
     */
    unusable: number;
    hits: SearchHit[];
    caveats: string[];
}

export interface SearchParams {
    query: string;
    provider: EmbeddingProvider;
    /** Narrow to these owner types. Omitted, every type is searched. */
    ownerTypes?: string[] | null;
    studyId?: string | null;
    userId?: string | null;
    matchCount?: number;
    minSimilarity?: number;
}

// --------------------------------------------
// The query vector
// --------------------------------------------

/** Embed one search phrase, or say why it could not be. */
async function embedQuery(query: string, provider: EmbeddingProvider): Promise<Measured<number[]>> {
    const text = (query ?? '').trim();
    if (isBlank(text)) {
        return refused('the search was empty, so there was nothing to look for');
    }

    const result = await provider.embedTexts([text]);
    if (result.state !== 'computed') return result;

    const vector = result.value?.[0];
    if (!Array.isArray(vector) || vector.length === 0) {
        return refused(`the model "${provider.model}" returned no vector for the search text`);
    }
    if (vector.length !== provider.dim || vector.length !== EMBEDDING_DIM) {
        return refused(
            `the model "${provider.model}" returned a ${vector.length}-dimensional vector, and this deployment stores ${EMBEDDING_DIM}. The vector is not truncated to fit: ranking a truncated embedding against the corpus produces similarities that look normal and mean nothing. Storing ${vector.length} dimensions needs a migration to change the column, plus a re-embed of everything already indexed.`,
        );
    }
    if (!isUsableVector(vector)) {
        return refused('the model returned a vector with no direction, which cannot be compared with anything');
    }

    return computed(vector);
}

// --------------------------------------------
// Ranking: the index
// --------------------------------------------

/** A row as `match_embeddings` returns it. */
interface MatchRow {
    id: string;
    ownerType: string;
    ownerId: string;
    chunkIndex: number;
    studyId: string | null;
    userId: string | null;
    similarity: number;
    contentHash: string | null;
}

/**
 * Ask Postgres for the nearest chunks, or say why it could not.
 *
 * One call per owner type: the function takes a single `filter_owner_type`, and a caller asking
 * for two types would otherwise have to search everything and discard half the rows. Taking each
 * type's own top-K and merging them is exact — the global top-K must be a subset of the union of
 * the per-type top-K — so searching type by type costs extra round trips and loses nothing.
 *
 * A `null` owner type searches every type in one call, which is the cheaper shape when the
 * caller has no opinion about where a match should come from.
 *
 * A row whose similarity is not a finite number is counted and dropped rather than returned. The
 * column is `vector(768)`, so a dimension mismatch cannot reach here, but the zero vector can:
 * `<=>` on it divides by a zero magnitude, and the resulting NaN sorts arbitrarily under a plain
 * `order by`. Returning it would put an unranked row in a ranked list.
 */
async function rankThroughIndex(
    vector: number[],
    params: { ownerTypes: string[] | null; studyId: string | null; userId: string | null; model: string; matchCount: number },
): Promise<{ rows: MatchRow[]; unusable: number }> {
    const literal = toVectorLiteral(vector);
    if (literal.state !== 'computed') throw new Error(literal.reason);

    const ownerTypes = params.ownerTypes ?? [null];

    const collected: MatchRow[] = [];
    let unusable = 0;

    for (const ownerType of ownerTypes) {
        const rows = await supabaseDb.$rpc('match_embeddings', {
            query_vector: literal.value,
            match_count: params.matchCount,
            filter_owner_type: ownerType,
            filter_study_id: params.studyId,
            filter_user_id: params.userId,
            filter_model: params.model,
        });

        for (const row of Array.isArray(rows) ? rows : []) {
            const similarity = Number(row?.similarity);
            if (!Number.isFinite(similarity)) {
                unusable += 1;
                continue;
            }
            collected.push({
                id: String(row.id),
                ownerType: String(row.ownerType ?? ''),
                ownerId: String(row.ownerId ?? ''),
                chunkIndex: Number(row.chunkIndex ?? 0),
                studyId: row.studyId ? String(row.studyId) : null,
                userId: row.userId ? String(row.userId) : null,
                similarity,
                contentHash: row.contentHash ? String(row.contentHash) : null,
            });
        }
    }

    return { rows: collected, unusable };
}

/**
 * Merge per-type index results and apply the floor.
 *
 * The tie-break by id is applied here too. The SQL cannot express it — Postgres ordered by
 * distance alone — so the ordering within a tie on the index path is this function's, and a
 * reader comparing the two paths sees the disclosure in `rankingNote` rather than a difference
 * they have to discover.
 */
function orderMatches(rows: MatchRow[], options: { minSimilarity: number; limit: number }): MatchRow[] {
    return rows
        .filter((row) => row.similarity >= options.minSimilarity)
        .sort((left, right) => {
            if (right.similarity !== left.similarity) return right.similarity - left.similarity;
            return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
        })
        .slice(0, options.limit);
}

// --------------------------------------------
// Ranking: the fallback
// --------------------------------------------

/**
 * Rank in JavaScript, reading every candidate vector.
 *
 * The filters that this shim can push to PostgREST are equality on a single value, so an
 * owner-type list is applied after the read — the same situation `embeddingService` documents for
 * its hash lookups. `model` is always pushed, because ranking vectors from two models against
 * one query vector would compare incomparable spaces and produce plausible numbers.
 */
async function rankInJavaScript(
    vector: number[],
    params: { ownerTypes: string[] | null; studyId: string | null; userId: string | null; model: string; matchCount: number; minSimilarity: number },
): Promise<{ hits: MatchRow[]; considered: number; unusable: number; belowFloor: number }> {
    const where: Record<string, unknown> = { model: params.model };
    if (params.ownerTypes && params.ownerTypes.length === 1) where.ownerType = params.ownerTypes[0];
    if (params.studyId) where.studyId = params.studyId;
    if (params.userId) where.userId = params.userId;

    const rows = (await supabaseDb.embedding.findMany({ where })) as Array<Record<string, any>>;

    const wanted = params.ownerTypes && params.ownerTypes.length > 1 ? new Set(params.ownerTypes) : null;

    const candidates: Rankable[] = [];
    for (const row of rows) {
        const ownerType = String(row.ownerType ?? '');
        if (wanted && !wanted.has(ownerType)) continue;

        const parsed = parseVector(row.vector);
        if (parsed.state !== 'computed') continue;

        candidates.push({
            id: String(row.id),
            vector: parsed.value,
            payload: { row, ownerType },
        });
    }

    const unusable = countUnusable(candidates.map((candidate) => ({ vector: candidate.vector })), EMBEDDING_DIM);

    // `rankBySimilarity` drops anything it cannot compare, so a mismatched or zero vector is
    // never given a score. `unusable` reports how many, because a list that is short because a
    // third of the corpus was skipped looks exactly like a complete one.
    //
    // The floor is applied here rather than inside the call so that the number it removed is
    // observable — a fact the index path cannot produce, and the reason `belowFloor` is a
    // value-or-reason pair rather than a number.
    const scored = rankBySimilarity(vector, candidates, {});
    const above = scored.filter((entry) => entry.similarity >= params.minSimilarity);
    const belowFloor = scored.length - above.length;

    const hits: MatchRow[] = above.slice(0, params.matchCount).map((entry) => {
        const { row, ownerType } = entry.payload as { row: Record<string, any>; ownerType: string };
        return {
            id: entry.id,
            ownerType,
            ownerId: String(row.ownerId ?? ''),
            chunkIndex: Number(row.chunkIndex ?? 0),
            studyId: row.studyId ? String(row.studyId) : null,
            userId: row.userId ? String(row.userId) : null,
            similarity: entry.similarity,
            contentHash: row.contentHash ? String(row.contentHash) : null,
        };
    });

    return { hits, considered: candidates.length, unusable, belowFloor };
}

// --------------------------------------------
// Excerpts
// --------------------------------------------

/** A source's text, split into the same units the indexing path would have produced. */
async function chunksOfSource(
    ownerType: string,
    ownerId: string,
): Promise<Measured<string[]>> {
    try {
        if (ownerType === 'transcript' || ownerType === 'synthesis') {
            const row = await supabaseDb.storedInterview.findUnique({ where: { id: ownerId } });
            if (!row) return refused(`the interview this passage came from (${ownerId}) is no longer stored`);

            if (ownerType === 'synthesis') {
                // Rendered by the same function the backfill embeds with, then chunked the same
                // way `embedSource` chunks it. Either half differing would report every synthesis
                // result as a changed source.
                const text = synthesisText(row.synthesisJSON);
                return isBlank(text) ? refused('the stored synthesis has no readable text') : computed(chunkText(text));
            }

            const messages = parseMessages(row.transcriptJSON);
            if (messages === null) return refused('the stored transcript could not be read as a list of messages');
            return computed(chunkTranscript(messages).map((chunk) => chunk.text));
        }

        if (ownerType === 'resume') {
            const row = await supabaseDb.resume.findUnique({ where: { id: ownerId } });
            if (!row) return refused(`the resume this passage came from (${ownerId}) is no longer stored`);
            const text = typeof row.rawText === 'string' ? row.rawText : '';
            return isBlank(text) ? refused('the stored resume has no text to show') : computed(chunkText(text));
        }

        if (ownerType === 'theme') {
            // A theme vector is keyed by the hash of its normalised label, so the label is
            // recovered from an occurrence that carries the same hash. It is short enough that
            // the "chunk" and the label are the same text.
            const rows = (await supabaseDb.themeOccurrence.findMany({
                where: { contentHash: ownerId },
            })) as Array<Record<string, any>>;
            const label = rows.find((row) => typeof row.label === 'string' && row.label.trim())?.label;
            return label ? computed([String(label).trim()]) : refused('no stored theme carries this label');
        }

        if (ownerType === 'response') {
            const row = await supabaseDb.response.findUnique({ where: { id: ownerId } });
            if (!row) return refused(`the answer this passage came from (${ownerId}) is no longer stored`);
            const text = typeof row.answerText === 'string' ? row.answerText : '';
            return isBlank(text) ? refused('the stored answer is empty') : computed(chunkText(text));
        }

        return refused(
            `passages of type "${ownerType}" have no reader in this service, so the text behind this result cannot be shown`,
        );
    } catch (error) {
        return refused(
            `the source of this passage could not be read: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

function parseMessages(value: unknown): Array<{ role?: unknown; content?: unknown }> | null {
    if (Array.isArray(value)) return value as Array<{ role?: unknown; content?: unknown }>;
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? (parsed as Array<{ role?: unknown; content?: unknown }>) : null;
    } catch {
        return null;
    }
}

/**
 * Attach the ranked passage to each hit, verifying it against the stored hash.
 *
 * This is the step that makes a result an evidential claim rather than a list of ids. The chunk
 * is re-derived from the source by the SAME deterministic chunker the indexer used — `chunkText`
 * and `chunkTranscript` are pure, so index N of a given text is always the same text — and the
 * re-derived chunk is hashed and compared with the hash stored beside the vector.
 *
 * When they agree, the passage shown is provably the passage that was ranked. When they differ,
 * the source has been edited since it was indexed: the vector describes text that is no longer
 * there, and the current text at that position is a different passage. So no excerpt is
 * returned and the reason says exactly that. Showing the new text would put a quotation in front
 * of a reader under a similarity score that was never computed from it.
 *
 * One read per distinct source, not per hit: a long transcript contributes several chunks to one
 * result list, and re-reading it for each would multiply the cost of a search by its own length.
 */
async function attachExcerpts(hits: MatchRow[]): Promise<SearchHit[]> {
    const bySource = new Map<string, MatchRow[]>();
    for (const hit of hits) {
        const key = `${hit.ownerType}::${hit.ownerId}`;
        const list = bySource.get(key);
        if (list) list.push(hit);
        else bySource.set(key, [hit]);
    }

    const resolved = new Map<string, Measured<string[]>>();
    for (const [key, group] of bySource) {
        resolved.set(key, await chunksOfSource(group[0].ownerType, group[0].ownerId));
    }

    return hits.map((hit) => {
        const source: SourceRef = {
            ownerType: hit.ownerType,
            ownerId: hit.ownerId,
            chunkIndex: hit.chunkIndex,
            studyId: hit.studyId,
            userId: hit.userId,
        };

        const chunks = resolved.get(`${hit.ownerType}::${hit.ownerId}`);
        if (!chunks) {
            return { ...base(hit, source), excerpt: null, excerptReason: 'the source of this passage was not read', verified: false };
        }
        if (chunks.state === 'refused') {
            return { ...base(hit, source), excerpt: null, excerptReason: chunks.reason, verified: false };
        }

        const text = chunks.value[hit.chunkIndex];
        if (typeof text !== 'string' || text.length === 0) {
            return {
                ...base(hit, source),
                excerpt: null,
                excerptReason: `the source no longer has a passage at position ${hit.chunkIndex}, so the text this result was ranked from is gone`,
                verified: false,
            };
        }

        if (!hit.contentHash) {
            // The stored hash is what makes the re-derived chunk checkable. Without it the text
            // below might be the passage that was ranked or might be a later edit, and there is
            // no way to tell — so the passage is reported as unverifiable rather than as shown.
            return {
                ...base(hit, source),
                excerpt: null,
                excerptReason:
                    'this vector carries no content hash, so the passage could not be checked against the text it was computed from',
                verified: false,
            };
        }

        if (contentHash(text) !== hit.contentHash) {
            return {
                ...base(hit, source),
                excerpt: null,
                excerptReason:
                    'this source has changed since it was indexed, so the text now at this position is not the passage that was ranked. The similarity score was computed from the earlier text.',
                verified: false,
            };
        }

        return { ...base(hit, source), excerpt: text, excerptReason: null, verified: true };
    });
}

function base(hit: MatchRow, source: SourceRef): Omit<SearchHit, 'excerpt' | 'excerptReason' | 'verified'> {
    return { id: hit.id, similarity: hit.similarity, source };
}

// --------------------------------------------
// The entry point
// --------------------------------------------

/**
 * Search the indexed corpus.
 *
 * The similarity floor is applied to the ranked list rather than pushed into the query, which is
 * correct in both directions: `match_embeddings` returns its nearest `match_count` rows, so if
 * the closest ten are all below the floor then everything further away is too, and filtering the
 * nearest ten cannot hide a match that the nearest eleven would have found. The fallback applies
 * the same floor through `rankBySimilarity`.
 */
export async function searchCorpus(params: SearchParams): Promise<Measured<SearchOutcome>> {
    const query = (params.query ?? '').trim();
    if (isBlank(query)) return refused('the search was empty, so there was nothing to look for');

    const provider = params.provider;
    const matchCount = Math.max(1, Math.min(params.matchCount ?? DEFAULT_MATCH_COUNT, MAX_MATCH_COUNT));
    const minSimilarity = typeof params.minSimilarity === 'number' ? params.minSimilarity : MIN_SIMILARITY;

    const ownerTypes = params.ownerTypes?.length ? params.ownerTypes.filter((type) => typeof type === 'string' && type) : null;
    const studyId = params.studyId ?? null;
    const userId = params.userId ?? null;

    const embedded = await embedQuery(query, provider);
    if (embedded.state !== 'computed') return embedded;
    const vector = embedded.value;

    const scope = { ownerTypes, studyId, userId, model: provider.model, matchCount };

    let ranking: RankingPath = 'index';
    let indexFailure: string | null = null;
    let hits: MatchRow[] = [];
    let considered = 0;
    let unusable = 0;
    let belowFloor: Measured<number> = refused(
        'the ranking function returns only the nearest rows, so how many candidates fell below the similarity floor is not observable from it',
    );

    try {
        const throughIndex = await rankThroughIndex(vector, scope);
        considered = throughIndex.rows.length;
        unusable = throughIndex.unusable;
        hits = orderMatches(throughIndex.rows, { minSimilarity, limit: matchCount });
    } catch (error) {
        // The function is absent, or the role cannot execute it, or the call failed. Any of
        // those means the same thing to a reader — the index did not serve this query — and the
        // fallback answers it with the same arithmetic over the same vectors.
        ranking = 'fallback';
        indexFailure = error instanceof Error ? error.message : String(error);

        const fallback = await rankInJavaScript(vector, { ...scope, minSimilarity });
        considered = fallback.considered;
        unusable = fallback.unusable;
        belowFloor = computed(fallback.belowFloor);
        hits = fallback.hits;
    }

    const withExcerpts = await attachExcerpts(hits);

    const caveats = [...SEARCH_CAVEATS];
    if (query.length < 12) {
        caveats.push(
            'A short query embeds to a less stable vector than a sentence does. Results for a few words are ordered, but two short queries that mean the same thing may not give the same list.',
        );
    }
    if ((studyId || userId) && (!ownerTypes || ownerTypes.includes('theme'))) {
        caveats.push(
            'Theme vectors are corpus-wide: one vector serves every study a label appears in, so they carry no study or candidate. A scoped search does not return them, and a search that needs themes must run unscoped.',
        );
    }
    if (unusable > 0) {
        caveats.push(
            `${unusable} stored ${unusable === 1 ? 'vector was' : 'vectors were'} skipped because ${unusable === 1 ? 'it' : 'they'} could not be compared with the query — a dimension mismatch or a zero vector. ${unusable === 1 ? 'It is' : 'They are'} absent from these results and ranked nowhere.`,
        );
    }
    const stale = withExcerpts.filter((hit) => hit.excerptReason !== null).length;
    if (stale > 0) {
        caveats.push(
            `${stale} of these results could not be shown as a passage, because the source behind ${stale === 1 ? 'it' : 'them'} could not be re-derived. The similarity score is still real; the text it describes is what could not be produced.`,
        );
    }

    return computed({
        query,
        model: provider.model,
        dim: provider.dim,
        ranking,
        rankingNote:
            ranking === 'index'
                ? `Ordered by the database's vector index over ${hits.length} of ${considered} candidate passages returned.`
                : `The database's ranking function was not available, so these results were ordered in the application over ${considered} stored vectors. The order is computed by the same arithmetic; the query did not use the vector index. (${indexFailure ?? 'no reason recorded'})`,
        requested: matchCount,
        returned: withExcerpts.length,
        considered,
        belowFloor: present(belowFloor),
        unusable,
        hits: withExcerpts,
        caveats,
    });
}

/**
 * Whether the database can rank, and how much there is to rank over.
 *
 * Probes `match_embeddings` with a model name no row can carry, so the call exercises the
 * function — proving it exists and this role may execute it — without reading or revealing a
 * single vector. A corpus count alongside it is what makes an empty result list legible: "no
 * matches" over four hundred vectors and "no matches" over none are different facts, and only
 * one of them means the search is working.
 */
export async function searchIndexStatus(provider: EmbeddingProvider): Promise<{
    rankingAvailable: boolean;
    rankingReason: string | null;
    model: string;
    dim: number;
    vectorsInCorpus: number;
    vectorsForModel: number;
}> {
    let rankingAvailable = false;
    let rankingReason: string | null = null;

    try {
        await supabaseDb.$rpc('match_embeddings', {
            query_vector: `[${new Array(EMBEDDING_DIM).fill(0).join(',')}]`,
            match_count: 1,
            filter_model: '__probe_no_such_model__',
        });
        rankingAvailable = true;
    } catch (error) {
        rankingReason =
            'The database ranking function is not available, so searches are ordered in the application. Apply the research migration to enable the vector index. (' +
            (error instanceof Error ? error.message : String(error)) +
            ')';
    }

    let vectorsInCorpus = 0;
    let vectorsForModel = 0;
    try {
        vectorsInCorpus = await supabaseDb.embedding.count({});
        vectorsForModel = await supabaseDb.embedding.count({ where: { model: provider.model } });
    } catch {
        // A count that cannot be read is left at zero with the ranking reason above already
        // saying the database is not answering. Inventing a number here would be worse.
    }

    return {
        rankingAvailable,
        rankingReason,
        model: provider.model,
        dim: provider.dim,
        vectorsInCorpus,
        vectorsForModel,
    };
}
