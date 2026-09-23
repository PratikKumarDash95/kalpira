// ============================================
// throttle.ts — per-account attempt budgets for the auth routes
// ============================================
//
// The IP limiter in `server/utils/rateLimiter.js` is mounted on the auth paths
// and handles one dimension: how fast a single address may hit the API. It
// cannot handle the dimension that matters most here, because the thing being
// attacked is an *account*, not a connection. A distributed guesser spreads
// attempts across thousands of addresses, each one staying politely under any
// per-IP limit, and all of them aimed at the same mailbox. The only counter that
// bounds that is one keyed by the account.
//
// So: this module is the account dimension, and the Express limiter is the
// address dimension. Both are needed; neither is sufficient.
//
// WHAT THIS IS NOT
//
// It is a fixed-window counter held in process memory. It does not survive a
// restart, and it does not coordinate across instances. That is a real limit and
// it is why the password-reset path does NOT rely on this alone: the guess count
// for a reset OTP is also written to the user row (see
// `passwordResetOtpAttempts`), because a restart must not hand an attacker a
// fresh million guesses. For the other routes here — login, mail-sending — a
// process-local budget is proportionate: it raises the cost of the cheap attacks
// (password guessing, inbox flooding) by orders of magnitude without pretending
// to be a distributed rate limiter.
//
// MEMORY SAFETY
//
// Keys contain caller-supplied text (an email address), so an attacker can mint
// keys at will and grow the map without bound. Every insert therefore goes
// through a cap: expired entries are swept, and if the map is still full the
// oldest key is evicted. The map has a hard ceiling either way.

interface Bucket {
  count: number;
  windowStart: number;
}

/** Hard ceiling on tracked keys. Past this, the oldest key is evicted. */
const MAX_KEYS = 20_000;

const buckets = new Map<string, Bucket>();

/** Run a full sweep at most once per this many calls, to keep the hot path cheap. */
const SWEEP_INTERVAL_CALLS = 500;
let callsSinceSweep = 0;

function sweep(now: number, windowMs: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > windowMs) buckets.delete(key);
  }
}

function evictIfFull(now: number, windowMs: number): void {
  callsSinceSweep += 1;
  if (callsSinceSweep >= SWEEP_INTERVAL_CALLS) {
    callsSinceSweep = 0;
    sweep(now, windowMs);
  }

  while (buckets.size >= MAX_KEYS) {
    // Map iterates in insertion order, so this is the oldest key.
    const oldest = buckets.keys().next();
    if (oldest.done) return;
    buckets.delete(oldest.value);
  }
}

export interface Budget {
  /** Attempts permitted inside one window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface BudgetStatus {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

function bucketFor(key: string, budget: Budget, now: number): Bucket {
  const existing = buckets.get(key);
  if (existing && now - existing.windowStart <= budget.windowMs) return existing;
  return { count: 0, windowStart: now };
}

/**
 * Reads the budget without spending from it.
 *
 * Call this before doing the expensive or consequential part of a request. It
 * does not increment — pair it with `penalize()`, which is what actually spends.
 * That split is deliberate: a login that succeeds, or a reset request that fails
 * password-policy validation before any secret is checked, should not eat into a
 * legitimate user's budget.
 */
export function checkBudget(key: string, budget: Budget): BudgetStatus {
  const now = Date.now();
  const bucket = bucketFor(key, budget, now);

  if (bucket.count >= budget.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.windowStart + budget.windowMs - now) / 1000)),
    };
  }

  return { allowed: true, remaining: budget.limit - bucket.count, retryAfterSeconds: 0 };
}

/**
 * Spends one attempt. Call on a failed attempt, or on every request for routes
 * whose cost is the work itself (sending mail).
 */
export function penalize(key: string, budget: Budget): void {
  const now = Date.now();
  evictIfFull(now, budget.windowMs);

  const bucket = bucketFor(key, budget, now);
  bucket.count += 1;
  buckets.set(key, bucket);
}

/**
 * Forgets an account's history — on a successful sign-in, so ordinary activity
 * never accumulates toward a lockout.
 */
export function clearBudget(key: string): void {
  buckets.delete(key);
}

/**
 * The key for an account-scoped budget. Role is part of it because one address
 * can own a candidate and an interviewer account separately, and a budget spent
 * guessing at one must not lock the owner out of the other.
 */
export function accountKey(scope: string, role: string, email: string): string {
  return `${scope}:${role}:${email.trim().toLowerCase()}`;
}

/** Shared budgets. Tuned to be invisible to a person, expensive for a script. */
export const BUDGETS = {
  /** Failed sign-ins per account. A person mistyping is nowhere near ten. */
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
  /** Reset codes checked per account, on top of the durable row counter. */
  resetOtp: { limit: 10, windowMs: 15 * 60 * 1000 },
  /** Reset mails sent per account. One is normal; three is someone reloading. */
  forgotPassword: { limit: 3, windowMs: 15 * 60 * 1000 },
  /** Verification mails sent per account. */
  resendVerification: { limit: 3, windowMs: 15 * 60 * 1000 },
  /** Sign-up attempts per address — stops scripted account creation and the
   *  verification-mail flood that rides on it. */
  register: { limit: 5, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, Budget>;

/** A 429 in the shape the rest of the API uses. */
export function tooManyRequests(status: BudgetStatus, message: string) {
  return {
    error: message,
    code: 'RATE_LIMITED',
    retryAfter: status.retryAfterSeconds,
  };
}
