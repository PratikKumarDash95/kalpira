-- ============================================
-- Feature 5 — Talent & Research Intelligence
-- ============================================
-- Turns the transcript corpus into a searchable, trend-aware asset: embeddings and
-- vector search over what candidates actually said, themes clustered across studies
-- and tracked over time, per-competency growth trajectories, and percentile
-- benchmarks against an anonymised peer pool.
--
-- Four new concerns, and one function.
--
--   1. `Embedding`      one vector per unit of text — a source is chunked first, and
--                       each chunk is keyed by a content hash so a re-index of
--                       unchanged text is a no-op.
--   2. `ThemeCluster`   a theme with an identity. Synthesis themes are free-text
--                       labels inside `StoredInterview."synthesisJSON"` — a text
--                       column — so "pricing objections doubled this quarter" has
--                       nothing to count until a label becomes a row.
--   3. `ThemeOccurrence` the join that makes frequency-over-time computable.
--   4. `TrendSnapshot`  a computed trend, stored with the refusal it may carry.
--   5. `Benchmark`      percentiles per role and competency, suppressed below a floor.
--   6. `IndexJob`       the backfill sweep's lifecycle, mirroring `AnalysisJob`.
--
-- WHY THE EXTENSION IS NOT OPTIONAL HERE
--
-- `Embedding."vector"` is a `vector(768)` column, so this migration cannot apply
-- without pgvector. That is deliberate: a migration that silently skipped the
-- extension would leave a text corpus advertised as searchable and searchable by
-- nothing. If the extension is unavailable the migration fails loudly, at deploy
-- time, where it can be seen.
--
-- WHY 768 AND NOT 1536
--
-- The feature sketch carried `vector(1536)`, which is OpenAI's dimension. The live
-- providers here are Gemini, Claude and Ollama; Anthropic publishes no embeddings
-- endpoint at all, and Ollama cannot serve a deployment. Gemini's
-- `text-embedding-004` emits 768 dimensions, and the number is pinned into the
-- column type, so it is a decision that is expensive to revisit — changing models
-- later means a migration plus a full re-embed. Two things settle it at 768:
--
--   · pgvector's HNSW index supports at most 2000 dimensions on the `vector` type,
--     so `gemini-embedding-001`'s native 3072 could not be indexed without
--     `halfvec` or a dimension reduction.
--   · 768 is smaller, cheaper per call and faster to compare, with no measured loss
--     on the retrieval this feature performs.
--
-- WHY A SQL FUNCTION RATHER THAN A CLIENT QUERY
--
-- There is no raw-SQL path in this codebase. `supabaseDb.$queryRaw` ignores its
-- arguments and performs a connectivity probe — it is not a query executor — and
-- every read otherwise goes through the PostgREST shim, which cannot express
-- `order by "vector" <=> $1`. PostgREST can call a function, so the ranking lives
-- in SQL where the index can serve it. The service falls back to ranking in
-- JavaScript when this function is absent (an older database), and says so in the
-- response rather than pretending the index was used.

create extension if not exists vector;

-- --------------------------------------------
-- Embedding — one vector per unit of text
-- --------------------------------------------
-- `contentHash` is a hash of the *normalised* text that was embedded. The indexing
-- sweep compares the stored hash against the source's current hash and skips the
-- provider call when they match, so re-indexing the corpus is idempotent and does
-- not re-bill for text that has not changed.
--
-- The unique key is (ownerType, ownerId, model, chunkIndex): one current vector per
-- unit of text per model. Re-embedding a chunk replaces its row rather than
-- accumulating versions, because the embedding is derived data — the source text
-- remains the record of what was said. `model` is part of the key so that changing
-- models does not silently compare incomparable vectors: a query embedded with model
-- A is ranked against rows written by model A.
--
-- `chunkIndex` is part of the key because one source is many vectors. A transcript
-- is chunked before it is embedded — a vector averaged over forty minutes of dialogue
-- points at nothing in particular, and a search should return the answer rather than
-- the interview containing it — so the source id alone cannot identify a vector.
-- The pair (ownerType, ownerId) is the *source*; the key is the chunk.
create table if not exists public."Embedding" (
  "id" text primary key default gen_random_uuid()::text,
  "ownerType" text not null,
  "ownerId" text not null,
  "chunkIndex" integer not null default 0,
  "userId" text references public."User"("id") on delete set null,
  "studyId" text references public."Study"("id") on delete cascade,
  "contentHash" text not null,
  "model" text not null,
  "dim" integer not null,
  "vector" vector(768) not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint "Embedding_owner_key" unique ("ownerType", "ownerId", "model", "chunkIndex"),
  constraint "Embedding_chunk_check" check ("chunkIndex" >= 0)
);

