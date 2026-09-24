-- ============================================
-- Feature 4 — Fairness, Bias & Compliance Audit
-- ============================================
-- Adds the audit layer: the record of one adverse-impact analysis, the per-cohort
-- statistics it produced, the bias flags it raised, the append-only provenance log of
-- every AI-influenced decision, and the cohort tags the analysis is grouped by.
--
-- Purely additive to the existing schema, plus three additive columns on "Response".
-- No table is dropped or rewritten.
--
-- Run with `supabase db push`, or paste into the Supabase SQL editor.
--
-- THE ONE IDEA THIS SCHEMA IS BUILT AROUND
--
-- Feature 3 could accuse a candidate; this feature can condemn a *system*, and the
-- failure mode is different in a way that shapes every table below.
--
-- A bias statistic is a claim about a population, and it is only as good as the sample
-- behind it. Two candidates split across two cohorts will always produce a selection-rate
-- ratio, and it will always be a number between 0 and 1 — a perfectly confident-looking
-- figure computed from nothing. That number, acted on, is how an audit tool becomes a
-- liability: it invites a hiring manager to conclude the process is biased, or that it is
-- fair, on evidence that cannot support either.
--
-- So the same rule Feature 3 applied to a session applies here to a cohort, one level up:
-- "we measured it and it is not significant" and "we could not measure it" are different
-- facts, and the tables below keep them apart AT THE COLUMN LEVEL rather than trusting a
-- service layer to remember. "CohortMetric" carries a NULLABLE "selectionRate" beside a
-- "computable" flag with a CHECK coupling them, and a "notComputableReason" column that is
-- required in exactly the case where the statistics are absent. A reader can then see
-- "not computed: 3 candidates in this cohort" instead of a ratio derived from three people.
--
-- THERE IS DELIBERATELY NO COLUMN FOR A PROTECTED ATTRIBUTE ANYWHERE IN THIS FILE
--
-- Not a gender, not a date of birth, not a nationality, not an ethnicity, not a disability
-- status. Cohorts are whatever the study DECLARES (institution, region, experience band)
-- and a candidate is tagged into one by a person; "CohortAssignment" is validated against
-- the study's own declaration at the service layer, so a key the study did not declare is
-- refused rather than stored. The audit never infers a cohort from anything, and this is a
-- design commitment rather than a data-protection nicety: an inferred protected attribute
-- is personal data the candidate never gave, held for a purpose they never agreed to.
--
-- A NOTE ON WHAT THIS IS NOT
--
-- Nothing in this schema computes a legal conclusion. An adverse impact ratio is a
-- screening statistic; four-fifths is a rule of thumb from US enforcement guidance, not a
-- legal test. "BiasFlag" carries a recommendation for a human to consider and a
-- "whatItCannotSay" it must state, and there is no column anywhere for a verdict, a
-- compliance status, or an approval. The compliance report's own wording is assembled in
-- app/lib/fairness/complianceReport.ts and states its limits there.

-- --------------------------------------------
-- Which cohort each candidate is in
-- --------------------------------------------
-- The grouping key for every statistic below. One row per (session, cohortKey).
--
-- WHY THIS IS A TABLE AND NOT A COLUMN ON "InterviewSession"
-- The roadmap requires zero new PII columns, and the shape of the requirement is the
-- reason. A column pair ("cohortKey", "cohortValue") on every session invites the next
-- person to think of it as a general-purpose place to put something about a candidate,
-- and the second thing anyone puts there is a protected attribute. A separate table whose
-- every row names which declared key it belongs to cannot hold an undeclared one, and the
-- service layer checks the key against the study's declaration before insert.
--
-- WHY "assignedBy" IS KEPT
-- A cohort tag is a human judgement about a person, made by an interviewer. Recording who
-- made it is what makes the tag auditable later — the same reason the integrity feature
-- keeps its reviewer identity. It is null for a tag whose author has since been deleted,
-- which is honest: the row survives, the attribution does not.
create table if not exists public."CohortAssignment" (
  "id" text primary key default gen_random_uuid()::text,
  "sessionId" text not null references public."InterviewSession"("id") on delete cascade,
  "studyId" text not null references public."Study"("id") on delete cascade,
  -- The key as the study declared it (e.g. 'experienceBand'). Never a protected
  -- attribute: validated against Study.configJSON's fairness.cohortKeys on the way in.
  "cohortKey" text not null,
  -- The value within that key's declared list. Free text only in type; the service
  -- refuses a value the study did not declare for this key.
  "cohortValue" text not null,
  "assignedBy" text references public."User"("id") on delete set null,
  "assignedAt" timestamptz not null default now(),
  constraint "CohortAssignment_unique_key"
    unique ("sessionId", "cohortKey")
);

