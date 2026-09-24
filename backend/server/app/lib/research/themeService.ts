// ============================================
// themeService.ts — giving a theme an identity, and never moving it
// ============================================
// Synthesis writes its themes as free-text labels inside `StoredInterview."synthesisJSON"`,
// a text column. This file is what turns those labels into rows that can be counted: it
// extracts them into `ThemeOccurrence`, embeds each distinct label once, and joins the
// occurrences to `ThemeCluster`.
//
// THE ONE RULE THAT MAKES TRENDS MEAN ANYTHING
//
// An occurrence's `clusterId` is written once and then left alone. `clusterMath.ts` explains
// why in full; the operational consequence here is that this file never re-clusters a scope
// that already has clusters. `assignToNearest` joins a new label to an existing cluster, and
// a label that matches nothing *creates* a cluster rather than being forced into the nearest
// one. A sweep that re-ran k-means over the whole corpus would renumber clusters, re-point
// every occurrence, and make a trend line report the clustering's own noise as a change in
// the world.
//
// The bootstrap below is the one exception, and it runs only when a scope has occurrences
// and no clusters at all — the first sweep over a corpus. After that the incremental path is
// the only path.
//
// WHY A LABEL IS EMBEDDED ONCE FOR THE WHOLE CORPUS
//
// The embedding is keyed by `(ownerType: 'theme', ownerId: <hash of the normalised label>)`
// rather than by the occurrence. "Pricing objections" written in four hundred syntheses is
// one piece of text with one meaning, so it is one vector: embedding it four hundred times
// would bill four hundred times for the same call, and would put four hundred identical
// points into a k-means run whose centroids are then decided by how often a phrase was
// repeated. It follows that a theme vector carries no `studyId` — the same label appears in
// many studies, and the provenance of an occurrence is on every `ThemeOccurrence` row.
//
// THE SCOPE IS CHOSEN AT EXTRACTION AND NOT REVISITED
//
// `ThemeOccurrence."clusterId"` is a single column, so an occurrence belongs to exactly one
// clustering. A deployment that sweeps globally and then sweeps per study does not get two
// clusterings of the same occurrence: the second sweep finds the row already stored and
// leaves it where it is. That is a real limitation of the schema and it is reported rather
// than hidden — `existingScopeMismatch` counts what a sweep wanted and could not claim.

import supabaseDb from '../supabaseDb';
import { computed, refused } from '../measured';
import type { Measured } from '../measured';
import type { EmbeddingProvider } from '../providers/embeddings';
import { embedSource } from './embeddingService';
import { contentHash, isBlank } from './chunking';
import {
    assignToNearest,
    kmeans,
    representativeLabel,
    suggestK,
    type ClusterPoint,
} from './clusterMath';
import {
    centroid as centroidOf,
    isUsableVector,
    parseVector,
    toVectorLiteral,
} from './vectorMath';
import {
    CLUSTER_SIMILARITY_THRESHOLD,
    MIN_CLUSTER_SIZE,
    type EmbeddingOwnerType,
} from './contract';

/** The scope a cluster and its occurrences live in. */
export type ThemeScope = 'global' | 'study';

export interface ScopeRef {
    scope: ThemeScope;
    scopeKey: string;
}

/** The only owner type this file writes vectors under. */
const THEME_OWNER_TYPE: EmbeddingOwnerType = 'theme';

export const DEFAULT_THEME_SOURCE_LIMIT = 2000;
const MAX_NEW_CLUSTERS_DEFAULT = 500;

// --------------------------------------------
// Scope
// --------------------------------------------

/**
 * Reads a scope from a caller's strings.
 *
 * A study scope without a study id is refused rather than silently widened to the global
 * corpus: "cluster this study" and "cluster everything" are different operations, and
 * treating the first as the second would mix one study's themes into every other study's
 * trend. The global scope has no key — `'global'` is stored rather than null so the pair
 * compares equal to itself under the unique index.
 */
export function resolveScope(scope: unknown, scopeKey?: unknown): Measured<ScopeRef> {
    const name = typeof scope === 'string' ? scope.trim().toLowerCase() : '';
    if (name === 'global') return computed({ scope: 'global', scopeKey: 'global' });
    if (name === 'study') {
        const key = typeof scopeKey === 'string' ? scopeKey.trim() : '';
        if (!key) {
            return refused(
                'a study scope needs a study id, and none was given — without one a study scope would cluster every study together',
            );
        }
        return computed({ scope: 'study', scopeKey: key });
    }
    return refused(`the scope was "${String(scope)}", and a scope is either "global" or "study"`);
}

// --------------------------------------------
// Reading themes out of a stored synthesis
// --------------------------------------------

/** One theme label as written by synthesis, with whatever else sat beside it. */
export interface ExtractedTheme {
    label: string;
    evidence: string | null;
    frequency: number | null;
}

