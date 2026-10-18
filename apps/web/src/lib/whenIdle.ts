/**
 * Runs `run` once the browser has nothing more urgent to do, and returns the
 * function that cancels it.
 *
 * For work a page wants done soon but not now: a read nobody is looking at
 * yet, or a chunk worth warming before it is asked for. Left on the first
 * frame it competes with hydration and the page's own requests for the main
 * thread and the network.
 *
 * `timeoutMs` caps the wait on a page that never goes idle. Safari has no
 * `requestIdleCallback`, so there it is a short timer instead, which still
 * lands after the current burst of effects.
 */
export function whenIdle(run: () => void, timeoutMs = 2000): () => void {
  if (typeof window === "undefined") return () => {};
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(() => run(), { timeout: timeoutMs });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(run, IDLE_FALLBACK_MS);
  return () => window.clearTimeout(handle);
}

/** Where there is no idle callback: long enough to clear the mount's effects and first requests. */
const IDLE_FALLBACK_MS = 200;
