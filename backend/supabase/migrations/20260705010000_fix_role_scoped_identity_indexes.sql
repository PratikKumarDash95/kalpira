-- Fix role-scoped identity (indexes, not constraints)
-- ---------------------------------------------------------------------------
-- The previous migration (20260705000000_role_scoped_identity.sql) tried to
-- remove the global email / oauth uniqueness with `ALTER TABLE ... DROP
-- CONSTRAINT`. But these were created by Prisma as UNIQUE INDEXES named
-- "User_email_key" / "User_oauthProvider_oauthId_key" — NOT table constraints —
-- so DROP CONSTRAINT was a silent no-op and the global uniqueness survived.
--
-- Effect of the bug: one email could still back only ONE row, so Google
-- sign-in for an email that already owns an interviewer account failed to
-- create the candidate account (23505 duplicate key on "User_email_key") and
-- surfaced as "Sign-in failed. Please try again."
--
-- This migration drops the leftover global unique INDEXES and (idempotently)
-- adds the intended role-scoped composite uniqueness. Safe with no backfill:
-- email was globally unique until now, so no (email, role) duplicates can
-- exist. NULL oauthId rows (password users) don't collide — Postgres treats
-- NULLs as distinct in unique indexes.

-- 1) Drop the leftover GLOBAL unique indexes (the real blockers).
drop index if exists public."User_email_key";
drop index if exists public."User_oauthProvider_oauthId_key";

-- 2) Add role-scoped composite uniqueness, only if not already present.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'User_email_role_key'
  ) then
    alter table public."User"
      add constraint "User_email_role_key" unique ("email", "role");
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'User_oauthProvider_oauthId_role_key'
  ) then
    alter table public."User"
      add constraint "User_oauthProvider_oauthId_role_key"
      unique ("oauthProvider", "oauthId", "role");
  end if;
end $$;

-- 3) Keep the fast email lookup index (non-unique) used by role-scoped queries.
create index if not exists "User_email_idx" on public."User" ("email");