/**
 * The themes in a `synthesisJSON` value.
 *
 * The shape is the one `prompts/synthesis.ts` asks for — `{ themes: [{ theme, evidence,
 * frequency }] }` — and this reader is deliberately forgiving about everything except the
 * label, because the column holds whatever the model actually returned: prose wrapped around
 * the JSON, a `themes` array that is absent, an entry that is a bare string.
 *
 * A malformed value yields no themes rather than throwing. One unreadable synthesis must not
 * stop a sweep over ten thousand, and a synthesis that produced no themes is not a failure —
 * it is a source with nothing to contribute.
 *
 * Duplicate labels within one synthesis are collapsed. The occurrence table's unique key is
 * `(sourceType, sourceId, contentHash)`, so a model that listed the same theme twice would
 * otherwise produce a second insert the database rejects — and the honest reading of a
 * repeated label is one theme raised once, not two occurrences of it.
 */
export function themesFromSynthesis(synthesisJSON: unknown): ExtractedTheme[] {
    const parsed = parseJsonObject(synthesisJSON);
    if (!parsed) return [];

    const raw = parsed.themes;
    if (!Array.isArray(raw)) return [];

    const out: ExtractedTheme[] = [];
    const seen = new Set<string>();

    for (const entry of raw) {
        const label = labelOf(entry);
        if (!label) continue;
        const hash = contentHash(label);
        if (seen.has(hash)) continue;
        seen.add(hash);

        const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
        out.push({
            label,
            evidence: typeof record.evidence === 'string' && record.evidence.trim() ? record.evidence.trim() : null,
            frequency:
                typeof record.frequency === 'number' && Number.isFinite(record.frequency) ? record.frequency : null,
        });
    }

    return out;
}

/** The label of a theme entry, or null when it carries none. */
function labelOf(entry: unknown): string | null {
    if (typeof entry === 'string') return isBlank(entry) ? null : entry.trim();
    if (!entry || typeof entry !== 'object') return null;

    const record = entry as Record<string, unknown>;
    for (const key of ['theme', 'label', 'name', 'title']) {
        const value = record[key];
        if (typeof value === 'string' && !isBlank(value)) return value.trim();
    }
    return null;
}

/** A JSON column that may be an object, text, null or garbage. */
function parseJsonObject(value: unknown): Record<string, unknown> | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value !== 'string') return null;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

// --------------------------------------------
// A synthesis as embeddable text
// --------------------------------------------

/**
 * The prose of a stored synthesis, for embedding.
 *
 * A synthesis is stored as JSON, and embedding the JSON itself would put braces, key names and
 * escaped quotes into the vector — tokens that appear in every synthesis and therefore
 * distinguish none of them. The rendered form is what a reader would take from it: the bottom
 * line first, because it is the one-sentence summary, then each theme with its evidence.
 *
 * This function lives here, beside `themesFromSynthesis`, because both read the same shape and a
 * second reader of it elsewhere would drift. Two consumers depend on the agreement: the backfill
 * embeds what this returns, and search re-derives the passage from the same source and checks it
 * against the stored hash. If the two renderings differed by a character, every synthesis search
 * result would be reported as a changed source.
 *
 * An unreadable value renders to the empty string rather than throwing: a corpus sweep has to
 * survive one bad row, and `isBlank` downstream turns the empty string into "nothing to index",
 * which is the honest description of a synthesis that cannot be read.
 */
export function synthesisText(synthesisJSON: unknown): string {
    const parsed = parseJsonObject(synthesisJSON);
    if (!parsed) {
        // A synthesis stored as a plain string is still text someone wrote. Anything else —
        // null, a number, an array — has no prose in it.
        return typeof synthesisJSON === 'string' && !isBlank(synthesisJSON) ? synthesisJSON.trim() : '';
    }

    const lines: string[] = [];

    const bottomLine = parsed.bottomLine;
    if (typeof bottomLine === 'string' && !isBlank(bottomLine)) lines.push(bottomLine.trim());

    for (const [key, heading] of [
        ['statedPreferences', 'Stated preferences'],
        ['revealedPreferences', 'Revealed preferences'],
        ['contradictions', 'Contradictions'],
        ['keyInsights', 'Key insights'],
    ] as const) {
        const value = parsed[key];
        if (!Array.isArray(value)) continue;
        const items = value.filter((item): item is string => typeof item === 'string' && !isBlank(item));
        if (items.length === 0) continue;
        lines.push(`${heading}: ${items.map((item) => item.trim()).join('; ')}`);
    }

    for (const theme of themesFromSynthesis(parsed)) {
        lines.push(theme.evidence ? `${theme.label}: ${theme.evidence}` : theme.label);
    }

    return lines.join('\n');
}

// --------------------------------------------
// Extraction
// --------------------------------------------

export interface IndexThemesParams {
    scope: ThemeScope;
    scopeKey?: string | null;
    /** A single study's syntheses. Omitted, every study is swept. */
    studyId?: string | null;
    /** Only syntheses completed at or after this. Applied in JS — see below. */
    since?: Date | string | null;
    /** Bounds one sweep. The unique key makes a truncated sweep resumable, not lossy. */
    limit?: number;
}

export interface IndexThemesOutcome {
    scope: ThemeScope;
    scopeKey: string;
    sourcesScanned: number;
    sourcesWithThemes: number;
    sourcesWithoutThemes: number;
    sourcesUnreadable: number;
    labelsSeen: number;
    occurrencesCreated: number;
    occurrencesExisting: number;
    /** Wanted by this sweep, but already stored in a different scope. Never re-pointed. */
    existingScopeMismatch: number;
}