create index if not exists "CohortAssignment_studyId_idx"
  on public."CohortAssignment"("studyId");
create index if not exists "CohortAssignment_study_key_value_idx"
  on public."CohortAssignment"("studyId", "cohortKey", "cohortValue");
create index if not exists "CohortAssignment_sessionId_idx"
  on public."CohortAssignment"("sessionId");

-- --------------------------------------------
-- One audit run
-- --------------------------------------------
-- A run is a snapshot, not a live view. Everything the analysis depended on is copied
-- into it, for the same reason "IntegrityReport" copies its flags rather than
-- recomputing them: a finding that can be silently re-derived under changed thresholds
-- is not an audit trail.
--
-- WHY "selectionThreshold" IS STORED RATHER THAN READ
-- The threshold is what turns a score into a selection, and it is a judgement that will
-- move — a study that selects at 70 this quarter may select at 60 the next. Without the
-- threshold recorded on the run, a report generated in March would be re-read in June as
-- though it had been computed under June's rule, and neither the reader nor the auditor
-- could tell. It is stored as a number, not as a reference to a config field that may
-- since have been edited.
--
-- WHY "excludedJSON" EXISTS AND WHY IT MATTERS MORE THAN THE STATISTICS
-- An audit's credibility rests on what it left out. A session with no score, a candidate
-- with no cohort tag, a score that could not be traced to a model decision — every one of
-- those is a silent way to make the sample look cleaner than it is, and the direction of
-- the distortion is unknowable. They are counted and named here, printed on the report,
-- and never quietly dropped.
--
-- "status" is a string discriminant and not a set of booleans, for the reason recorded in
-- sessionAccess.ts: this backend compiles with strict:false, where boolean-literal unions
-- do not narrow and every call site fails to narrow its refusal branch.
create table if not exists public."AuditRun" (
  "id" text primary key default gen_random_uuid()::text,
  "studyId" text references public."Study"("id") on delete cascade,
  -- 'study' for one study's run. Widening to a cross-study scope later is a new value
  -- here rather than a new table; nothing today produces anything but 'study'.
  "scope" text not null default 'study',
  "status" text not null default 'pending',
  -- The cohort declaration the run was computed against, verbatim.
  "cohortDeclarationJSON" jsonb,
  -- The cutoff that made a score a selection. Null when the study declared none, in which
  -- case the run cannot compute selection rates at all and says so rather than guessing.
  "selectionThreshold" double precision,
  -- Which cohort every other cohort was compared against, and why it was chosen.
  "referenceCohortKey" text,
  "referenceCohortValue" text,
  "referenceReason" text,
  -- How many sessions were actually analysed, and how many were looked at and left out.
  "sampleSize" integer not null default 0,
  "includedSessions" integer not null default 0,
  -- Every session left out, with the reason. See the note above: this is the audit's
  -- credibility, not its bookkeeping.
  "excludedJSON" jsonb,
  -- Statements about how much of the result to trust, shown verbatim on the report.
  "caveatsJSON" jsonb,
  -- The headline figures, stored so a report is reproducible without re-running.
  "summaryJSON" jsonb,
  -- The version of the flag registry the findings were produced under, so a past finding
  -- is not silently reinterpreted when a threshold moves. Same purpose as
  -- "IntegrityReport"."registryVersion".
  "registryVersion" integer not null default 1,
  "startedAt" timestamptz not null default now(),
  "finishedAt" timestamptz,
  -- The failure, when the run could not complete. A run that failed says so; it does not
  -- fall back to reporting an empty but successful audit.
  "error" text,
  "createdBy" text references public."User"("id") on delete set null,
  constraint "AuditRun_scope_check"
    check ("scope" in ('study', 'global')),
  constraint "AuditRun_status_check"
    check ("status" in ('pending', 'running', 'succeeded', 'failed', 'not_computable')),
  constraint "AuditRun_threshold_range_check"
    check ("selectionThreshold" is null or ("selectionThreshold" >= 0 and "selectionThreshold" <= 100))
);

