-- ============================================
-- Feature 4, part 2 — the human-review path
-- ============================================
-- One table. Purely additive. No existing table is touched.
--
-- WHY THIS EXISTS SEPARATELY FROM EVERYTHING IN PART 1
--
-- The design cites GDPR Article 22 as the rationale for the candidate-facing explanation
-- page and the human-review path, and it is careful about what that citation means:
-- Kalpira SCORES but does not DECIDE, so Art. 22's right not to be subject to a decision
-- based solely on automated processing is not the claim being made here. What is being
-- built is the thing the article points at — a person can ask a person to look.
--
-- That request is a different kind of fact from everything in "DecisionLog", which is why
-- it is not a row there. The log is a record of what the MODEL did: it is append-only, its
-- `phase` check admits only 'scored' and 'linked', and its whole value as evidence comes
-- from the fact that no human hand ever touches it. A candidate asking for a review is a
-- human act with a lifecycle — open, answered, closed — and putting it in the provenance
-- log would mean the one table that must never be updated is the table that has to be.
--
-- THERE IS NO COLUMN HERE FOR A DECISION, A SCORE, OR A VERDICT
--
-- Deliberately. A review row records that a review was asked for and what the candidate
-- said they were contesting. It does not record an outcome score, because the outcome of a
-- human review is a human's judgement, and a table with an "outcome" column is a table the
-- next feature computes a rate from. "resolutionNote" is prose for the candidate to read,
-- and "status" is where the request is in a queue — not what anyone concluded about them.
--
-- The non-negotiable holds here too: filing a review request changes nothing about the
-- candidate's scores, their session, or their standing. Nothing auto-rejects, and nothing
-- auto-accepts either.

create table if not exists public."ReviewRequest" (
  "id" text primary key default gen_random_uuid()::text,
  -- The interview whose scoring is being contested. Required: a review request is always
  -- about something specific, and a row that named nothing could not be answered.
  "sessionId" text not null references public."InterviewSession"("id") on delete cascade,
  -- Denormalised from the session, as on "DecisionLog", so the study's open requests can
  -- be listed without walking through every session in it.
  "studyId" text references public."Study"("id") on delete set null,
  "userId" text references public."User"("id") on delete set null,
  -- Narrowed to one answer when the candidate points at one; null when they contest the
  -- session as a whole. Both are legitimate, so neither is defaulted into the other.
  "responseId" text references public."Response"("id") on delete set null,
  -- The candidate's own words, and the only free text in this table. Optional, because a
  -- candidate is entitled to ask for a review without justifying it, and a required field
  -- would be a barrier placed in front of a right.
  "reason" text,
  "status" text not null default 'open',
  "requestedAt" timestamptz not null default now(),
  -- Who the request is assigned to, when a reviewer picks it up.
  "assignedTo" text,
  -- Set together with a terminal status, and null until then. A closed request always says
  -- when it closed; an open one never claims to have.
  "resolvedAt" timestamptz,
  "resolvedBy" text,
  "resolutionNote" text,

  constraint "ReviewRequest_status_check"
    check ("status" in ('open', 'in_review', 'resolved', 'declined')),

  -- An empty reason is a stored non-answer. Null says "the candidate did not say"; '' would
  -- say "the candidate said nothing", and those are the same thing written two ways.
  constraint "ReviewRequest_reason_shape_check"
    check ("reason" is null or length(btrim("reason")) > 0),

  -- The coupling the whole file is in service of: a terminal status and a resolution
  -- timestamp are one fact, stated at the column level so no service layer can forget it.
  constraint "ReviewRequest_resolution_shape_check"
    check (
      ("status" in ('resolved', 'declined'))
      = ("resolvedAt" is not null and "resolvedBy" is not null)
    )
);

create index if not exists "ReviewRequest_sessionId_idx"
  on public."ReviewRequest"("sessionId");

-- The queue the reviewer works from: open items, oldest first.
create index if not exists "ReviewRequest_status_requestedAt_idx"
  on public."ReviewRequest"("status", "requestedAt" asc);

-- One live request per interview. A candidate who taps twice, or reloads and taps again,
-- has asked once — and a second row would make "how many candidates asked for a review"
-- depend on how many times a button was pressed.
create unique index if not exists "ReviewRequest_one_live_per_session"
  on public."ReviewRequest"("sessionId")
  where "status" in ('open', 'in_review');