/**
 * Turns every stored synthesis in scope into `ThemeOccurrence` rows.
 *
 * Idempotent by construction: the row key is `(sourceType, sourceId, contentHash)`, and the
 * hashes already stored for the scope are read before anything is written, so a second sweep
 * over an unchanged corpus inserts nothing. That is the property `embedSource` gets from its
 * content hash, applied one level up.
 *
 * `observedAt` is the SOURCE's own completed time, not the time of the sweep. A theme raised
 * in March belongs in March's bucket even if the corpus was first indexed in September, and a
 * sweep that stamped `now()` would move every historical occurrence into the month the
 * feature was switched on — a trend line that reports the deployment date as a surge.
 *
 * `since` is applied in JavaScript rather than in the query. The shim's where-clause is
 * equality-only for anything pushed to PostgREST, and an operator it does not understand
 * matches nothing — silently, returning "no sources" for a window that is full of them. A
 * filter that runs in JS is slower and honest; the sweep is bounded by `limit` regardless.
 */
export async function indexThemes(params: IndexThemesParams): Promise<Measured<IndexThemesOutcome>> {
    const scopeRef = resolveScope(params.scope, params.scopeKey);
    if (scopeRef.state !== 'computed') return scopeRef;
    const { scope, scopeKey } = scopeRef.value;

    if (scope === 'study' && params.studyId && params.studyId !== scopeKey) {
        return refused(
            `the sweep was scoped to study ${scopeKey} and asked to read study ${params.studyId}, which are different studies`,
        );
    }

    const limit = Math.max(1, Math.min(params.limit ?? DEFAULT_THEME_SOURCE_LIMIT, DEFAULT_THEME_SOURCE_LIMIT));
    const studyFilter = scope === 'study' ? scopeKey : (params.studyId ?? null);

    // An empty `where` means the whole table to this shim, which is what a global sweep wants.
    const sources = (await supabaseDb.storedInterview.findMany({
        where: studyFilter ? { studyId: studyFilter } : {},
    })) as Array<Record<string, any>>;

    const since = readDate(params.since);
    const ordered = sources
        .filter((row) => !since || (sourceTimeOf(row)?.getTime() ?? 0) >= since.getTime())
        .sort((left, right) => (sourceTimeOf(left)?.getTime() ?? 0) - (sourceTimeOf(right)?.getTime() ?? 0));

    // Existing occurrences for the scope, read once rather than once per source: the
    // where-clause is equality on two columns, which PostgREST can serve, and the per-source
    // alternative would be one round trip per interview.
    const existing = (await supabaseDb.themeOccurrence.findMany({
        where: { scope, scopeKey },
    })) as Array<Record<string, any>>;

    const known = new Set<string>();
    for (const row of existing) {
        known.add(occurrenceKey(String(row.sourceId ?? ''), String(row.contentHash ?? '')));
    }

    const outcome: IndexThemesOutcome = {
        scope,
        scopeKey,
        sourcesScanned: 0,
        sourcesWithThemes: 0,
        sourcesWithoutThemes: 0,
        sourcesUnreadable: 0,
        labelsSeen: 0,
        occurrencesCreated: 0,
        occurrencesExisting: 0,
        existingScopeMismatch: 0,
    };

    const pending: Array<Record<string, any>> = [];
    /** The hashes this sweep wanted, per source — used only to count a scope mismatch. */
    const wanted = new Map<string, Set<string>>();

    for (const source of ordered) {
        if (outcome.sourcesScanned >= limit) break;
        outcome.sourcesScanned += 1;

        const sourceId = String(source.id);
        const raw = source.synthesisJSON;
        if (raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())) {
            outcome.sourcesWithoutThemes += 1;
            continue;
        }

        const themes = themesFromSynthesis(raw);
        if (themes.length === 0) {
            // Two different facts, and a synthesis whose JSON cannot be read at all is the one
            // worth separating: it means the extractor has a shape it does not understand,
            // which is a bug to fix, rather than a synthesis that named no themes.
            if (parseJsonObject(raw) === null) outcome.sourcesUnreadable += 1;
            else outcome.sourcesWithoutThemes += 1;
            continue;
        }

        outcome.sourcesWithThemes += 1;
        outcome.labelsSeen += themes.length;

        const observedAt = sourceTimeOf(source) ?? new Date();
        const studyId = source.studyId ? String(source.studyId) : null;
        const userId = source.userId ? String(source.userId) : null;
        const sourceWanted = new Set<string>();
        wanted.set(sourceId, sourceWanted);

        for (const theme of themes) {
            const hash = contentHash(theme.label);
            sourceWanted.add(hash);
            if (known.has(occurrenceKey(sourceId, hash))) {
                outcome.occurrencesExisting += 1;
                continue;
            }
            known.add(occurrenceKey(sourceId, hash));
            outcome.occurrencesCreated += 1;

            pending.push({
                clusterId: null,
                scope,
                scopeKey,
                sourceType: 'synthesis',
                sourceId,
                studyId,
                userId,
                label: theme.label,
                contentHash: hash,
                observedAt: observedAt.toISOString(),
            });
        }
    }

    // An occurrence stored under another scope is invisible to the read above and to the
    // unique key, so it is looked for directly. See the header: an occurrence belongs to one
    // clustering, and a sweep that wanted it in a different one has to be told that rather
    // than left to wonder why its count is short. One extra read of the occurrence table, and
    // only when the sweep actually found themes to want.
    if (wanted.size > 0) {
        const allRows = (await supabaseDb.themeOccurrence.findMany({
            where: { sourceType: 'synthesis' },
        })) as Array<Record<string, any>>;

        for (const row of allRows) {
            const sourceId = String(row.sourceId ?? '');
            const sourceWanted = wanted.get(sourceId);
            if (!sourceWanted) continue;
            if (String(row.scope) === scope && String(row.scopeKey) === scopeKey) continue;
            if (sourceWanted.has(String(row.contentHash ?? ''))) outcome.existingScopeMismatch += 1;
        }
    }

    if (pending.length > 0) {
        // One round trip for the whole sweep — the delivery layer's job writer does the same
        // thing for the same reason.
        await supabaseDb.themeOccurrence.createMany({ data: pending });
    }

    return computed(outcome);
}