create index if not exists "AuditRun_studyId_idx"
  on public."AuditRun"("studyId");
create index if not exists "AuditRun_startedAt_idx"
  on public."AuditRun"("startedAt" desc);
create index if not exists "AuditRun_status_idx"
  on public."AuditRun"("status");

-- --------------------------------------------
-- One cohort, as measured by one run
-- --------------------------------------------
-- The per-group statistics: how many were in it, how many were selected, what they scored,
-- and how that compares with the reference cohort.
--
-- "computable" IS THE POINT OF THIS TABLE
-- Every figure below except the counts is nullable, and the CHECK constraint at the bottom
-- enforces the invariant this feature exists to get right: a cohort is either computable
-- and carries a selection rate, or it is not computable and carries a reason. There is no
-- third state and there is no default of zero. A cohort of two people produces no ratio
-- here — it produces "not computed: 2 candidates in this cohort", which is a fact, where a
-- ratio of 0.5 would be a fabrication with a plausible face.
--
-- WHY "adverseImpactRatio" IS SEPARATE FROM "pValue"
-- They answer different questions and routinely disagree, which is exactly why the roadmap
-- asks for both. The four-fifths ratio is a screening threshold with no notion of
-- uncertainty; a p-value says whether a gap this size is distinguishable from chance at
-- this sample size. A small cohort can breach four-fifths while the z-test finds nothing,
-- and a large cohort can sit comfortably inside four-fifths while the z-test is highly
-- significant. Reporting one without the other is how a screening statistic gets mistaken
-- for a finding, so both are stored, both are printed, and neither is presented alone.
--
-- "effectSize" holds Cohen's d: the standardised mean-score difference against the
-- reference cohort. It is a different question again — not "are the rates different" but
-- "how far apart are the score distributions" — and it is null on the same terms as the rest.
create table if not exists public."CohortMetric" (
  "id" text primary key default gen_random_uuid()::text,
  "auditRunId" text not null references public."AuditRun"("id") on delete cascade,
  "cohortKey" text not null,
  "cohortValue" text not null,
  -- Total candidates tagged into this cohort in the run's study.
  "n" integer not null default 0,
  -- Those of them that have a usable score. Aged below "n" whenever some had none, and the
  -- gap is what tells a reader the cohort is thinner than it looks.
  "scoredN" integer not null default 0,
  -- How many of scoredN were at or above the selection threshold.
  "selectedCount" integer not null default 0,
  -- The four-fifths inputs. Null whenever the cohort is not computable.
  "selectionRate" double precision,
  "referenceRate" double precision,
  "meanScore" double precision,
  "stdDev" double precision,
  "adverseImpactRatio" double precision,
  "zStatistic" double precision,
  "pValue" double precision,
  "chiSquare" double precision,
  "effectSize" double precision,
  "computable" boolean not null default false,
  -- Required in exactly the case where the numbers above are absent. Enforced below.
  "notComputableReason" text,
  "computedAt" timestamptz not null default now(),
  constraint "CohortMetric_rates_range_check"
    check (
      ("selectionRate" is null or ("selectionRate" >= 0 and "selectionRate" <= 1))
      and ("referenceRate" is null or ("referenceRate" >= 0 and "referenceRate" <= 1))
    ),
  constraint "CohortMetric_pvalue_range_check"
    check ("pValue" is null or ("pValue" >= 0 and "pValue" <= 1)),
  -- The central invariant, enforced by the database rather than trusted to the service
  -- layer: a computable cohort has a selection rate and no refusal reason; an
  -- uncomputable one has a reason and no selection rate. Written as a single biconditional
  -- so the two halves cannot drift apart.
  constraint "CohortMetric_computable_check"
    check (
      ("computable" = true and "selectionRate" is not null and "notComputableReason" is null)
      or ("computable" = false and "selectionRate" is null and "notComputableReason" is not null)
    ),
  constraint "CohortMetric_counts_check"
    check ("n" >= 0 and "scoredN" >= 0 and "scoredN" <= "n" and "selectedCount" >= 0 and "selectedCount" <= "scoredN"),
  constraint "CohortMetric_unique_cohort"
    unique ("auditRunId", "cohortKey", "cohortValue")
);

