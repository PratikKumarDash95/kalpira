-- Candidate → interviewer feedback for a completed interview.
-- A candidate who takes an assigned interview can rate the experience (1-5)
-- and leave a comment. interviewerId is denormalized from the study owner so
-- the admin console can aggregate feedback per interviewer without extra joins.

create table if not exists public."InterviewFeedback" (
  "id" text primary key default gen_random_uuid()::text,
  "sessionId" text references public."InterviewSession"("id") on delete set null,
  "studyId" text references public."Study"("id") on delete set null,
  "interviewerId" text references public."User"("id") on delete cascade,
  "candidateName" text,
  "candidateEmail" text,
  "rating" integer not null default 0,
  "comment" text,
  "createdAt" timestamptz not null default now()
);

create index if not exists "InterviewFeedback_interviewerId_idx" on public."InterviewFeedback"("interviewerId");
create index if not exists "InterviewFeedback_studyId_idx" on public."InterviewFeedback"("studyId");
create index if not exists "InterviewFeedback_sessionId_idx" on public."InterviewFeedback"("sessionId");
-- One feedback row per session (a candidate rates a given interview once).
create unique index if not exists "InterviewFeedback_sessionId_key" on public."InterviewFeedback"("sessionId");
