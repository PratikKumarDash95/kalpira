-- ============================================
-- CohortMetric."selectedCount" — a count that may not exist
-- ============================================
-- The audit tables shipped "selectedCount" as `integer not null default 0`, and the service
-- layer wrote a 0 whenever a study declared no selection cutoff. That 0 is a fabricated
-- measurement: with no cutoff there is no bar for a candidate to clear, so "how many were
-- selected" has no answer at all. Stored and read back, it becomes a figure a report prints
-- on a row whose rate honestly says "not computed" — the only number on the row, and so the
-- one a reader would take.
--
-- This is the same rule the feature applies everywhere else, and the reason
-- "selectionRate" is nullable in the table created by 20260923020000: a quantity that does
-- not exist is stored as NULL, never as a plausible-looking figure. The column simply did
-- not follow it. A zero is still written where it is a real one — a known cutoff that
-- nobody cleared, which stays 0 — so this widens the column rather than emptying it.
--
-- WHY A SEPARATE MIGRATION
--
-- The column's NOT NULL and DEFAULT cannot merely be edited out of 20260923020000, because
-- that migration may already have been pushed to a linked project; a database that has run
-- it keeps the constraint, and every insert of a null count would then fail at runtime.
-- Relaxing it here applies correctly whether the earlier migration has already run or runs
-- before this one.
--
-- Run with `supabase db push`, or paste into the Supabase SQL editor.

-- Order matters below. The counts CHECK from the earlier migration requires
-- "selectedCount" to be a non-negative integer, so it has to come off before the backfill
-- writes nulls into the column, and the new pair goes on afterwards.
alter table public."CohortMetric"
  drop constraint if exists "CohortMetric_computable_check",
  drop constraint if exists "CohortMetric_counts_check";

alter table public."CohortMetric"
  alter column "selectedCount" drop not null,
  alter column "selectedCount" drop default;

-- Existing rows written by the previous revision.
--
-- Only the no-cutoff zeros are cleared. The clause is deliberately narrow: an uncomputable
-- row very often carries a *real* zero — a cohort refused for having too few scored answers
-- may genuinely have had none of them clear the cutoff — and nulling those would destroy
-- measurements to fix a fabrication. "computable = false" alone cannot tell the two apart,
-- and neither can the count, which is 0 for both.
--
-- That leaves the refusal reason as the only signal, matched on the one phrase the service
-- emits for this case (statistics.ts, the selectionThreshold === null branch). Matching on
-- prose is a poor foundation and is used here only because this is a one-time repair of
-- rows already written: every new row is constrained by the CHECKs below instead, so nothing
-- downstream has to interpret the text again.
update public."CohortMetric"
   set "selectedCount" = null
 where "computable" = false
   and "selectedCount" = 0
   and "notComputableReason" ilike '%no selection cutoff%';

-- The central invariant, restored with the count folded into the computable half.
--
-- "selectedCount" belongs there because a cohort is computable only after the cutoff guard
-- has passed: a cutoff is exactly what makes the count exist, so a computable row always has
-- one, and its absence is the no-cutoff case. Writing it into the biconditional keeps that
-- coupling enforced by the database rather than trusted to the service layer — which is the
-- point of the constraint it replaces.
alter table public."CohortMetric"
  add constraint "CohortMetric_computable_check"
    check (
      ("computable" = true and "selectionRate" is not null and "selectedCount" is not null and "notComputableReason" is null)
      or ("computable" = false and "selectionRate" is null and "notComputableReason" is not null)
    );

-- Bounds still apply to a count that exists, and are skipped for one that does not.
alter table public."CohortMetric"
  add constraint "CohortMetric_counts_check"
    check (
      "n" >= 0
      and "scoredN" >= 0
      and "scoredN" <= "n"
      and ("selectedCount" is null or ("selectedCount" >= 0 and "selectedCount" <= "scoredN"))
    );