create index if not exists "CohortMetric_auditRunId_idx"
  on public."CohortMetric"("auditRunId");
create index if not exists "CohortMetric_cohort_idx"
  on public."CohortMetric"("cohortKey", "cohortValue");

-- --------------------------------------------
-- What the run found, and where
-- --------------------------------------------
-- One row per finding. "targetType" says which level of the pipeline it is about, which is
-- the roadmap's "decomposition of where in the pipeline a gap appears": a question that is
-- unfair to a cohort is a different problem from a scoring stage that is, and the fix is
-- different too.
--
-- "whatItCannotSay" IS NOT NULL, AND THAT IS THE MOST IMPORTANT COLUMN HERE
-- Feature 3's registry made every signal name its own innocent explanation, and a verify
-- check asserts it is never empty. The rule matters more at this level, not less: a flag
-- that says "this question disadvantages cohort B" without saying "this is also what a
-- cohort that genuinely answered worse looks like" is an accusation against a whole group
-- of people, made by an algorithm, on evidence a reader cannot weigh. The column is
-- required by the database so no future writer can omit it.
--
-- WHY "recommendation" IS PROSE AND NOT AN ACTION
-- The roadmap is explicit that nothing in this product auto-rejects a candidate, and this
-- feature extends that to verdicts on the system: nothing here auto-flags a study as
-- biased, disables a question, or blocks a hire. A flag is a finding for a human to act on,
-- and "recommendation" is a sentence telling them what to look at. There is no status
-- column, no resolution, no approval — because a table that can record "biased: yes" will
-- eventually be read as one.
create table if not exists public."BiasFlag" (
  "id" text primary key default gen_random_uuid()::text,
  "auditRunId" text not null references public."AuditRun"("id") on delete cascade,
  -- 'cohort'   — the selection-rate comparison itself
  -- 'item'     — one question, answered differently by the cohorts
  -- 'dimension'— one of the five scored dimensions
  -- 'stage'    — where in the pipeline the gap appears
  "targetType" text not null,
  -- The question id, dimension name or stage key. Null only for a cohort-level flag, which
  -- is about the cohort rather than one item.
  "targetId" text,
  "cohortKey" text,
  "cohortValue" text,
  -- Short human label, e.g. the question text truncated or the dimension name.
  "label" text,
  "severity" text not null default 'low',
  -- The measured value and the line it crossed.
  "statistic" double precision,
  "threshold" double precision,
  "pValue" double precision,
  -- Null when the flag could not be computed. Present and false with a reason when the test
  -- was attempted and refused, so "no flag" and "no test" stay distinguishable.
  "computable" boolean not null default true,
  "notComputableReason" text,
  -- One sentence stating the finding, written for a person.
  "finding" text not null,
  -- What this finding cannot distinguish. Required; see the note above.
  "whatItCannotSay" text not null,
  "recommendation" text,
  "flaggedAt" timestamptz not null default now(),
  constraint "BiasFlag_targetType_check"
    check ("targetType" in ('cohort', 'item', 'dimension', 'stage')),
  constraint "BiasFlag_severity_check"
    check ("severity" in ('info', 'low', 'medium', 'high')),
  -- A flag must explain itself in both directions, or it is an assertion.
  constraint "BiasFlag_must_explain_check"
    check (length(btrim("finding")) > 0 and length(btrim("whatItCannotSay")) > 0)
);

create index if not exists "BiasFlag_auditRunId_idx"
  on public."BiasFlag"("auditRunId");
create index if not exists "BiasFlag_target_idx"
  on public."BiasFlag"("targetType", "targetId");
create index if not exists "BiasFlag_severity_idx"
  on public."BiasFlag"("severity");