// --------------------------------------------
// Embedding the labels
// --------------------------------------------

interface LoadedVectors {
    vectors: Map<string, number[]>;
    refused: Map<string, string>;
    stored: number;
}

/**
 * Ensures every label in scope has a stored vector, and returns them keyed by content hash.
 *
 * A no-op for a corpus whose labels have not changed: `embedSource` skips a chunk whose
 * stored hash already matches, so the whole method costs one read.
 *
 * A label the provider refuses stays unembedded. It is not given a zero vector, an empty
 * array, or an average of its neighbours: a theme with no vector cannot join a cluster, and
 * it is reported as unclustered rather than attached to whichever cluster happens to be
 * nearest in a space it does not occupy.
 */
async function loadThemeVectors(
    labels: string[],
    provider: EmbeddingProvider,
    options: { embed?: boolean } = {},
): Promise<LoadedVectors> {
    const vectors = new Map<string, number[]>();
    const refusedLabels = new Map<string, string>();
    let stored = 0;

    const distinct = new Map<string, string>();
    for (const label of labels) {
        const hash = contentHash(label);
        if (!distinct.has(hash)) distinct.set(hash, label);
    }
    if (distinct.size === 0) return { vectors, refused: refusedLabels, stored };

    const readVectors = async () => {
        // Equality on ownerType and model, which PostgREST can serve. `ownerId` is left out
        // deliberately: filtering by a list of hashes would need an `in`, which the shim
        // answers by loading the whole table in JS — the same work as this, less clearly.
        const rows = (await supabaseDb.embedding.findMany({
            where: { ownerType: THEME_OWNER_TYPE, model: provider.model },
        })) as Array<Record<string, any>>;

        for (const row of rows) {
            const hash = String(row.ownerId ?? '');
            if (!distinct.has(hash)) continue;

            const parsed = parseVector(row.vector);
            if (parsed.state !== 'computed') {
                refusedLabels.set(hash, parsed.reason);
                continue;
            }
            if (!isUsableVector(parsed.value, provider.dim)) {
                refusedLabels.set(
                    hash,
                    `the stored vector has ${parsed.value.length} dimensions and ${provider.model} produces ${provider.dim}, so the two cannot be compared`,
                );
                continue;
            }
            vectors.set(hash, parsed.value);
        }
    };

    await readVectors();
    if (options.embed === false) return { vectors, refused: refusedLabels, stored };

    const missing = [...distinct.entries()].filter(([hash]) => !vectors.has(hash) && !refusedLabels.has(hash));
    if (missing.length === 0) return { vectors, refused: refusedLabels, stored };

    for (const [hash, label] of missing) {
        const result = await embedSource({
            ownerType: THEME_OWNER_TYPE,
            ownerId: hash,
            userId: null,
            // A label is corpus-wide text. See the header: the study a theme was raised in is
            // on its occurrence rows, not on the one vector every study shares.
            studyId: null,
            text: label,
            provider,
        });
        if (result.state === 'refused') {
            refusedLabels.set(hash, result.reason);
            continue;
        }
        stored += result.value.stored;
    }

    // Read back what was just written. `embedSource` stores vectors and does not return them,
    // and it is the only writer of an `Embedding` row in this feature — re-reading is the
    // price of keeping that invariant, and it is one query.
    await readVectors();

    return { vectors, refused: refusedLabels, stored };
}

// --------------------------------------------
// Clustering
// --------------------------------------------

export interface ClusterScopeParams {
    scope: ThemeScope;
    scopeKey?: string | null;
    provider: EmbeddingProvider;
    /** Ceiling on clusters created in one sweep, so a noisy corpus cannot run away. */
    maxNewClusters?: number;
}

