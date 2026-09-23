-- ============================================
-- Feature 3 — Integrity & Authenticity Suite
-- ============================================
-- Adds the integrity layer: browser proctoring signals, a per-answer authenticity
-- measure, near-duplicate detection within a study, the fused session report, and
-- the appeal and reviewer records that make any of it contestable.
--
-- Purely additive. No existing table is dropped or rewritten.
--
-- Run with `supabase db push`, or paste into the Supabase SQL editor.
--
-- THE ONE IDEA THIS SCHEMA IS BUILT AROUND
--
-- This is the first feature in the product that can accuse a candidate of
-- something, so the schema is shaped to make the honest answer storable and the
-- dishonest one awkward.
--
-- Concretely: "we looked and found nothing" and "we could not look" are different
-- facts, and the tables below keep them apart at the column level. "IntegrityReport"
-- carries a NULLABLE score next to an "assessed" flag rather than defaulting to 100,
-- and "AuthenticityScore" carries "measured" rather than defaulting to 0. A
-- platform that scores a silent session 100 has told the candidate something it
-- cannot justify to them; one that scores it 0 has done worse.
--
-- There is deliberately NO column anywhere for a verdict, a recommendation, or a
-- rejection. A score is evidence. A person decides, and "IntegrityReviewLog" is
-- where that decision is recorded.

-- --------------------------------------------
-- Browser proctoring signals
-- --------------------------------------------
-- One row per observed event: a tab switch, a paste, a fullscreen exit, a
-- resolution change. Append-only in practice — nothing here is ever updated.
--
-- WHY payloadJSON IS BOUNDED, NOT FREE-FORM
-- The browser can see a great deal it has no business storing. This column may
-- hold counts, durations and cadence statistics. It must NOT hold clipboard
-- contents, typed text, or per-key identity. A timing histogram is evidence that
-- typing was mechanical; the words someone typed are their answer, and are already
-- stored where they belong.
--
-- The minimizer in app/lib/integrity/proctoringMath.ts drops unknown keys rather
-- than passing them through, so a future client cannot widen this column by sending
-- a new field. Storing less is the default here, not an optimisation.
create table if not exists public."IntegrityEvent" (
  "id" text primary key default gen_random_uuid()::text,
  "sessionId" text not null references public."InterviewSession"("id") on delete cascade,
  -- The answer this happened during, when the client knows. Nullable because a
  -- signal between answers is still a signal, and forcing it would make the client
  -- invent an attribution it does not have.
  "responseId" text references public."Response"("id") on delete set null,
  "userId" text references public."User"("id") on delete set null,
  -- 'visibility-hidden' | 'window-blur' | 'paste' | 'copy' | 'fullscreen-exit' |
  -- 'resolution-change' | 'keystroke-cadence' | 'devtools-suspected'
  "type" text not null,
  -- Kept low by design: these are observations, not conclusions. Severity is
  -- assigned by the signal registry in contract.ts, not by the browser.
  "severity" text not null default 'info',
  "payloadJSON" jsonb,
  -- When the browser says it happened.
  "occurredAt" timestamptz not null default now(),
  -- When the server received it. A large gap between the two is itself a signal
  -- (a client that batched events after the fact), and a clock-skewed client is
  -- detectable only by keeping both.
  "receivedAt" timestamptz not null default now(),
  constraint "IntegrityEvent_severity_check"
    check ("severity" in ('info', 'low', 'medium', 'high'))
);

create index if not exists "IntegrityEvent_sessionId_idx"
  on public."IntegrityEvent"("sessionId");
create index if not exists "IntegrityEvent_sessionId_type_idx"
  on public."IntegrityEvent"("sessionId", "type");
create index if not exists "IntegrityEvent_responseId_idx"
  on public."IntegrityEvent"("responseId");

-- --------------------------------------------
-- Per-answer authenticity
-- --------------------------------------------
-- The stylometric half: how uniform is this answer's sentence rhythm, how varied
-- is its vocabulary, how much does it repeat itself, and how far has it drifted
-- from the same candidate's own earlier answers.
--
-- "measured" IS THE POINT OF THIS TABLE
-- Every one of these needs text of a certain size to mean anything. A four-word
-- answer has no meaningful burstiness, and a candidate's first answer has nothing
-- to drift from. Those are stored as "measured" = false with a null value and a
-- reason, never as a zero — the same convention as "DeliveryMetric", and for the
-- same reason.
--
-- "driftVsBaseline" IS NULLABLE ON PURPOSE
-- Drift is the strongest single signal in this feature, which is exactly why it
-- must refuse to fire without enough history. Below the baseline answer count it is
-- null, and the report says it could not be computed rather than reporting a
-- confident number derived from two answers.
--
-- THERE IS NO "perplexity" COLUMN
-- The roadmap asked for one. A true perplexity needs a language model, and this
-- pass has no LLM in its scoring path by deliberate decision. Inventing a proxy and
-- labelling it "perplexity" is the fabrication this platform forbids, so the column
-- is absent rather than approximated. When the judge lands it will bring its own
-- columns, and it will be able to say what language model produced them.
create table if not exists public."AuthenticityScore" (
  "id" text primary key default gen_random_uuid()::text,
  "responseId" text not null references public."Response"("id") on delete cascade,
  "sessionId" text not null references public."InterviewSession"("id") on delete cascade,
  "userId" text references public."User"("id") on delete set null,
  -- Word count the metrics were computed over, so a later reader can judge whether
  -- the answer was long enough for the numbers to mean anything.
  "wordCount" integer not null default 0,
  "sentenceCount" integer not null default 0,
  -- Coefficient of variation of sentence length. Low is uniform, which is what
  -- machine-written prose tends to be.
  "burstiness" double precision,
  -- Length-normalised lexical diversity. NOT a raw type-token ratio, which falls
  -- as an answer gets longer and would penalise people for speaking at length.
  "lexicalDiversity" double precision,
  -- Share of repeated n-grams. High values suggest boilerplate or a memorised script.
  "repetitionIndex" double precision,
  -- Distance from this candidate's own earlier answers. Null below the baseline.
  "driftVsBaseline" double precision,
  -- How many earlier answers the drift figure was computed against.
  "baselineAnswers" integer not null default 0,
  "measured" boolean not null default false,
  -- One sentence naming what was and was not computable, written for a person.
  "explanation" text,
  "createdAt" timestamptz not null default now(),
  unique ("responseId")
);

