// ============================================
// AI Turn Budget — post-auth, per-identity rate brake
// ============================================
//
// The per-IP middleware limiter (utils/rateLimiter.js) is the first line of
// defence, but it runs BEFORE the participant token is verified, so it can only
// key on the source address. This module is the complement: it runs INSIDE the
// /api/interview handler, once the token has been verified, and bounds the turn
// rate by the *authenticated* identity — the dimension a per-IP counter cannot
// see and that a distributed guesser cannot rotate.
//
// WHY THE KEY DEPENDS ON WHAT THE LINK PROVES
//   · An assignment link is minted for one named candidate, so the verified
//     candidate email is a stable, per-person key. A single abusive script
//     client sharing an address gets stopped by this even when the shared per-IP
//     budget would not, and honest candidates never trip it because the limit is
//     far above human turn-taking.
//   · A study-wide link carries no candidate identity — many people legitimately
//     hold the same token. Keying them together and using a tight ceiling would
//     throttle the whole cohort the moment a study goes live at scale, so those
//     links get a deliberately high ceiling that only catches a runaway script,
//     while the coarse per-IP limiter remains the real bound for anonymous share.
//
// Fails open: a store error must never deny a candidate mid-interview.

const store = require('../../utils/rateStore');

const PREFIX = 'ai-turn';

// Turn windows and ceilings are env-tunable so launch day can widen them
// without a redeploy. All defaults sit far above a human answering pace.
const WINDOW_MS = Number(process.env.AI_TURN_WINDOW_MS || 60_000);
// Assigned (per-person) candidate: a person speaks roughly one turn per 20–60s,
// so 20/min is ~an order of magnitude above any honest pace.
const PER_CANDIDATE_LIMIT = Number(process.env.AI_TURN_PER_CANDIDATE_LIMIT || 20);
// Admin preview: same reasoning, an interviewer probing their own study.
const PER_ADMIN_LIMIT = Number(process.env.AI_TURN_PER_ADMIN_LIMIT || 30);
// Shared study-wide link (no per-candidate identity): a pure runaway brake, set
// high enough that a full concurrent cohort never trips it — per-IP is the real
// ceiling for this case.
const PER_LINK_LIMIT = Number(process.env.AI_TURN_PER_LINK_LIMIT || 300);

function shortHash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export interface InterviewTurnInput {
  isAdmin?: boolean;
  studyId?: string | null;
  candidateEmail?: string | null;
  bearerToken?: string;
}

export interface TurnBudget {
  ok: boolean;
  retryAfter: number;
  /** Echoed for logging only — never surfaced to the client. */
  key: string;
  limit: number;
}

export async function enforceInterviewTurnBudget(input: InterviewTurnInput): Promise<TurnBudget> {
  const email = (input.candidateEmail || '').trim().toLowerCase();
  let key: string;
  let limit: number;

  if (email) {
    // Verified per-candidate identity — tight ceiling.
    key = `cand:${input.studyId ?? 'na'}:${email}`;
    limit = PER_CANDIDATE_LIMIT;
  } else if (input.isAdmin) {
    key = `admin:${input.studyId ?? 'na'}:${shortHash(input.bearerToken || 'na')}`;
    limit = PER_ADMIN_LIMIT;
  } else {
    // Shared study-wide link — coarse runaway brake, high ceiling.
    key = `link:${input.studyId ?? 'na'}:${shortHash(input.bearerToken || 'na')}`;
    limit = PER_LINK_LIMIT;
  }

  try {
    const count = await store.incr(PREFIX, key, WINDOW_MS);
    if (count > limit) {
      const now = Date.now();
      const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
      const retryAfter = Math.max(1, Math.ceil((windowStart + WINDOW_MS - now) / 1000));
      return { ok: false, retryAfter, key, limit };
    }
    return { ok: true, retryAfter: 0, key, limit };
  } catch (err) {
    // Fail open — never deny an in-progress interview because the counter store
    // is unreachable.
    console.error('[aiBudget] turn budget check failed, failing open:', err);
    return { ok: true, retryAfter: 0, key, limit };
  }
}