export interface ClusterScopeOutcome {
    scope: ThemeScope;
    scopeKey: string;
    model: string;
    dim: number;
    occurrencesInScope: number;
    clustersBefore: number;
    clustersAfter: number;
    clustersCreated: number;
    bootstrapped: boolean;
    bootstrapRefusal: string | null;
    /** Occurrences whose clusterId was written in this sweep. */
    assigned: number;
    /** Of those, how many joined a cluster that already existed. */
    joined: number;
    /** Of those, how many caused a cluster to be created for them. */
    seeded: number;
    /** No usable vector, so they cannot be compared with anything. Left unclustered. */
    unembeddable: number;
    unembeddableReasons: Array<{ label: string; reason: string }>;
    /** Clusters whose centroid was left as it was — see the note where this is counted. */
    centroidSkipped: number;
    labelsWithoutVectors: number;
    caveats: string[];
}

/** A cluster as this file needs it while working. */
interface ClusterState {
    id: string;
    label: string;
    centroid: number[] | null;
    /** Occurrence ids, always — not label hashes. */
    members: Set<string>;
    /** The count the row had when it was read, so an unchanged cluster is not rewritten. */
    storedCount: number;
    touched: boolean;
    lastSeenAt: Date | null;
}

/**
 * Joins every unclustered occurrence in a scope to a cluster, creating clusters where
 * nothing is close enough.
 *
 * See the header for why this is incremental, and why a scope that already has clusters is
 * never re-clustered. The deliberate exception is the bootstrap: a scope with occurrences and
 * no clusters has never been clustered, and joining the first thousand labels one at a time
 * would produce a thousand clusters, most of them duplicates of each other. `kmeans` over the
 * distinct labels gives the initial arrangement; everything after it is incremental.
 *
 * A refused bootstrap is not a failed sweep. It degrades to the incremental path, which still
 * produces correct clusters — worse ones — and the outcome says so rather than pretending the
 * seeding happened.
 *
 * ASSIGNMENTS WITHIN ONE SWEEP USE THE CENTROIDS THE SWEEP STARTED WITH
 *
 * A cluster that gains members has its centroid recomputed once, at the end, from all of its
 * members. Mid-sweep it therefore still answers with its old centroid, which is why the
 * occurrences are processed in a fixed order: the result is a function of the input, not of
 * how a map happened to iterate.
 */