create index if not exists "AuthenticityScore_sessionId_idx"
  on public."AuthenticityScore"("sessionId");
create index if not exists "AuthenticityScore_userId_idx"
  on public."AuthenticityScore"("userId");

-- --------------------------------------------
-- Near-duplicate answers within a study
-- --------------------------------------------
-- Shingling + MinHash over answers in the same study, catching circulated answers
-- and leaked question banks. Near-duplicates, not just exact matches: two people
-- given the same leaked answer will differ in punctuation and a handful of words.
--
-- WHY THE PAIR IS ORDERED
-- "responseAId" < "responseBId" is enforced as a check constraint, so an unordered
-- pair can only be stored one way and the unique index below really does mean one
-- row per pair. Without it, A-B and B-A are two different rows and the pair count
-- silently doubles.
--
-- WHY WITHIN A STUDY, NOT GLOBALLY
-- Two candidates in unrelated studies answering a common question ("tell me about
-- yourself") will share phrasing by necessity, and flagging that would be a false
-- positive on a mass scale. Similarity is only meaningful against the population
-- that was asked the same questions.
--
-- "clusterId" groups transitively similar answers: if A≈B and B≈C, all three are
-- one cluster even when A and C fall below threshold. A leaked answer circulated to
-- five people is one finding, not ten.
create table if not exists public."AnswerSimilarity" (
  "id" text primary key default gen_random_uuid()::text,
  "studyId" text not null references public."Study"("id") on delete cascade,
  "responseAId" text not null references public."Response"("id") on delete cascade,
  "responseBId" text not null references public."Response"("id") on delete cascade,
  -- MinHash estimate of Jaccard similarity over word shingles, 0–1.
  "similarity" double precision not null default 0,
  -- Null when this pair is above threshold but not part of a wider group.
  "clusterId" text,
  "shingleSize" integer not null default 5,
  "computedAt" timestamptz not null default now(),
  unique ("responseAId", "responseBId"),
  constraint "AnswerSimilarity_ordered_pair_check"
    check ("responseAId" < "responseBId"),
  constraint "AnswerSimilarity_range_check"
    check ("similarity" >= 0 and "similarity" <= 1)
);

create index if not exists "AnswerSimilarity_studyId_idx"
  on public."AnswerSimilarity"("studyId");
create index if not exists "AnswerSimilarity_clusterId_idx"
  on public."AnswerSimilarity"("clusterId");

-- --------------------------------------------
-- The fused session report
-- --------------------------------------------
-- Three layers folded into one score, with the evidence trail that produced it.
--
-- "score" IS NULLABLE, AND "assessed" SAYS WHY
-- This is the central decision of the feature. A session where the browser sent no
-- events, the answers were too short to measure, and no similar answers exist has
-- produced no evidence at all. Reporting 100 would assert "this person is clean"
-- from nothing; reporting 0 would assert the opposite. Both are statements the
-- platform cannot justify to the person they are about, so the score is null and
-- "status" says 'not_assessed'. A reader then sees "we could not assess this
-- session" — which is true, and actionable — instead of a number that is not.
--
-- "flagsJSON" holds the evidence trail: for each signal that fired, the measured
-- value, the points it removed, and the innocent explanation that signal cannot
-- rule out. Stored rather than recomputed because the events and text it was
-- derived from are not retained indefinitely, and a finding that can be silently
-- re-derived from changed constants is not an audit trail.
--
-- The reviewer columns are a record of a human decision, which is the only kind of
-- decision this feature permits.
create table if not exists public."IntegrityReport" (
  "id" text primary key default gen_random_uuid()::text,
  "sessionId" text not null references public."InterviewSession"("id") on delete cascade,
  "userId" text references public."User"("id") on delete set null,
  -- Null when the session could not be assessed. Never defaulted.
  "score" double precision,
  -- False means "not enough evidence to judge", which is not the same as clean.
  "assessed" boolean not null default false,
  "status" text not null default 'pending',
  -- The evidence trail: every deduction with its value and its innocent reading.
  "flagsJSON" jsonb,
  -- Statements about how much of the evidence to trust, shown verbatim.
  "caveatsJSON" jsonb,
  -- Per-layer counts, so a reader can see what was actually looked at.
  "layersJSON" jsonb,
  -- The registry version the score was computed under, so a past finding is not
  -- silently reinterpreted when thresholds change.
  "registryVersion" integer not null default 1,
  "generatedAt" timestamptz not null default now(),
  "reviewedBy" text references public."User"("id") on delete set null,
  "reviewedAt" timestamptz,
  "reviewerNote" text,
  constraint "IntegrityReport_status_check"
    check ("status" in ('pending', 'assessed', 'not_assessed', 'failed')),
  -- A scored report must be an assessed one, and an unassessed report must not
  -- carry a score. This is the invariant stated above, enforced by the database
  -- rather than trusted to the service layer.
  constraint "IntegrityReport_score_assessed_check"
    check (("assessed" = true and "score" is not null) or ("assessed" = false and "score" is null)),
  constraint "IntegrityReport_score_range_check"
    check ("score" is null or ("score" >= 0 and "score" <= 100))
);

create index if not exists "IntegrityReport_sessionId_idx"
  on public."IntegrityReport"("sessionId");
create index if not exists "IntegrityReport_status_idx"
  on public."IntegrityReport"("status");

-- --------------------------------------------
-- Candidate appeals
-- --------------------------------------------
-- The roadmap is blunt about this: false positives ruin real people's careers, and
-- a system without appeal is not shippable. So the appeal is part of the feature,
-- not a follow-up — which is why its table ships in the same migration as the score
-- it contests.
--
-- An appeal names ONE flag and carries the candidate's own words. It is not a
-- general complaint box: the reviewer needs to know which finding is being
-- disputed in order to judge it, and a free-floating appeal cannot be resolved.
--
-- "flagKey" is the registry key from contract.ts, kept as text rather than a foreign
-- key because the flag itself lives inside "IntegrityReport"."flagsJSON". The appeal
-- must survive a later change to the registry: a candidate contested something
-- specific on a specific day, and that record should not be rewritten because a
-- threshold moved.
create table if not exists public."IntegrityAppeal" (
  "id" text primary key default gen_random_uuid()::text,
  "sessionId" text not null references public."InterviewSession"("id") on delete cascade,
  "reportId" text not null references public."IntegrityReport"("id") on delete cascade,
  "userId" text references public."User"("id") on delete set null,
  -- Which finding is being contested.
  "flagKey" text not null,
  -- The candidate's own words. The whole point of an appeal is that the person
  -- gets to say something the platform did not ask for.
  "statement" text not null,
  "status" text not null default 'submitted',
  "submittedAt" timestamptz not null default now(),
  -- Which reviewer decided, and where they landed.
  "decidedBy" text references public."User"("id") on delete set null,
  "decidedAt" timestamptz,
  "decisionNote" text,
  constraint "IntegrityAppeal_status_check"
    check ("status" in ('submitted', 'under_review', 'upheld', 'dismissed'))
);

create index if not exists "IntegrityAppeal_reportId_idx"
  on public."IntegrityAppeal"("reportId");
create index if not exists "IntegrityAppeal_status_idx"
  on public."IntegrityAppeal"("status");
create index if not exists "IntegrityAppeal_userId_idx"
  on public."IntegrityAppeal"("userId");

-- --------------------------------------------
-- Reviewer decisions, append-only
-- --------------------------------------------
-- Every reviewer action is recorded here and nothing is ever updated or deleted —
-- enforced in the service layer, which exposes no update or delete path for this
-- model. The same rule Feature 4 applies to its decision log.
--
-- WHY THIS IS SEPARATE FROM THE COLUMNS ON "IntegrityReport" AND "IntegrityAppeal"
-- Those columns hold the CURRENT state: who reviewed it, what they decided. This
-- table holds the HISTORY: that a decision was made, by whom, when, and what they
-- said. A report can be reviewed only once; the log is what lets a reader see that
-- it was, and lets an auditor ask whether one reviewer is dismissing every appeal
-- they are handed — a question the current-state columns cannot answer, because
-- they only ever hold the latest value.
create table if not exists public."IntegrityReviewLog" (
  "id" text primary key default gen_random_uuid()::text,
  "reportId" text not null references public."IntegrityReport"("id") on delete cascade,
  -- Set when the action was a decision on an appeal rather than on the report.
  "appealId" text references public."IntegrityAppeal"("id") on delete set null,
  "reviewerId" text references public."User"("id") on delete set null,
  "action" text not null,
  "note" text,
  "at" timestamptz not null default now()
);

create index if not exists "IntegrityReviewLog_reportId_idx"
  on public."IntegrityReviewLog"("reportId");
create index if not exists "IntegrityReviewLog_reviewerId_idx"
  on public."IntegrityReviewLog"("reviewerId");
