alter table public."User"
  add column if not exists "emailVerifiedAt" timestamptz,
  add column if not exists "emailVerificationToken" text,
  add column if not exists "emailVerificationSentAt" timestamptz;

create index if not exists "User_emailVerificationToken_idx"
  on public."User" ("emailVerificationToken");