export async function clusterScope(params: ClusterScopeParams): Promise<Measured<ClusterScopeOutcome>> {
    const scopeRef = resolveScope(params.scope, params.scopeKey);
    if (scopeRef.state !== 'computed') return scopeRef;
    const { scope, scopeKey } = scopeRef.value;

    const provider = params.provider;
    const maxNewClusters = Math.max(1, params.maxNewClusters ?? MAX_NEW_CLUSTERS_DEFAULT);

    const occurrenceRows = (await supabaseDb.themeOccurrence.findMany({
        where: { scope, scopeKey },
    })) as Array<Record<string, any>>;
    const clusterRows = (await supabaseDb.themeCluster.findMany({
        where: { scope, scopeKey },
    })) as Array<Record<string, any>>;

    const outcome: ClusterScopeOutcome = {
        scope,
        scopeKey,
        model: provider.model,
        dim: provider.dim,
        occurrencesInScope: occurrenceRows.length,
        clustersBefore: clusterRows.length,
        clustersAfter: clusterRows.length,
        clustersCreated: 0,
        bootstrapped: false,
        bootstrapRefusal: null,
        assigned: 0,
        joined: 0,
        seeded: 0,
        unembeddable: 0,
        unembeddableReasons: [],
        centroidSkipped: 0,
        labelsWithoutVectors: 0,
        caveats: [],
    };

    if (occurrenceRows.length === 0) {
        outcome.caveats.push('This scope has no theme occurrences, so there was nothing to cluster.');
        return computed(outcome);
    }

    // Deterministic order. Assignment creates clusters as it goes, so a different order would
    // create a different first cluster and, from there, a different arrangement — the
    // reproducibility `clusterMath.ts` goes to some length to provide is only real if the
    // caller's iteration order is fixed too.
    const occurrences = occurrenceRows
        .map((row) => ({
            id: String(row.id),
            label: String(row.label ?? ''),
            hash: String(row.contentHash ?? '') || contentHash(String(row.label ?? '')),
            clusterId: row.clusterId ? String(row.clusterId) : null,
            observedAt: readDate(row.observedAt) ?? new Date(0),
        }))
        .sort((left, right) => {
            const delta = left.observedAt.getTime() - right.observedAt.getTime();
            if (delta !== 0) return delta;
            return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
        });

    const clusters = new Map<string, ClusterState>();
    for (const row of clusterRows) {
        const id = String(row.id);
        const parsed = row.centroid === null || row.centroid === undefined ? null : parseVector(row.centroid);
        clusters.set(id, {
            id,
            label: String(row.label ?? ''),
            centroid: parsed && parsed.state === 'computed' && isUsableVector(parsed.value) ? parsed.value : null,
            members: new Set<string>(),
            storedCount: Number(row.occurrenceCount ?? 0),
            touched: false,
            lastSeenAt: readDate(row.lastSeenAt),
        });
    }

    // Membership is derived from the occurrence rows rather than from a stored list, so it is
    // authoritative: a cluster whose occurrences were removed by a cascade is corrected here
    // rather than carrying a count nobody can reproduce.
    for (const occurrence of occurrences) {
        if (occurrence.clusterId && clusters.has(occurrence.clusterId)) {
            clusters.get(occurrence.clusterId)!.members.add(occurrence.id);
        }
    }

    const loaded = await loadThemeVectors(
        occurrences.map((occurrence) => occurrence.label),
        provider,
    );
    const { vectors, refused: refusedLabels } = loaded;
    outcome.labelsWithoutVectors = refusedLabels.size;

    const unclustered = occurrences.filter(
        (occurrence) => !occurrence.clusterId || !clusters.has(occurrence.clusterId),
    );

    // ---- bootstrap: only for a scope that has never been clustered ----------------
    if (clusters.size === 0 && unclustered.length > 0) {
        const points: ClusterPoint[] = [];
        const labelsByHash = new Map<string, string[]>();

        for (const occurrence of occurrences) {
            if (!vectors.has(occurrence.hash)) continue;
            const existingLabels = labelsByHash.get(occurrence.hash);
            if (existingLabels) {
                existingLabels.push(occurrence.label);
                continue;
            }
            labelsByHash.set(occurrence.hash, [occurrence.label]);
            points.push({ id: occurrence.hash, vector: vectors.get(occurrence.hash)! });
        }

        const k = suggestK(points.length);
        if (points.length < 1) {
            outcome.bootstrapRefusal = 'no label in this scope had a usable vector, so there was nothing to seed clusters from';
        } else if (k < 1 || points.length < k) {
            outcome.bootstrapRefusal = `the scope has ${points.length} distinct ${points.length === 1 ? 'label' : 'labels'} and seeding asked for ${k} clusters`;
        } else {
            const fitted = kmeans(points, k);
            if (fitted.state === 'refused') {
                outcome.bootstrapRefusal = fitted.reason;
            } else {
                outcome.bootstrapped = true;

                // hash -> the cluster it landed in, so occurrences can be attached without
                // scanning every cluster's members for every occurrence.
                const clusterByHash = new Map<string, string>();

                for (const cluster of fitted.value.clusters) {
                    const labels = cluster.memberIds.flatMap((hash) => labelsByHash.get(hash) ?? []);
                    const name = representativeLabel(labels);
                    const created = await createCluster({
                        scope,
                        scopeKey,
                        label: name.state === 'computed' ? name.value : 'Unlabelled cluster',
                        centroid: cluster.centroid,
                        model: provider.model,
                        dim: provider.dim,
                    });
                    clusters.set(created.id, created.state);
                    outcome.clustersCreated += 1;
                    for (const hash of cluster.memberIds) clusterByHash.set(hash, created.id);
                }

                for (const occurrence of occurrences) {
                    const clusterId = clusterByHash.get(occurrence.hash);
                    if (!clusterId || occurrence.clusterId === clusterId) continue;

                    await supabaseDb.themeOccurrence.update({
                        where: { id: occurrence.id },
                        data: { clusterId },
                    });
                    occurrence.clusterId = clusterId;

                    const state = clusters.get(clusterId)!;
                    state.members.add(occurrence.id);
                    state.touched = true;
                    outcome.assigned += 1;
                    outcome.joined += 1;
                }
            }
        }
    }

    // ---- incremental --------------------------------------------------------------
    for (const occurrence of unclustered) {
        // The bootstrap above may already have placed this one.
        if (occurrence.clusterId && clusters.has(occurrence.clusterId)) continue;

        const vector = vectors.get(occurrence.hash);
        if (!vector) {
            outcome.unembeddable += 1;
            if (outcome.unembeddableReasons.length < 10) {
                outcome.unembeddableReasons.push({
                    label: occurrence.label,
                    reason:
                        refusedLabels.get(occurrence.hash) ??
                        `the label "${occurrence.label}" has no stored vector, so it cannot be compared with any cluster`,
                });
            }
            continue;
        }

        const centres = [...clusters.values()]
            .filter((cluster) => cluster.centroid !== null)
            .map((cluster) => ({ id: cluster.id, centroid: cluster.centroid as number[] }));

        const nearest = assignToNearest(centres, vector, CLUSTER_SIMILARITY_THRESHOLD);

        if (nearest.state === 'computed') {
            await supabaseDb.themeOccurrence.update({
                where: { id: occurrence.id },
                data: { clusterId: nearest.value.id },
            });
            occurrence.clusterId = nearest.value.id;

            const state = clusters.get(nearest.value.id)!;
            state.members.add(occurrence.id);
            state.touched = true;
            outcome.assigned += 1;
            outcome.joined += 1;
            continue;
        }

        // Nothing was close enough — which includes both "there are no clusters yet" and
        // "this label is far from all of them". Both mean the same thing: this is a theme the
        // scope has not seen, and its first appearance is what a researcher is looking for.
        // Forcing it into the nearest cluster would erase exactly that.
        if (outcome.clustersCreated >= maxNewClusters) {
            outcome.unembeddable += 1;
            if (outcome.unembeddableReasons.length < 10) {
                outcome.unembeddableReasons.push({
                    label: occurrence.label,
                    reason: `this sweep has already created ${outcome.clustersCreated} clusters, its ceiling, so no cluster was created for this label`,
                });
            }
            continue;
        }

        const created = await createCluster({
            scope,
            scopeKey,
            label: occurrence.label,
            centroid: vector,
            model: provider.model,
            dim: provider.dim,
        });
        clusters.set(created.id, created.state);
        outcome.clustersCreated += 1;
        outcome.seeded += 1;

        await supabaseDb.themeOccurrence.update({
            where: { id: occurrence.id },
            data: { clusterId: created.id },
        });
        occurrence.clusterId = created.id;
        created.state.members.add(occurrence.id);
        created.state.touched = true;
        outcome.assigned += 1;
    }

    // ---- centroids, counts and last-seen -----------------------------------------
    const vectorsByOccurrence = new Map<string, number[]>();
    for (const occurrence of occurrences) {
        const vector = vectors.get(occurrence.hash);
        if (vector) vectorsByOccurrence.set(occurrence.id, vector);
    }
    const observedAtByOccurrence = new Map<string, Date>();
    for (const occurrence of occurrences) observedAtByOccurrence.set(occurrence.id, occurrence.observedAt);

    for (const cluster of clusters.values()) {
        const members = [...cluster.members];
        if (members.length < MIN_CLUSTER_SIZE) {
            // A cluster that lost every member — a cascade removed the occurrences — keeps its
            // centroid and is left alone rather than deleted. Deleting it would renumber
            // everything that pointed at it, which is the one thing this file never does.
            continue;
        }
        if (!cluster.touched && members.length === cluster.storedCount) continue;

        let missing = 0;
        const memberVectors: number[][] = [];
        let latest = cluster.lastSeenAt;

        for (const memberId of members) {
            const vector = vectorsByOccurrence.get(memberId);
            if (!vector) missing += 1;
            else memberVectors.push(vector);

            const observedAt = observedAtByOccurrence.get(memberId);
            if (observedAt && (!latest || observedAt.getTime() > latest.getTime())) latest = observedAt;
        }

        let centroid = cluster.centroid;
        let writeCentroid = false;

        if (missing > 0) {
            // A centroid recomputed from a subset is not the centre of this cluster; it is the
            // centre of the members that happened to have vectors, and every future assignment
            // would be made against it. The old centroid is kept instead, and the number of
            // times that happened is reported.
            outcome.centroidSkipped += 1;
        } else if (memberVectors.length > 0) {
            const recomputed = centroidOf(memberVectors);
            if (recomputed.state === 'computed') {
                centroid = recomputed.value;
                writeCentroid = true;
            } else {
                outcome.centroidSkipped += 1;
            }
        }

        const literal = writeCentroid && centroid ? toVectorLiteral(centroid) : null;

        await supabaseDb.themeCluster.update({
            where: { id: cluster.id },
            data: {
                occurrenceCount: members.length,
                lastSeenAt: (latest ?? new Date()).toISOString(),
                updatedAt: new Date().toISOString(),
                ...(literal && literal.state === 'computed'
                    ? { centroid: literal.value, model: provider.model, dim: provider.dim }
                    : {}),
            },
        });
        cluster.storedCount = members.length;
    }

    outcome.clustersAfter = clusters.size;

    if (loaded.stored > 0) {
        outcome.caveats.push(
            `${loaded.stored} theme ${loaded.stored === 1 ? 'label was' : 'labels were'} embedded for the first time in this sweep.`,
        );
    }
    if (outcome.unembeddable > 0) {
        // A disclosure, not a warning: these are real themes the corpus contains and this
        // clustering does not represent. They are absent from every frequency downstream.
        outcome.caveats.push(
            `${outcome.unembeddable} ${outcome.unembeddable === 1 ? 'occurrence is' : 'occurrences are'} unclustered because ${outcome.unembeddable === 1 ? 'its label has' : 'their labels have'} no usable vector. They are counted in no cluster's frequency.`,
        );
    }
    if (outcome.bootstrapRefusal) {
        outcome.caveats.push(
            `The initial clustering was not seeded (${outcome.bootstrapRefusal}), so clusters were built one label at a time instead.`,
        );
    }

    return computed(outcome);
}

