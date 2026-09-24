// ============================================
// contract.ts — the constants and wordings Feature 5 reasons from
// ============================================
// Pure. No database, no network, no clock. verify-research.ts and the service layer
// both read their thresholds from here, so a number that appears in a UI is the same
// number the engine was tested against.

/** Bumped when a threshold below changes meaning, so a stored figure can be placed. */
export const RESEARCH_REGISTRY_VERSION = 'research-v1';

// --------------------------------------------
// The embedding
// --------------------------------------------

/**
 * The model every vector in the corpus is written with.
 *
 * Gemini is the only shipped provider that publishes an embeddings endpoint.
 * Anthropic does not, and Ollama cannot serve a deployment, so this is not a
 * preference between equals.
 *
 * The dimension is load-bearing and expensive to change: it is pinned in the
 * `Embedding."vector"` column type, and a different model means a migration plus a
 * re-embed of the whole corpus. 768 because pgvector's HNSW index supports at most
 * 2000 dimensions on the `vector` type, which rules out `gemini-embedding-001`'s
 * native 3072 without a `halfvec` column or a dimension reduction.
 */
export const EMBEDDING_MODEL = 'text-embedding-004';
export const EMBEDDING_DIM = 768;
export const EMBEDDING_PROVIDER = 'gemini';

/** Ollama's local embedding model, used when a deployment points at a local server. */
export const OLLAMA_EMBEDDING_MODEL = 'nomic-embed-text';
export const OLLAMA_EMBEDDING_DIM = 768;

/**
 * How many units of text one provider call may carry. The ceiling is on the
 * request, not the corpus: a backfill of ten thousand interviews is many calls.
 */
export const EMBED_BATCH_SIZE = 32;

/** Text longer than this is chunked rather than truncated. Roughly a long answer. */
export const MAX_EMBED_CHARS = 6000;

// --------------------------------------------
// Search
// --------------------------------------------

export const DEFAULT_MATCH_COUNT = 10;
export const MAX_MATCH_COUNT = 50;

/**
 * Similarity below which a result is not shown at all.
 *
 * Cosine similarity is not a calibrated relevance score, and a result list padded
 * to a requested count with unrelated transcripts is worse than a short list — it
 * teaches a reader that the search returns noise. The floor is deliberately low
 * (0.3) because the cost of hiding a real match is higher than the cost of showing
 * a weak one, which is the opposite of how the statistical floors are set.
 */
export const MIN_SIMILARITY = 0.3;

/** The owner types an embedding may describe. */
export const EMBEDDING_OWNER_TYPES = [
    'response',
    'transcript',
    'synthesis',
    'theme',
    'resume',
    'study',
] as const;
export type EmbeddingOwnerType = (typeof EMBEDDING_OWNER_TYPES)[number];

// --------------------------------------------
// Clustering
// --------------------------------------------

/**
 * Cosine similarity at or above which two theme labels are the same theme.
 *
 * 0.82 is a starting point, not a derived constant, and it is stated as such: theme
 * labels are short, and short text embeds noisily. The value is exposed so a
 * deployment can see the number its clusters were built with, and the cluster view
 * shows member labels precisely so a reader can judge whether the join was right.
 * A threshold that hid its members would be indistinguishable from a correct one.
 */
export const CLUSTER_SIMILARITY_THRESHOLD = 0.82;

/** Clusters smaller than this are still reported — they are not merged away. */
export const MIN_CLUSTER_SIZE = 1;

/** Ceiling on k, so a corpus of noise cannot be shredded into singletons. */
export const MAX_CLUSTERS = 40;

/** Iteration ceiling for the k-means loop. Convergence usually arrives well before. */
export const MAX_CLUSTER_ITERATIONS = 50;

// --------------------------------------------
// Trends
// --------------------------------------------

/**
 * The fewest periods a slope may be fitted from.
 *
 * Two points always lie on a line, so a "trend" from two periods is a restatement
 * of the data rather than a finding about it — and with the two periods typically
 * adjacent, it asserts that a change continued. Three is the fewest that can
 * disagree with itself.
 */
export const MIN_TREND_POINTS = 3;

