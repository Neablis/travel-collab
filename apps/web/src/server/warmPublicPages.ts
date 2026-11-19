// Read every public page once, right after the server starts and once a day
// after that, so a crawler's visit finds the page already cached and the
// database stays asleep (2026-11-19).
//
// Why: the data cache (`libraryCache.ts`) starts empty on every deploy, by
// design (its key carries the deployment), and its entries last a day. The
// library is several hundred URLs (every published day, place, tag and length
// page in `/sitemap.xml`), and crawlers walk it one URL every few minutes.
// Each first visit read Postgres, so Neon never saw the five idle minutes it
// needs to suspend: awake about 23 of 24 hours on 2026-11-17 and 11-18.
// Once the cache had filled, with no deploy for a day, it slept about three
// hours. Reading the whole sitemap in one go spends a few minutes of database
// time at start instead of a trickle all day.
//
// It asks this server, not the public origin: through Cloudflare a page the
// edge already holds would answer without reaching the server, and the
// server's own cache would stay empty for the next edge location that asks.
// No cookie is sent, so every page is read as a signed-out visitor reads it,
// which is the copy that is cached. Production only (`APP_ENV`): a preview or
// staging database has nobody to keep asleep for, and the test lanes read live.

import { deployEnv } from "@/lib/deployment/env";
import { LIBRARY_CACHE_SECONDS } from "./libraryCache";

/** What one warm-up did, for the log line. */
export interface WarmResult {
  readonly pages: number;
  readonly ok: number;
  readonly failed: number;
  readonly ms: number;
}

/** Pages read at once. Two keeps a warm-up from crowding out a visitor's request. */
export const WARM_CONCURRENCY = 2;

/** The User-Agent a warm-up's requests carry, so they can be told apart in a log. */
export const WARM_USER_AGENT = "caesura-cache-warmup";

/** How often the warm-up runs again: just past an entry's lifetime, so a day's stale entries are all read again together. */
export const REWARM_MS = (LIBRARY_CACHE_SECONDS + 10 * 60) * 1000;

/** How long to wait for the server to answer its health check before giving up on this start's warm-up. */
const HEALTH_WAIT_MS = 2 * 60 * 1000;
const HEALTH_POLL_MS = 2000;

/**
 * Every page a sitemap lists, as a path with its query, each once, in the
 * sitemap's order. The origin is dropped: the sitemap names the public origin,
 * and the warm-up asks this server.
 */
export function sitemapPaths(xml: string): string[] {
  const paths: string[] = [];
  for (const match of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)) {
    const raw = match[1]!.replaceAll("&amp;", "&");
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    const path = `${url.pathname}${url.search}`;
    if (!paths.includes(path)) paths.push(path);
  }
  return paths;
}

/**
 * Read the sitemap at `base` and then every page it lists, `WARM_CONCURRENCY`
 * at a time, each to the end of its body so its render (and the cache writes
 * in it) finishes. A page that fails is counted and the rest go on; a sitemap
 * that fails rejects, since there is then nothing to read.
 */
export async function warmPublicPages(
  base: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<WarmResult> {
  const started = now();
  const init: RequestInit = { redirect: "manual", headers: { "user-agent": WARM_USER_AGENT } };
  const sitemap = await fetchImpl(`${base}/sitemap.xml`, init);
  if (!sitemap.ok) throw new Error(`sitemap answered ${sitemap.status}`);
  const paths = sitemapPaths(await sitemap.text());

  let next = 0;
  let ok = 0;
  let failed = 0;
  const worker = async (): Promise<void> => {
    while (next < paths.length) {
      const path = paths[next++]!;
      try {
        const response = await fetchImpl(`${base}${path}`, init);
        await response.arrayBuffer();
        // A redirect is the page answering as it should (an old slug moved on).
        if (response.status < 400) ok++;
        else failed++;
      } catch {
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(WARM_CONCURRENCY, paths.length) }, worker));
  return { pages: paths.length, ok, failed, ms: now() - started };
}

/** Resolve once `base` answers its health check, or false after `HEALTH_WAIT_MS`. */
async function serverUp(base: string, fetchImpl: typeof fetch, sleep: (ms: number) => Promise<void>): Promise<boolean> {
  for (let waited = 0; waited < HEALTH_WAIT_MS; waited += HEALTH_POLL_MS) {
    try {
      const response = await fetchImpl(`${base}/api/health`);
      if (response.ok) return true;
    } catch {
      // Not listening yet.
    }
    await sleep(HEALTH_POLL_MS);
  }
  return false;
}

/** What `startPublicPageWarmer` reaches for, injected so a test can drive it without a server or a clock. */
export interface WarmerDeps {
  readonly env: () => string | undefined;
  readonly port: string | undefined;
  readonly fetch: typeof fetch;
  readonly sleep: (ms: number) => Promise<void>;
  readonly every: (run: () => void, ms: number) => void;
  readonly log: (line: string) => void;
}

const defaultDeps = (): WarmerDeps => ({
  env: deployEnv,
  port: process.env.PORT,
  fetch,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  every: (run, ms) => setInterval(run, ms).unref(),
  log: (line) => console.log(line),
});

/**
 * Start the warm-up in a production server: once the server answers its
 * health check, then every `REWARM_MS`. Returns null outside production, and
 * otherwise the first run's promise, which the server's start does not wait
 * on. Never rejects: a warm-up that fails is logged and the next one tries
 * again.
 */
export function startPublicPageWarmer(deps: WarmerDeps = defaultDeps()): Promise<void> | null {
  if (deps.env() !== "production") return null;
  const base = `http://127.0.0.1:${deps.port ?? "3000"}`;
  const run = async (): Promise<void> => {
    try {
      const result = await warmPublicPages(base, deps.fetch);
      deps.log(`[warm-up] read ${result.ok} of ${result.pages} public pages in ${result.ms} ms (${result.failed} failed)`);
    } catch (error) {
      deps.log(`[warm-up] skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return (async () => {
    if (!(await serverUp(base, deps.fetch, deps.sleep))) {
      deps.log("[warm-up] skipped: the server never answered its health check");
    } else {
      await run();
    }
    deps.every(() => void run(), REWARM_MS);
  })();
}