interface CreateClusterParams {
    scope: ThemeScope;
    scopeKey: string;
    label: string;
    centroid: number[];
    model: string;
    dim: number;
}

/**
 * Writes a cluster row with no members yet.
 *
 * The label is chosen by the caller — the plurality label of a bootstrap cluster, or the one
 * theme a new cluster was created for, which is the honest name for a cluster of one. The
 * original wording is never lost either way: every occurrence keeps the label it was written
 * with, and the cluster view shows them.
 */
async function createCluster(params: CreateClusterParams): Promise<{ id: string; state: ClusterState }> {
    const literal = toVectorLiteral(params.centroid);
    if (literal.state !== 'computed') {
        throw new Error(`a cluster centroid could not be written: ${literal.reason}`);
    }

    const now = new Date();
    const row = await supabaseDb.themeCluster.create({
        data: {
            scope: params.scope,
            scopeKey: params.scopeKey,
            label: params.label,
            centroid: literal.value,
            model: params.model,
            dim: params.dim,
            occurrenceCount: 0,
            firstSeenAt: now.toISOString(),
            lastSeenAt: now.toISOString(),
            updatedAt: now.toISOString(),
        },
    });

    const id = String(row.id);
    return {
        id,
        state: {
            id,
            label: params.label,
            centroid: params.centroid,
            members: new Set<string>(),
            storedCount: 0,
            touched: true,
            lastSeenAt: now,
        },
    };
}

