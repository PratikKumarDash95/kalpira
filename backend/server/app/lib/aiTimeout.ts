// ============================================
// AI request timeout guard
// ============================================
//
// WHY THIS EXISTS
// Every AI call used to be awaited with no ceiling of its own on the request
// path. A provider that hangs (upstream stall, a rate-limited Gemini socket
// that neither resolves nor errors) would hold the whole HTTP request open
// indefinitely. On a single-process Node backend that is fatal under load:
// thousands of concurrent interviews each pinned to a stuck provider call
// exhaust sockets and memory long before the CPU matters. This wraps a
// provider call in a wall-clock budget and resolves with a caller-supplied
// fallback when the budget runs out, so the request always returns and the
// event loop is freed.
//
// WHAT IT DOES NOT DO
// The Gemini/Claude SDKs here do not expose an abort handle we can thread
// through, so the underlying upstream promise keeps running to completion in
// the background. That is acceptable: the point is to stop the *client request*
// from being pinned and to hand the candidate a usable turn, not to reclaim the
// upstream socket mid-flight. The provider's own internal timeout (see the
// Ollama/Claude clients) is what eventually releases that socket.
//
// LOCAL / SLOW PROVIDERS
// Ollama runs local inference that can legitimately take minutes on CPU, so it
// is exempted — capping it would break the offline mode this platform supports.
// The cloud providers (gemini/claude), which are the ones carrying concurrent
// traffic, get the hard budget.

/** Default wall-clock budget for a cloud AI turn. Comfortably under host limits. */
export const DEFAULT_AI_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS || 45_000);

export class AITimeoutError extends Error {
  constructor(ms: number) {
    super(`AI provider did not respond within ${ms}ms.`);
    this.name = 'AITimeoutError';
  }
}

/**
 * Resolve `work` within `timeoutMs`, or resolve `fallback` when the budget
 * expires. Never rejects on timeout — the caller always gets a value it can
 * return, which is the whole reason this exists on the live interview path.
 *
 * A provider that *throws* on its own still propagates, so a genuine error is
 * not silently swallowed into a fallback; only a stall triggers the timeout.
 */
export async function withAiTimeout<T>(
  work: Promise<T>,
  fallback: T,
  timeoutMs: number = DEFAULT_AI_TIMEOUT_MS,
): Promise<T> {
  // A non-positive budget means "no cap" (used for the Ollama local path).
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return work;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), timeoutMs);
  });

  try {
    // `work` rejection still propagates via the await below, since racing a
    // rejection against a never-resolving fallback surfaces the rejection.
    return await Promise.race([work, budget]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
