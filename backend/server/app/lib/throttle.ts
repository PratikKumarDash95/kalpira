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
// DISTRIBUTED NOW
// These budgets used to live in a process-local Map, which the header comment
// openly admitted "does not coordinate across instances". That was a real
// ceiling: the moment the backend scaled past one box, every instance held its
// own copy of the counter and a guesser simply round-robined across them. All
// counters now go through `../utils/rateStore` — Upstash Redis when configured,
// a bounded in-memory map otherwise — so the same account budget is enforced
// platform-wide and survives scale-out. Because the store is async (a network
// round trip), the three budget functions are now `async`; every call site
// already lives in an async handler, so they simply `await`.
//
// THE check/penalise SPLIT STILL HOLDS
// `checkBudget` reads without spending; `penalize` spends. That split is
// deliberate and unchanged: a login that succeeds, or a reset request that
// fails password-policy validation before any secret is checked, should not eat
// into a legitimate user's budget.
//
// FAIL-OPEN ON STORE LOSS
// If the shared store is unreachable the limiter degrades to per-instance
// counts (rateStore's own fallback) rather than locking every account out. A
// rate limiter that cannot be reached must not become an availability outage.

// The store is CommonJS; require it directly (runs under tsx / CJS output).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const store = require('../../utils/rateStore');

/** Namespace so account budgets never collide with the IP limiter's keys. */
const PREFIX = 'auth';

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

/** Remaining whole seconds in the current fixed window, mirroring the store. */
function retryAfterInWindow(windowMs: number, now: number): number {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  return Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
}

/**
 * Reads the budget without spending from it.
 *
 * Call this before doing the expensive or consequential part of a request. It
 * does not increment — pair it with `penalize()`, which is what actually spends.
 */
export async function checkBudget(key: string, budget: Budget): Promise<BudgetStatus> {
  const now = Date.now();
  const count = await store.peek(PREFIX, key, budget.windowMs);

  if (count >= budget.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: retryAfterInWindow(budget.windowMs, now),
    };
  }

  return { allowed: true, remaining: budget.limit - count, retryAfterSeconds: 0 };
}

/**
 * Spends one attempt. Call on a failed attempt, or on every request for routes
 * whose cost is the work itself (sending mail).
 */
export async function penalize(key: string, budget: Budget): Promise<void> {
  await store.incr(PREFIX, key, budget.windowMs);
}

/**
 * Forgets an account's history — on a successful sign-in, so ordinary activity
 * never accumulates toward a lockout.
 */
export async function clearBudget(key: string, budget: Budget): Promise<void> {
  await store.del(PREFIX, key, budget.windowMs);
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
  /** Assignment mails per interviewer, counted per recipient. A real batch to
   *  one study's candidates is tens; the loop that sends them re-mails the whole
   *  list on every call, to addresses the caller names, so this is the only
   *  thing standing between a self-service account and an inbox-flooding tool. */
  assignmentEmail: { limit: 100, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, Budget>;

/** A 429 in the shape the rest of the API uses. */
export function tooManyRequests(status: BudgetStatus, message: string) {
  return {
    error: message,
    code: 'RATE_LIMITED',
    retryAfter: status.retryAfterSeconds,
  };
}