// --------------------------------------------
// Reading clusters back
// --------------------------------------------

export interface ClusterView {
    id: string;
    scope: ThemeScope;
    scopeKey: string;
    label: string;
    occurrenceCount: number;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    model: string | null;
    dim: number | null;
    /** False when the centroid could not be read back, so nothing can ever be matched to it. */
    comparable: boolean;
    centroidReason: string | null;
}

/** The clusters in a scope, most frequent first. */
export async function listClusters(params: {
    scope: ThemeScope;
    scopeKey?: string | null;
    limit?: number;
}): Promise<Measured<{ clusters: ClusterView[]; total: number }>> {
    const scopeRef = resolveScope(params.scope, params.scopeKey);
    if (scopeRef.state !== 'computed') return scopeRef;

    const rows = (await supabaseDb.themeCluster.findMany({
        where: { scope: scopeRef.value.scope, scopeKey: scopeRef.value.scopeKey },
    })) as Array<Record<string, any>>;

    const clusters = rows
        .map((row) => presentCluster(row, scopeRef.value))
        .sort((left, right) => {
            if (right.occurrenceCount !== left.occurrenceCount) return right.occurrenceCount - left.occurrenceCount;
            // Alphabetical on a tie, so the listing does not reshuffle between reads.
            return left.label < right.label ? -1 : left.label > right.label ? 1 : 0;
        });

    const limit = Math.max(1, Math.min(params.limit ?? 100, 500));
    return computed({ clusters: clusters.slice(0, limit), total: clusters.length });
}

function presentCluster(row: Record<string, any>, scope: ScopeRef): ClusterView {
    const parsed = row.centroid === null || row.centroid === undefined ? null : parseVector(row.centroid);
    const usable = parsed !== null && parsed.state === 'computed' && isUsableVector(parsed.value);

    // A cluster whose centroid is missing or malformed is not a cluster with no members. It is
    // one that can never be matched against, and it says so rather than reporting an
    // arrangement it cannot make.
    let centroidReason: string | null = null;
    if (parsed !== null && parsed.state === 'refused') centroidReason = parsed.reason;
    else if (parsed !== null && parsed.state === 'computed' && !usable) {
        centroidReason = `the stored centroid has ${parsed.value.length} usable dimensions, which is not a vector anything can be compared against`;
    }

    return {
        id: String(row.id),
        scope: scope.scope,
        scopeKey: scope.scopeKey,
        label: String(row.label ?? ''),
        occurrenceCount: Number(row.occurrenceCount ?? 0),
        firstSeenAt: isoOrNull(row.firstSeenAt),
        lastSeenAt: isoOrNull(row.lastSeenAt),
        model: row.model ? String(row.model) : null,
        dim: typeof row.dim === 'number' ? row.dim : null,
        comparable: usable,
        centroidReason,
    };
}

/** One cluster with the labels that were actually written into it. */
export async function clusterMembers(
    clusterId: string,
    limit = 50,
): Promise<{
    cluster: Record<string, any> | null;
    members: Array<{ id: string; label: string; observedAt: string | null; studyId: string | null }>;
    total: number;
}> {
    const cluster = await supabaseDb.themeCluster.findUnique({ where: { id: clusterId } });
    if (!cluster) return { cluster: null, members: [], total: 0 };

    const rows = (await supabaseDb.themeOccurrence.findMany({ where: { clusterId } })) as Array<Record<string, any>>;

    const members = rows
        .map((row) => ({
            id: String(row.id),
            label: String(row.label ?? ''),
            observedAt: isoOrNull(row.observedAt),
            studyId: row.studyId ? String(row.studyId) : null,
        }))
        .sort((left, right) => (left.observedAt ?? '').localeCompare(right.observedAt ?? ''));

    return {
        cluster,
        members: members.slice(0, Math.max(1, Math.min(limit, 500))),
        total: members.length,
    };
}

// --------------------------------------------
// Small readers
// --------------------------------------------

/** The key the occurrence table uses to decide whether a theme is already stored. */
function occurrenceKey(sourceId: string, hash: string): string {
    return `${sourceId}::${hash}`;
}

/** The moment a stored synthesis belongs to: when the interview finished. */
function sourceTimeOf(row: Record<string, any>): Date | null {
    return readDate(row.completedAt) ?? readDate(row.createdAt);
}

/** A date from a column the shim has already normalised, or null. */
function readDate(value: unknown): Date | null {
    if (value === null || value === undefined || value === '') return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date;
}

/** An ISO string for output, or null — never the string "Invalid Date". */
function isoOrNull(value: unknown): string | null {
    return readDate(value)?.toISOString() ?? null;
}