/**
 * Slope magnitude, in occurrences per period, inside which a series is called flat.
 *
 * Without a band every series is either rising or falling, which is a claim the
 * data does not support: a theme moving from 4 to 5 occurrences over six months is
 * stable, and reporting it as growth is how a trend dashboard becomes noise. The
 * band is applied to the fitted slope, so it absorbs a single noisy period.
 */
export const STAGNATION_SLOPE_BAND = 0.5;

/** Periods of flatness, consecutively, before a trajectory is called stalled. */
export const STAGNATION_PERIODS = 3;

/**
 * Slope, in occurrences per period, below which a theme is declining.
 *
 * Distinct from `ABILITY_REGRESSION_SLOPE` below because the units are unrelated: a
 * theme series counts events per month and an ability trajectory measures logits per
 * estimate. Sharing one threshold across both would be comparing quantities that
 * have nothing to do with each other, and the mistake would look like a considered
 * constant rather than a category error.
 */
export const TREND_REGRESSION_SLOPE = -0.5;

// --------------------------------------------
// Growth
// --------------------------------------------

/**
 * Logits per recorded estimate, inside which an ability trajectory is called flat.
 *
 * Ability is reported on a logit scale where one unit is a large difference in
 * proficiency, so 0.05 per estimate is a slow drift rather than movement. The band
 * for themes does not transfer: it is in occurrences per month.
 */
export const ABILITY_FLAT_BAND = 0.05;

/**
 * Logits per recorded estimate, below which a trajectory is treated as a decline
 * worth surfacing.
 *
 * -0.15 over a handful of sessions is a real loss of ground rather than noise, and
 * it is set well outside the estimate's own precision so that the noise in a short
 * trajectory does not trip it. When it does trip, the alert carries the slope and
 * the number of points, so a reader can judge the evidence rather than the warning.
 */
export const ABILITY_REGRESSION_SLOPE = -0.15;

// --------------------------------------------
// Benchmarks
// --------------------------------------------

/**
 * The smallest peer pool a percentile may be published from.
 *
 * A publication floor, and deliberately a different decision from Feature 4's
 * comparison floor even though the two currently share a value. Feature 4 refuses
 * to *compare* cohorts below five because the comparison would be noise; this
 * refuses to *publish* below five because a percentile is a statement about other
 * people, and a "p90" over three candidates, combined with a role and a study,
 * describes individuals who did not consent to being described. Below the floor the
 * percentile columns stay NULL and the reason carries the count.
 */
export const MIN_BENCHMARK_COHORT = 5;

/** The percentiles a benchmark reports. */
export const BENCHMARK_PERCENTILES = [25, 50, 75, 90] as const;

// --------------------------------------------
// Caveats and definitions
// --------------------------------------------

/** Attached to every search response. */
export const SEARCH_CAVEATS = [
    'Results are ranked by embedding similarity, which measures how alike two passages read — not whether an answer was good.',
    'Every result links to the transcript it came from. A passage shown without its source is not evidence.',
];

/** Attached to every trend response. */
export const TREND_CAVEATS = [
    'Trends count how often a theme was raised. Frequency is not importance, and a theme rising may mean a topic became more salient rather than more common.',
    'Clusters are formed by embedding similarity. Two labels joined here are judged alike by a model, not by a person reading them.',
    'A period with no occurrences is a real zero. A period marked "not computed" was never indexed, which is a different fact.',
];

/** Attached to every benchmark response. */
export const BENCHMARK_CAVEATS = [
    'A percentile describes where a score sits among the peers in this pool. It is not a judgement about the person.',
    'Pools below the publication floor report no percentiles at all, so no individual is described by a benchmark of too few.',
];

/** The disclosure shown wherever a growth trajectory is read. */
export const GROWTH_CAVEATS = [
    'A trajectory is fitted through recorded ability estimates. Each point carries its own uncertainty, and a slope through noisy points can be steep without meaning much.',
    'Fewer than three recorded estimates cannot support a slope, and the fit is refused rather than drawn.',
];

/** One line per refusal, so the wording lives in one place. */
export function refusalWording(subject: string, reason: string): string {
    return `Not computed: ${reason} (${subject}).`;
}