-- --------------------------------------------
-- Every AI-influenced decision, append-only
-- --------------------------------------------
-- The provenance log. If "CohortMetric" is what lets the platform answer "is this system
-- biased", this table is what lets it answer "why did THIS answer get THIS score" — the
-- question GDPR Article 22 entitles a person to ask, and the one the product could not
-- answer at all before now.
--
-- THE PROBLEM THIS TABLE IS SHAPED AROUND
--
-- The AI call and the score's persistence happen in two different HTTP requests, and only
-- one of them knows anything. POST /api/interview makes the model call but is not told
-- which session it belongs to; POST /api/sessions/[id]/save-response knows the session but
-- makes no model call and cannot know what produced the numbers it is handed. Neither
-- request alone can write a row that ties a model decision to a person.
--
-- So a decision is recorded in TWO ROWS, and "phase" says which one this is:
--
--   phase = 'scored'  — written by the model call. Holds the provenance: which model,
--                       which prompt version, a hash of the exact input, and the raw output
--                       including the scores the model returned. Carries a "decisionId" it
--                       generates, and no session.
--
--   phase = 'linked'  — written by the persistence call, when the client echoes that
--                       "decisionId" back. Carries the session and response ids, and the
--                       verification outcome: whether the scores being persisted are the
--                       ones the model actually produced.
--
-- NEITHER ROW IS EVER UPDATED. The correlation id is what joins them, so the second row is
-- an append and not a write-back — which is the only way an append-only log can hold a
-- two-phase record without a mutation path existing to be abused. The service module in
-- app/lib/fairness/decisionLog.ts exports no update and no delete for this table, exactly as
-- the integrity feature does for "IntegrityReviewLog".
--
-- WHY THE VERIFICATION COLUMNS ARE HERE AND NOT SOMEWHERE ELSE
--
-- Before this feature the five scores on "Response" came from the request body, unverified:
-- the candidate's own browser supplied the numbers a hiring decision would rest on, and
-- supplied invented ones whenever the model returned none. A bias audit over
-- candidate-controlled figures is not an audit, so the log records what the model said and
-- the persistence route compares. The verification is recorded, never enforced by
-- rejection: a mismatch is a fact about the row, and refusing the write would break a live
-- interview to make a point.
--
-- "verification" values and what each means:
--   'match'       the persisted scores equal the model's, within tolerance
--   'mismatch'    they do not; "mismatchJSON" holds both, so the difference is inspectable
--   'no_scores'   the decision was traced but the model returned no scores for it
--   'unverified'  no decisionId arrived, so nothing could be traced. The honest label for
--                 an old client, a resumed interview, or a provider that failed.
create table if not exists public."DecisionLog" (
  "id" text primary key default gen_random_uuid()::text,
  -- Minted at the model call and echoed back by the client. The join between the two rows.
  "decisionId" text not null,
  "phase" text not null,
  -- Null on the 'scored' row, because the model call does not know them yet.
  "sessionId" text references public."InterviewSession"("id") on delete cascade,
  "responseId" text references public."Response"("id") on delete cascade,
  -- Known at the model call, so it is on both rows and lets an audit find a study's
  -- decisions without walking through sessions.
  "studyId" text references public."Study"("id") on delete set null,
  "userId" text references public."User"("id") on delete set null,
  "provider" text,
  -- The model ACTUALLY used, resolved at the call site rather than re-derived later from
  -- env vars that may since have changed. This is the field that makes the log evidence.
  "modelId" text,
  -- The prompt version the decision was made under. Same purpose as the integrity
  -- registry version: when the prompt changes, past findings must not be silently
  -- reinterpreted as though they had been produced by the new one.
  "promptVersion" text,
  -- sha256 over a canonical serialisation of the exact input sent. Lets the same input be
  -- recognised later without storing the transcript a second time.
  "inputHash" text,
  -- The raw model output, and the scores extracted from it, kept separately so a reader can
  -- check the extraction as well as the answer.
  "outputJSON" jsonb,
  "scoresJSON" jsonb,
  "verification" text,
  -- Both sides of a mismatch, when there is one.
  "mismatchJSON" jsonb,
  -- When the model decided. Distinct from when the server recorded it, for the same reason
  -- "IntegrityEvent" keeps both: a large gap is itself informative.
  "decidedAt" timestamptz not null default now(),
  "recordedAt" timestamptz not null default now(),
  constraint "DecisionLog_phase_check"
    check ("phase" in ('scored', 'linked')),
  constraint "DecisionLog_verification_check"
    check ("verification" is null or "verification" in ('match', 'mismatch', 'no_scores', 'unverified')),
  -- A 'scored' row is about a model decision and has no session; a 'linked' row is about
  -- where it landed and must name one. Stated as a constraint so the two phases cannot be
  -- written the same way by mistake, which would produce a log whose rows mean nothing.
  constraint "DecisionLog_phase_shape_check"
    check (
      ("phase" = 'scored' and "sessionId" is null and "responseId" is null and "verification" is null)
      or ("phase" = 'linked' and "sessionId" is not null and "verification" is not null)
    ),
  constraint "DecisionLog_model_required_check"
    check ("phase" <> 'scored' or length(btrim(coalesce("modelId", ''))) > 0)
);