-- HNSW over cosine distance, matching the `<=>` operator in `match_embeddings`.
-- The operator class must match the operator used to query or the index is not
-- eligible and the scan degrades to sequential without saying so.
create index if not exists "Embedding_vector_hnsw_idx"
  on public."Embedding" using hnsw ("vector" vector_cosine_ops);
create index if not exists "Embedding_owner_idx"
  on public."Embedding"("ownerType", "ownerId");
create index if not exists "Embedding_studyId_idx" on public."Embedding"("studyId");
create index if not exists "Embedding_userId_idx" on public."Embedding"("userId");

-- --------------------------------------------
-- ThemeCluster — a theme with an identity
-- --------------------------------------------
-- Synthesis produces themes as free-text labels. Two sessions that both raise
-- "pricing objections" are the same theme to a reader and two unrelated strings to
-- a database, so the cluster is what gives a theme a stable id worth counting.
--
-- `scope`/`scopeKey` bound a cluster's membership: 'global' pools themes across
-- every study, and 'study' keeps a study's clustering its own. The pair is a
-- string rather than a nullable studyId so that the global scope is expressible
-- without a null, which would compare unequal to itself under a unique index.
--
-- `occurrenceCount` is a denormalised count, maintained on write, so the trends
-- listing does not aggregate the occurrence table to render a label's total.
create table if not exists public."ThemeCluster" (
  "id" text primary key default gen_random_uuid()::text,
  "scope" text not null default 'global',
  "scopeKey" text not null default 'global',
  "label" text not null,
  "centroid" vector(768),
  "model" text,
  "dim" integer,
  "occurrenceCount" integer not null default 0,
  "firstSeenAt" timestamptz not null default now(),
  "lastSeenAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint "ThemeCluster_scope_check" check ("scope" in ('global', 'study')),
  -- A cluster with a centroid must record the model and dimension that produced it,
  -- and a cluster without one must record neither. A centroid of unknown provenance
  -- could be compared against vectors from an incompatible model.
  constraint "ThemeCluster_centroid_check" check (
    ("centroid" is null and "model" is null and "dim" is null)
    or ("centroid" is not null and "model" is not null and "dim" is not null)
  ),
  constraint "ThemeCluster_count_check" check ("occurrenceCount" >= 0)
);

create index if not exists "ThemeCluster_scope_idx"
  on public."ThemeCluster"("scope", "scopeKey");
create index if not exists "ThemeCluster_lastSeenAt_idx"
  on public."ThemeCluster"("lastSeenAt");

-- --------------------------------------------
-- ThemeOccurrence — one theme, seen once
-- --------------------------------------------
-- The unit that makes "doubled this quarter" answerable. Each row is a theme label
-- observed in one synthesis, attached to the session it came from so a trend can
-- always be traced back to the transcript that produced it.
--
-- `label` keeps the original wording. Clustering is lossy by nature — a cluster's
-- representative label is a summary — and a reader checking a claim needs to see
-- the words that were actually written, not the cluster's name for them.
create table if not exists public."ThemeOccurrence" (
  "id" text primary key default gen_random_uuid()::text,
  "clusterId" text references public."ThemeCluster"("id") on delete set null,
  "scope" text not null default 'global',
  "scopeKey" text not null default 'global',
  "sourceType" text not null default 'synthesis',
  "sourceId" text not null,
  "studyId" text references public."Study"("id") on delete cascade,
  "userId" text references public."User"("id") on delete set null,
  "label" text not null,
  "contentHash" text not null,
  "observedAt" timestamptz not null default now(),
  "createdAt" timestamptz not null default now(),
  -- Re-running the extractor over the same synthesis must not inflate a count.
  constraint "ThemeOccurrence_source_key" unique ("sourceType", "sourceId", "contentHash"),
  constraint "ThemeOccurrence_scope_check" check ("scope" in ('global', 'study'))
);

