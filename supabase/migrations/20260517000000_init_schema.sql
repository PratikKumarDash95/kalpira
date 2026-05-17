-- Kalpira Supabase schema
-- Run this once in the Supabase SQL editor, or with:
-- supabase db push

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public."User" (
  "id" text primary key default gen_random_uuid()::text,
  "email" text unique,
  "name" text,
  "avatarUrl" text,
  "password" text,
  "oauthProvider" text,
  "oauthId" text,
  "encryptedGeminiApiKey" text,
  "encryptedAnthropicApiKey" text,
  "role" text not null default 'candidate',
  "onboardingComplete" boolean not null default false,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("oauthProvider", "oauthId")
);

create table if not exists public."Resume" (
  "id" text primary key default gen_random_uuid()::text,
  "userId" text not null unique references public."User"("id") on delete cascade,
  "fileName" text,
  "rawText" text,
  "parsedSkills" text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table if not exists public."Skill" (
  "id" text primary key default gen_random_uuid()::text,
  "name" text not null unique,
  "category" text,
  "createdAt" timestamptz not null default now()
);

create table if not exists public."UserSkill" (
  "id" text primary key default gen_random_uuid()::text,
  "userId" text not null references public."User"("id") on delete cascade,
  "skillId" text not null references public."Skill"("id") on delete cascade,
  "proficiencyScore" double precision not null default 0,
  "weaknessCount" integer not null default 0,
  "lastUpdated" timestamptz not null default now(),
  unique ("userId", "skillId")
);

create table if not exists public."Study" (
  "id" text primary key default gen_random_uuid()::text,
  "userId" text references public."User"("id") on delete set null,
  "configJSON" text not null,
  "interviewCount" integer not null default 0,
  "isLocked" boolean not null default false,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table if not exists public."StoredInterview" (
  "id" text primary key default gen_random_uuid()::text,
  "studyId" text not null references public."Study"("id") on delete cascade,
  "userId" text references public."User"("id") on delete set null,
  "studyName" text not null default 'Unknown Study',
  "transcriptJSON" text not null,
  "participantProfileJSON" text,
  "synthesisJSON" text,
  "behaviorDataJSON" text,
  "status" text not null default 'completed',
  "createdAt" timestamptz not null default now(),
  "completedAt" timestamptz not null default now()
);

create table if not exists public."InterviewSession" (
  "id" text primary key default gen_random_uuid()::text,
  "userId" text not null references public."User"("id") on delete cascade,
  "role" text not null,
  "difficulty" text not null,
  "mode" text not null,
  "startedAt" timestamptz not null default now(),
  "completedAt" timestamptz,
  "averageScore" double precision not null default 0,
  "studyId" text references public."Study"("id") on delete set null,
  "candidateName" text,
  "candidateEmail" text
);

create table if not exists public."Question" (
  "id" text primary key default gen_random_uuid()::text,
  "sessionId" text not null references public."InterviewSession"("id") on delete cascade,
  "text" text not null,
  "difficulty" text not null,
  "category" text not null,
  "createdAt" timestamptz not null default now()
);

create table if not exists public."Response" (
  "id" text primary key default gen_random_uuid()::text,
  "sessionId" text not null references public."InterviewSession"("id") on delete cascade,
  "questionId" text not null references public."Question"("id") on delete cascade,
  "answerText" text not null,
  "technicalScore" double precision not null default 0,
  "communicationScore" double precision not null default 0,
  "confidenceScore" double precision not null default 0,
  "logicScore" double precision not null default 0,
  "depthScore" double precision not null default 0,
  "feedback" text,
  "idealAnswer" text,
  "improvementTip" text,
  "createdAt" timestamptz not null default now()
);

create table if not exists public."ScoreBreakdown" (
  "id" text primary key default gen_random_uuid()::text,
  "sessionId" text not null unique references public."InterviewSession"("id") on delete cascade,
  "overallScore" double precision not null default 0,
  "technicalAverage" double precision not null default 0,
  "communicationAverage" double precision not null default 0,
  "confidenceAverage" double precision not null default 0,
  "logicAverage" double precision not null default 0,
  "depthAverage" double precision not null default 0,
  "createdAt" timestamptz not null default now()
);

create table if not exists public."WeakSkillMemory" (
  "id" text primary key default gen_random_uuid()::text,
  "userId" text not null references public."User"("id") on delete cascade,
  "skillName" text not null,
  "weaknessCount" integer not null default 1,
  "lastOccurredAt" timestamptz not null default now(),
  unique ("userId", "skillName")
);

create table if not exists public."ImprovementPlan" (
  "id" text primary key default gen_random_uuid()::text,
  "userId" text not null references public."User"("id") on delete cascade,
  "planJSON" text not null,
  "generatedAt" timestamptz not null default now()
);

create table if not exists public."Badge" (
  "id" text primary key default gen_random_uuid()::text,
  "userId" text not null references public."User"("id") on delete cascade,
  "badgeName" text not null,
  "awardedAt" timestamptz not null default now(),
  unique ("userId", "badgeName")
);

create table if not exists public."ReadinessIndex" (
  "id" text primary key default gen_random_uuid()::text,
  "userId" text not null unique references public."User"("id") on delete cascade,
  "readinessScore" double precision not null default 0,
  "calculatedAt" timestamptz not null default now()
);

create index if not exists "User_email_idx" on public."User"("email");
create index if not exists "UserSkill_userId_idx" on public."UserSkill"("userId");
create index if not exists "UserSkill_skillId_idx" on public."UserSkill"("skillId");
create index if not exists "Study_userId_idx" on public."Study"("userId");
create index if not exists "StoredInterview_studyId_idx" on public."StoredInterview"("studyId");
create index if not exists "StoredInterview_userId_idx" on public."StoredInterview"("userId");
create index if not exists "StoredInterview_status_idx" on public."StoredInterview"("status");
create index if not exists "InterviewSession_userId_idx" on public."InterviewSession"("userId");
create index if not exists "InterviewSession_userId_startedAt_idx" on public."InterviewSession"("userId", "startedAt");
create index if not exists "InterviewSession_studyId_idx" on public."InterviewSession"("studyId");
create index if not exists "Question_sessionId_idx" on public."Question"("sessionId");
create index if not exists "Question_category_idx" on public."Question"("category");
create index if not exists "Response_sessionId_idx" on public."Response"("sessionId");
create index if not exists "Response_questionId_idx" on public."Response"("questionId");
create index if not exists "WeakSkillMemory_userId_idx" on public."WeakSkillMemory"("userId");
create index if not exists "ImprovementPlan_userId_idx" on public."ImprovementPlan"("userId");
create index if not exists "Badge_userId_idx" on public."Badge"("userId");

drop trigger if exists "User_set_updated_at" on public."User";
create trigger "User_set_updated_at"
before update on public."User"
for each row execute function public.set_updated_at();

drop trigger if exists "Resume_set_updated_at" on public."Resume";
create trigger "Resume_set_updated_at"
before update on public."Resume"
for each row execute function public.set_updated_at();

drop trigger if exists "Study_set_updated_at" on public."Study";
create trigger "Study_set_updated_at"
before update on public."Study"
for each row execute function public.set_updated_at();

-- Server routes should use SUPABASE_SERVICE_ROLE_KEY.
-- RLS is intentionally not enabled here because this app currently performs
-- database access through server-side route handlers.
