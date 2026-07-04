-- Role-scoped identity
-- ---------------------------------------------------------------------------
-- One email may now own TWO independent accounts: a candidate ("user") and an
-- interviewer. Previously "email" was globally unique and (oauthProvider,
-- oauthId) was globally unique, so a single Google account / email could only
-- ever back ONE row — which forced "log in as user" to land on the interviewer
-- dashboard. We replace both global constraints with role-scoped composites.
--
-- No data backfill is required: email was globally unique before, so there can
-- be no existing (email, role) collisions.

-- Drop the global single-column email uniqueness (auto-named "User_email_key").
alter table public."User" drop constraint if exists "User_email_key";

-- Drop the global oauth identity uniqueness (auto-named
-- "User_oauthProvider_oauthId_key") so the same Google account can back both a
-- candidate and an interviewer row.
alter table public."User" drop constraint if exists "User_oauthProvider_oauthId_key";

-- Add role-scoped composite uniqueness.
alter table public."User"
  add constraint "User_email_role_key" unique ("email", "role");

alter table public."User"
  add constraint "User_oauthProvider_oauthId_role_key" unique ("oauthProvider", "oauthId", "role");

-- Keep the email index for fast role-scoped lookups (created in init schema).
create index if not exists "User_email_idx" on public."User" ("email");