create index if not exists "ThemeOccurrence_clusterId_idx"
  on public."ThemeOccurrence"("clusterId");
create index if not exists "ThemeOccurrence_observedAt_idx"
  on public."ThemeOccurrence"("observedAt");
create index if not exists "ThemeOccurrence_scope_idx"
  on public."ThemeOccurrence"("scope", "scopeKey", "observedAt");

-- --------------------------------------------
-- TrendSnapshot — a computed trend, or its refusal
-- --------------------------------------------
-- Follows the rule the whole platform runs on: a quantity that could not be
-- computed is stored as NULL with its reason, never as a zero. A period with no
-- theme occurrences and a period that was never indexed are different facts, and a
-- chart that draws them the same way is lying about one of them.
--
-- The CHECK is a strict biconditional: a value without a reason and a reason
-- without a value are both rejected. Same coupling as `CohortMetric_computable_check`.
create table if not exists public."TrendSnapshot" (
  "id" text primary key default gen_random_uuid()::text,
  "scope" text not null default 'global',
  "scopeKey" text not null default 'global',
  "key" text not null,
  "label" text not null,
  "period" text not null,
  "value" double precision,
  "sampleCount" integer,
  "notComputableReason" text,
  "computedAt" timestamptz not null default now(),
  constraint "TrendSnapshot_value_check" check (
    ("value" is null and "notComputableReason" is not null)
    or ("value" is not null and "notComputableReason" is null)
  ),
  -- A zero occurrence count is a real measurement and stays 0; a null count means
  -- the period was not counted. Both are legal, and they are not the same thing.
  constraint "TrendSnapshot_sample_check" check ("sampleCount" is null or "sampleCount" >= 0),
  constraint "TrendSnapshot_scope_check" check ("scope" in ('global', 'study')),
  constraint "TrendSnapshot_point_key" unique ("scope", "scopeKey", "key", "period")
);

create index if not exists "TrendSnapshot_lookup_idx"
  on public."TrendSnapshot"("scope", "scopeKey", "key", "period");

-- --------------------------------------------
-- Benchmark — percentiles, or a refusal to publish them
-- --------------------------------------------
-- A percentile against a peer pool is a statement about other people. Below the
-- floor it is a statement about too few people to be anonymous: a "p90" over three
-- candidates, combined with a role and a study, can identify them. So the floor is
-- a column-level invariant, not a service-layer convention — the same reasoning as
-- Feature 4's cohort minimum, applied to publication rather than to comparison.
--
-- When suppressed, all four percentiles are NULL and `suppressedReason` carries the
-- count and the floor. `cohortSize` is kept in every case: it is a count of
-- participants, not a claim about them, and a reader asking "why is this blank?"
-- deserves the number.
create table if not exists public."Benchmark" (
  "id" text primary key default gen_random_uuid()::text,
  "roleKey" text not null,
  "competencyId" text references public."Competency"("id") on delete cascade,
  "competencySlug" text,
  "cohortSize" integer not null,
  "minCohortN" integer not null,
  "p25" double precision,
  "p50" double precision,
  "p75" double precision,
  "p90" double precision,
  "suppressedReason" text,
  "updatedAt" timestamptz not null default now(),
  constraint "Benchmark_value_check" check (
    (
      "p25" is null and "p50" is null and "p75" is null and "p90" is null
      and "suppressedReason" is not null
    )
    or (
      "p25" is not null and "p50" is not null and "p75" is not null and "p90" is not null
      and "suppressedReason" is null
    )
  ),
  constraint "Benchmark_cohort_check" check ("cohortSize" >= 0 and "minCohortN" > 0),
  constraint "Benchmark_order_check" check (
    "p25" is null or ("p25" <= "p50" and "p50" <= "p75" and "p75" <= "p90")
  ),
  constraint "Benchmark_key" unique ("roleKey", "competencyId")
);

