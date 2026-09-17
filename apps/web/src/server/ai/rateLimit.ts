// Sequential map with a minimum gap between calls (KI-15).
//
// Deliberately simpler than a token-bucket limiter: it sleeps `minIntervalMs`
// BETWEEN calls rather than tracking a wall clock, so the real spacing is
// `minIntervalMs + taskDuration` — slightly more conservative than the vendor
// requires. That conservatism is free here (we are already inside a
// multi-second AI request) and it buys a runner with no clock to inject, no
// drift, and no timer left pending if a task throws.
//
// `sleep` is injected so tests neither wait nor need fake timers.

/**
 * **The vendor's pace, in one place.**
 *
 * LocationIQ's free tier is 5,000/day but capped at 2 requests/second, and the
 * per-second limit is the one that actually binds on a 9-name itinerary — it is
 * what broke the 2026-08-02 dogfood run and the reason this module exists.
 *
 * It lives here rather than in `geocodeEnrichment.ts`, where it was, because
 * M9's grounding gave the key a second caller: `search_places` throttles to the
 * same vendor through the same limiter, and two constants for one vendor's one
 * limit is a pair that agrees until somebody edits either.
 */
export const REQUESTS_PER_SECOND = 2;
export const MIN_INTERVAL_MS = 1000 / REQUESTS_PER_SECOND;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function mapRateLimited<T, R>(
  items: readonly T[],
  minIntervalMs: number,
  task: (item: T) => Promise<R>,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<R[]> {
  const results: R[] = [];
  for (const [index, item] of items.entries()) {
    if (index > 0) await sleep(minIntervalMs);
    results.push(await task(item));
  }
  return results;
}
