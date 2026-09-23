-- ============================================
-- Feature 2 — Multimodal Delivery Analysis
-- ============================================
-- Adds the delivery layer: measured speech/image signals per answer, the fusion
-- record that says how (and whether) those signals moved a score, and a durable
-- job record for the analysis pipeline.
--
-- Purely additive. No existing table is dropped or rewritten; the only changes to
-- an existing table are nullable (or defaulted) columns on "Response".
--
-- Run with `supabase db push`, or paste into the Supabase SQL editor.

-- --------------------------------------------
-- Measured delivery signals
-- --------------------------------------------
-- One row per (response, metric). The metric registry in
-- app/lib/delivery/contract.ts is the source of truth for what a metric key
-- means, its unit and its healthy band; this table stores what was actually
-- measured for a particular answer.
--
-- WHY ROWS AND NOT A JSON BLOB
-- The wrapper in app/lib/supabaseDb.ts cannot filter inside jsonb — it falls back
-- to loading every row and filtering in JavaScript. A normalized row per metric
-- is therefore what makes queries like "median filler rate across all candidates"
-- and "responses where pace moved the score" workable at all. The blob alternative
-- would be cheaper to write and useless to query.
--
-- "measured" IS THE POINT OF THIS TABLE
-- A metric can be absent for real reasons: the microphone was muted, the answer
-- ran three seconds, the camera was covered. The platform's rule is that an
-- unmeasured signal is reported as unmeasured rather than as a zero, so a row with
-- "measured" = false and "value" = null is a first-class, stored outcome. It is
-- what lets the UI say "we could not measure your pace" instead of "your pace
-- scored 0", and it is the difference between a measurement platform and a
-- guess.
--
-- "source" records where the signal came from, because the honest answer to "why
-- was this measured" differs: 'audio' came from the browser's microphone envelope,
-- 'video' from its sampled frames, and 'lexical' was derived from the transcript.
create table if not exists public."DeliveryMetric" (
  "id" text primary key default gen_random_uuid()::text,
  "responseId" text not null references public."Response"("id") on delete cascade,
  "sessionId" text not null references public."InterviewSession"("id") on delete cascade,
  -- Kept denormalised so a per-candidate delivery profile does not need to join
  -- through Response on every read.
  "userId" text references public."User"("id") on delete set null,
  "metricKey" text not null,
  "value" double precision,
  "unit" text not null default 'index',
  -- Where the value sat relative to its healthy band: -1 fully against, +1 fully
  -- in favour. Stored rather than recomputed so a later change to the registry's
  -- bands cannot silently rewrite what a past answer was judged on.
  "position" double precision not null default 0,
  -- Points this metric contributed to its dimension, before the fusion cap.
  "impact" double precision not null default 0,
  "inBand" boolean not null default true,
  "measured" boolean not null default true,
  "source" text not null default 'audio',
  -- One sentence naming the value and where it sits, written for the candidate.
  "explanation" text,
  "createdAt" timestamptz not null default now(),
  unique ("responseId", "metricKey")
);

create index if not exists "DeliveryMetric_sessionId_idx" on public."DeliveryMetric"("sessionId");
create index if not exists "DeliveryMetric_userId_idx" on public."DeliveryMetric"("userId");
create index if not exists "DeliveryMetric_metricKey_idx" on public."DeliveryMetric"("metricKey");
create index if not exists "DeliveryMetric_userId_metricKey_idx"
  on public."DeliveryMetric"("userId", "metricKey");

-- --------------------------------------------
-- Analysis jobs
-- --------------------------------------------
-- The pipeline that turns a raw capture into persisted metrics: queued → running
-- → succeeded / failed.
--
-- The endpoint drains the job inline, so a healthy analysis finishes inside the
-- same request that saved the answer. The row exists anyway, for two reasons that
-- inline processing alone cannot provide: a failure is visible and retryable
-- rather than a log line nobody reads, and a separate worker can later claim
-- 'queued' rows without any schema change. "claimedBy"/"claimedAt" are the lease
-- a multi-worker deployment needs, and are what stop two workers from analysing
-- the same answer twice.
--
-- RETENTION: "payload" holds the raw captured envelope and frame statistics.
-- It is cleared on success — the derived metrics are kept permanently because
-- they are what the score and the UI are built from, but the raw voice-energy
-- profile of a candidate is not something to keep indefinitely. The consequence
-- is deliberate: a completed analysis cannot be replayed from its payload, so
-- changing the metric constants affects future answers rather than silently
-- rewriting past ones.
create table if not exists public."AnalysisJob" (
  "id" text primary key default gen_random_uuid()::text,
  "responseId" text references public."Response"("id") on delete cascade,
  "sessionId" text references public."InterviewSession"("id") on delete cascade,
  "userId" text references public."User"("id") on delete set null,
  "kind" text not null default 'delivery',
  "status" text not null default 'queued',
  "attempts" integer not null default 0,
  "maxAttempts" integer not null default 3,
  "payload" jsonb,
  "result" jsonb,
  "lastError" text,
  "claimedBy" text,
  "claimedAt" timestamptz,
  "startedAt" timestamptz,
  "finishedAt" timestamptz,
  "createdAt" timestamptz not null default now(),
  constraint "AnalysisJob_status_check"
    check ("status" in ('queued', 'running', 'succeeded', 'failed'))
);

create index if not exists "AnalysisJob_status_idx" on public."AnalysisJob"("status");
create index if not exists "AnalysisJob_responseId_idx" on public."AnalysisJob"("responseId");
create index if not exists "AnalysisJob_sessionId_idx" on public."AnalysisJob"("sessionId");

-- --------------------------------------------
-- Fusion record on the response
-- --------------------------------------------
-- "deliveryJSON" is the audit trail of a scoring decision: the adjustments that
-- were applied to communication and confidence, the reason when none were, and the
-- caveats (an obscured camera, partial frame coverage) that a reader needs to
-- judge how much of the evidence to trust. It is stored rather than recomputed
-- because the text-derived inputs it started from are not retained, and because a
-- scoring decision that can be silently re-derived is not an audit trail.
--
-- The two delta columns duplicate values inside the JSON, and that is a deliberate
-- trade: they are the fields a query filters on ("which answers did delivery
-- move?"), and the wrapper cannot index into jsonb. Same reasoning as
-- "ItemParameter"."sampleText" keeping a readable copy of the question.
--
-- There is deliberately NO single "deliveryScore". Delivery is evidence about how
-- something was said, capped at ±8 points and split across two dimensions whose
-- weights differ; collapsing it to one number would invite exactly the reading the
-- feature exists to prevent — that a person's manner of speaking is a grade.
alter table public."Response"
  add column if not exists "deliveryJSON" jsonb,
  add column if not exists "deliveryCommunicationDelta" double precision not null default 0,
  add column if not exists "deliveryConfidenceDelta" double precision not null default 0,
  add column if not exists "deliveryAnalyzedAt" timestamptz;

create index if not exists "Response_deliveryAnalyzedAt_idx"
  on public."Response"("deliveryAnalyzedAt");
