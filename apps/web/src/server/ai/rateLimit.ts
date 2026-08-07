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
