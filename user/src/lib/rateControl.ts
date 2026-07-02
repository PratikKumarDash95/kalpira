// Small dependency-free rate-control helpers for high-frequency browser events
// (scroll/resize/mousemove) and keystroke-driven input handlers.

/**
 * Throttle: ensures `fn` runs at most once per `waitMs`, on the leading edge,
 * with a trailing call if invocations happened during the wait window.
 * Use for high-frequency events (scroll, resize, mousemove).
 */
export function throttle<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number,
): (...args: Args) => void {
  let lastRun = 0;
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;
  let trailingArgs: Args | null = null;

  return (...args: Args) => {
    const now = Date.now();
    const remaining = waitMs - (now - lastRun);

    if (remaining <= 0) {
      lastRun = now;
      fn(...args);
      return;
    }

    trailingArgs = args;
    if (trailingTimer === null) {
      trailingTimer = setTimeout(() => {
        lastRun = Date.now();
        trailingTimer = null;
        if (trailingArgs) fn(...trailingArgs);
        trailingArgs = null;
      }, remaining);
    }
  };
}

/**
 * Debounce: delays running `fn` until `waitMs` has elapsed since the last call.
 * Use for keystroke-driven handlers (search-as-you-type, live validation).
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number,
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (...args: Args) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
}
