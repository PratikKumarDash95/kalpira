-- ============================================
-- Feature 1 — Competency Measurement Engine
-- ============================================
-- Adds the psychometric measurement layer: a competency graph, calibrated item
-- parameters, and per-candidate ability estimates with uncertainty.
--
-- Purely additive. No existing table is dropped or rewritten; the only change to
-- an existing table is a nullable "competencyId" column on "Question".
--
-- Run with `supabase db push`, or paste into the Supabase SQL editor.

-- --------------------------------------------
-- Competency graph
-- --------------------------------------------
-- A competency is a measurable skill (e.g. "system-design", "sql-joins").
-- parentId/CompetencyEdge express prerequisite structure so a weakness deep in
-- the graph can be propagated up to the competency a candidate actually cares
-- about ("weak in Kubernetes" implies something about "weak in containers").
create table if not exists public."Competency" (
  "id" text primary key default gen_random_uuid()::text,
  "name" text not null,
  "slug" text not null unique,
  "description" text,
  "parentId" text references public."Competency"("id") on delete set null,
  "createdAt" timestamptz not null default now()
);

create index if not exists "Competency_parentId_idx" on public."Competency"("parentId");

-- Directed, weighted relation between two competencies. Kept separate from
-- "parentId" so the same pair can carry more than one relation kind
-- (a node may be both a prerequisite and, weakly, related).
create table if not exists public."CompetencyEdge" (
  "id" text primary key default gen_random_uuid()::text,
  "fromId" text not null references public."Competency"("id") on delete cascade,
  "toId" text not null references public."Competency"("id") on delete cascade,
  "relation" text not null default 'prerequisite',
  "weight" double precision not null default 1,
  "createdAt" timestamptz not null default now(),
  unique ("fromId", "toId", "relation")
);

create index if not exists "CompetencyEdge_fromId_idx" on public."CompetencyEdge"("fromId");
create index if not exists "CompetencyEdge_toId_idx" on public."CompetencyEdge"("toId");

-- --------------------------------------------
-- Item parameters (IRT calibration)
-- --------------------------------------------
-- KEYED BY ITEM TEXT, NOT BY Question ROW.
--
-- This is the load-bearing detail of the whole feature. Question rows are created
-- per response in app/api/sessions/[id]/save-response/route.ts — one AI-generated
-- question, one response, never reused. So a Question row can never accumulate the
-- sample size that calibration needs.
--
-- What does repeat across candidates is the *question text*: interviewer-assigned
-- studies share a fixed question set, and generated banks repeat phrasings.
-- "itemKey" is therefore a hash of the normalised question text (see
-- app/lib/measurement/itemIdentity.ts), which is what makes an item an item.
--
-- "sampleText" keeps a readable copy of the first phrasing seen for that key, so
-- an admin calibration screen can show the actual question behind a parameter row.
--
-- 3PL parameters fitted from accumulated responses:
--   a (discrimination) how sharply the item separates ability levels
--   b (difficulty)     the ability level at which P(correct) is (1+c)/2
--   c (guessing)       lower asymptote, the chance floor for a blind guess
--
-- "sampleSize" is the number of responses used for the current fit, so a consumer
-- can tell a real calibration from a seed default (sampleSize = 0).
-- "isRetired" marks items that carry no measurement information; selection skips
-- them but their historical responses are never deleted.
create table if not exists public."ItemParameter" (
  "id" text primary key default gen_random_uuid()::text,
  "itemKey" text not null unique,
  "sampleText" text not null,
  "competencyId" text references public."Competency"("id") on delete set null,
  "category" text,
  "a" double precision not null default 1,
  "b" double precision not null default 0,
  "c" double precision not null default 0.2,
  "sampleSize" integer not null default 0,
  "proportionCorrect" double precision not null default 0,
  "isRetired" boolean not null default false,
  "retiredReason" text,
  "calibratedAt" timestamptz not null default now()
);

create index if not exists "ItemParameter_isRetired_idx" on public."ItemParameter"("isRetired");
create index if not exists "ItemParameter_competencyId_idx" on public."ItemParameter"("competencyId");

-- --------------------------------------------
-- Ability estimates
-- --------------------------------------------
-- Current best estimate of a candidate's latent ability (theta) per competency,
-- with its standard error. theta is on the logit scale (roughly -4..4, 0 = mean);
-- standardError is the measurement uncertainty and is what makes the estimate
-- honest: a theta of 1.2 with SE 0.9 is not yet a claim about the person.
create table if not exists public."AbilityEstimate" (
  "id" text primary key default gen_random_uuid()::text,
  "userId" text not null references public."User"("id") on delete cascade,
  "competencyId" text not null references public."Competency"("id") on delete cascade,
  "theta" double precision not null default 0,
  "standardError" double precision not null default 1,
  "responsesUsed" integer not null default 0,
  "method" text not null default 'map',
  "updatedAt" timestamptz not null default now(),
  unique ("userId", "competencyId")
);

create index if not exists "AbilityEstimate_userId_idx" on public."AbilityEstimate"("userId");

-- Append-only trajectory. Every recomputation writes a row so growth, stagnation
-- and regression are all derivable — Feature 5 reads this for longitudinal views.
create table if not exists public."AbilityHistory" (
  "id" text primary key default gen_random_uuid()::text,
  "userId" text not null references public."User"("id") on delete cascade,
  "competencyId" text not null references public."Competency"("id") on delete cascade,
  "theta" double precision not null,
  "standardError" double precision not null,
  "sessionId" text references public."InterviewSession"("id") on delete set null,
  "responsesUsed" integer not null default 0,
  "recordedAt" timestamptz not null default now()
);

create index if not exists "AbilityHistory_userId_recordedAt_idx"
  on public."AbilityHistory"("userId", "recordedAt" desc);
create index if not exists "AbilityHistory_competencyId_idx"
  on public."AbilityHistory"("competencyId");

-- --------------------------------------------
-- Link questions to competencies
-- --------------------------------------------
-- Nullable on purpose: existing questions predate the competency graph. The
-- measurement engine falls back to a competency derived from "category" when
-- this is null, so the feature works on day one against existing data.
alter table public."Question"
  add column if not exists "competencyId" text references public."Competency"("id") on delete set null;

create index if not exists "Question_competencyId_idx" on public."Question"("competencyId");