create index if not exists "Benchmark_roleKey_idx" on public."Benchmark"("roleKey");

-- --------------------------------------------
-- IndexJob — the backfill sweep's lifecycle
-- --------------------------------------------
-- Mirrors `AnalysisJob` rather than inventing a second job idiom: queued → running
-- → succeeded/failed, with attempts and an error, claimed by a sweep. There is no
-- scheduler in this codebase, so "computed on a schedule" means "computed when the
-- sweep is invoked", and the job row is what makes that resumable rather than
-- restart-from-zero.
--
-- `cursor` holds the pagination position of a sweep that ran out of work in one
-- pass, and `total`/`processed`/`skipped`/`failed` are the counts the admin view
-- reports instead of a success tick.
create table if not exists public."IndexJob" (
  "id" text primary key default gen_random_uuid()::text,
  "kind" text not null,
  "scopeKey" text,
  "status" text not null default 'queued',
  "attempts" integer not null default 0,
  "error" text,
  "cursor" text,
  "total" integer,
  "processed" integer not null default 0,
  "skipped" integer not null default 0,
  "failed" integer not null default 0,
  "startedAt" timestamptz,
  "finishedAt" timestamptz,
  "createdAt" timestamptz not null default now(),
  constraint "IndexJob_status_check"
    check ("status" in ('queued', 'running', 'succeeded', 'failed')),
  constraint "IndexJob_kind_check"
    check ("kind" in ('backfill', 'themes', 'trends', 'benchmarks')),
  constraint "IndexJob_counts_check" check (
    "attempts" >= 0 and "processed" >= 0 and "skipped" >= 0 and "failed" >= 0
  )
);

create index if not exists "IndexJob_status_idx" on public."IndexJob"("status");
create index if not exists "IndexJob_kind_idx" on public."IndexJob"("kind", "createdAt");

-- --------------------------------------------
-- match_embeddings — the one query the shim cannot express
-- --------------------------------------------
-- PostgREST cannot order by a distance operator, so the ranking lives here, where
-- the HNSW index is eligible. `1 - (a <=> b)` converts cosine distance to cosine
-- similarity, so the result reads the way a caller expects: higher is closer.
--
-- Every filter defaults to null meaning "do not filter". A caller that passes
-- nothing searches the whole corpus it is permitted to see; the route layer is
-- what narrows that to a study or a user, and it always passes at least one
-- bound in practice.
--
-- `stable` (not `immutable`) because it reads tables. `security invoker` — the
-- default — so the function cannot read past the caller's own row-level access.
create or replace function public.match_embeddings(
  query_vector vector(768),
  match_count integer default 10,
  filter_owner_type text default null,
  filter_study_id text default null,
  filter_user_id text default null,
  filter_model text default null
)
returns table (
  "id" text,
  "ownerType" text,
  "ownerId" text,
  "chunkIndex" integer,
  "studyId" text,
  "userId" text,
  "contentHash" text,
  "similarity" double precision
)
language sql
stable
as $$
  select
    e."id",
    e."ownerType",
    e."ownerId",
    e."chunkIndex",
    e."studyId",
    e."userId",
    e."contentHash",
    1 - (e."vector" <=> query_vector) as "similarity"
  from public."Embedding" e
  where (filter_owner_type is null or e."ownerType" = filter_owner_type)
    and (filter_study_id is null or e."studyId" = filter_study_id)
    and (filter_user_id is null or e."userId" = filter_user_id)
    and (filter_model is null or e."model" = filter_model)
  order by e."vector" <=> query_vector
  limit greatest(match_count, 1);
$$;

-- Run with `supabase db push`, or paste into the Supabase SQL editor.
