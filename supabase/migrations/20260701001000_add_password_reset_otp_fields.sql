alter table public."User"
  add column if not exists "passwordResetOtp" text,
  add column if not exists "passwordResetOtpSentAt" timestamptz,
  add column if not exists "passwordResetOtpExpiresAt" timestamptz;

create index if not exists "User_passwordResetOtpExpiresAt_idx"
  on public."User" ("passwordResetOtpExpiresAt");