create index if not exists "DecisionLog_decisionId_idx"
  on public."DecisionLog"("decisionId");
create index if not exists "DecisionLog_sessionId_idx"
  on public."DecisionLog"("sessionId");
create index if not exists "DecisionLog_studyId_idx"
  on public."DecisionLog"("studyId");
create index if not exists "DecisionLog_phase_decidedAt_idx"
  on public."DecisionLog"("phase", "decidedAt" desc);

-- --------------------------------------------
-- "Response": where its scores came from
-- --------------------------------------------
-- The five score columns were NOT NULL DEFAULT 0, which made two different facts
-- indistinguishable: an answer the model scored 0, and an answer nothing ever scored. The
-- default silently asserted the first for every row the second was true of.
--
-- Dropping NOT NULL lets "not measured" be stored as what it is. The five columns are
-- dropped together because they are always written together — a partial null is not a state
-- this feature produces, and the CHECK below refuses one.
--
-- "scoreSource" says which of three things a row is:
--   'llm'           the scores are the model's, verified against the decision log
--   'unverified'    the scores came from the caller and no model decision could be traced
--   'not_measured'  nothing scored this answer; all five columns are null
--
-- ROWS WRITTEN BEFORE THIS MIGRATION BECOME 'unverified', AND THAT IS THE HONEST LABEL.
-- Their scores may well have been the model's, but nothing recorded it, so nothing can
-- attest to it. The audit excludes them from its distributions rather than assuming they
-- are good — a sample quietly padded with unverifiable numbers is worse than a smaller one.
alter table public."Response"
  add column if not exists "scoreSource" text not null default 'unverified';

alter table public."Response"
  add column if not exists "decisionId" text;

alter table public."Response"
  alter column "technicalScore" drop not null,
  alter column "communicationScore" drop not null,
  alter column "confidenceScore" drop not null,
  alter column "logicScore" drop not null,
  alter column "depthScore" drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'Response_score_source_check'
  ) then
    alter table public."Response"
      add constraint "Response_score_source_check"
      check ("scoreSource" in ('llm', 'unverified', 'not_measured'));
  end if;

  -- A row labelled 'not measured' carries no scores; a row that carries scores is not
  -- labelled 'not measured'. Two clauses rather than a biconditional, so a partial null
  -- (which the service never writes) is refused rather than silently accepted.
  if not exists (
    select 1 from pg_constraint where conname = 'Response_score_source_measured_check'
  ) then
    alter table public."Response"
      add constraint "Response_score_source_measured_check"
      check (
        ("scoreSource" <> 'not_measured' or (
          "technicalScore" is null and "communicationScore" is null and "confidenceScore" is null
          and "logicScore" is null and "depthScore" is null
        ))
        and ("scoreSource" = 'not_measured' or (
          "technicalScore" is not null and "communicationScore" is not null and "confidenceScore" is not null
          and "logicScore" is not null and "depthScore" is not null
        ))
      );
  end if;
end $$;

create index if not exists "Response_decisionId_idx"
  on public."Response"("decisionId");
create index if not exists "Response_scoreSource_idx"
  on public."Response"("scoreSource");
