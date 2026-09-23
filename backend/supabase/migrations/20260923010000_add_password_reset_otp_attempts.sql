-- ============================================
-- Password-reset OTP attempt counter
-- ============================================
--
-- `api/auth/reset-password` accepted unlimited guesses against a 6-digit code.
-- A six-digit space is a million values; with no counter and no throttle, a
-- script walks the whole space inside the 15-minute validity window and the
-- reward is a password reset — full account takeover, on any account whose
-- email address is known.
--
-- The counter lives on the row rather than only in process memory because the
-- attack that matters here is distributed: a single-process limiter is escaped
-- by guessing from many addresses at once, and is cleared outright by a restart.
-- What bounds the guess count for one account has to be durable and per-account.
--
-- Not nullable, defaulted to 0: every existing row is a row with no in-flight
-- reset, which is exactly zero attempts.
--
-- Read-modify-write, so two simultaneous guesses can each read the same value
-- and both write the same increment — the counter can lose a race and allow a
-- few extra guesses under concurrency. That is a rounding error against 10^6 and
-- not worth a serialized transaction here; the point is that the count is
-- bounded, not that it is exact.

alter table public."User"
  add column if not exists "passwordResetOtpAttempts" integer not null default 0;
