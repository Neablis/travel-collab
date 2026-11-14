// Requests every link the landing sea draws against PRODUCTION and fails on any
// that does not end on a 2xx (KI-2026-10-20-c; M51 decision 10's production
// half). Run on a schedule by `.github/workflows/landing-sea-links-production.yml`;
// tested by `scripts/__tests__/check-landing-sea-links.test.mjs`.
//
// Why a separate check from `check-preview-links.mjs`: that one proves a PR's
// own build seeds every day its sea links to. This one catches drift that no
// PR causes: the sea is a build-time snapshot of `content/`, and a day that is
// unpublished, moderated or deleted in production's database keeps its door on
// the landing, which then opens a 404.
//
// What passes: a 2xx, or a redirect on production's own host that ends on a
// 2xx (a renamed day's old slug, say, still opens the day). What fails: any
// 4xx/5xx, a redirect chain that ends on one, a redirect off the host, a loop,
// or no response twice.
//
// CLI: SITE_URL=https://caesura.today node scripts/check-landing-sea-links.mjs
//      (SEA_JSON=<path> reads another snapshot; for testing the CLI itself)

import { readFileSync } from "node:fs";

const SEA = new URL("../apps/web/src/lib/landingSea.generated.json", import.meta.url);

// Fewer than the preview check's 8: this is the live site, and nothing is
// waiting on the answer.
const CONCURRENCY = 4;
const MAX_REDIRECTS = 5;

/** One request, redirects not followed; `null` when nothing came back (connection dropped, timed out). */
async function request(url, timeoutMs) {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    await res.body?.cancel();
    return { status: res.status, location: res.headers.get("location") };
  } catch {
    return null;
  }
}

/** The failure reason for one href, or `null` when it ends on a 2xx. A request with no response is retried once. */
async function check(href, base, timeoutMs) {
  // The sea's hrefs are root-relative; an absolute one, or a protocol-relative
  // `//host`, is a bug in the sea, and is never requested.
  let url = new URL(href, base);
  if (URL.canParse(href) || url.origin !== base.origin) return "not a path on the site";
  const hops = [];
  for (;;) {
    const answer = (await request(url, timeoutMs)) ?? (await request(url, timeoutMs));
    if (answer === null) return [...hops, "no response, twice"].join(" → ");
    hops.push(`HTTP ${answer.status}`);
    if (answer.status >= 200 && answer.status < 300) return null;
    if (answer.status < 300 || answer.status >= 400) return hops.join(" → ");
    if (!answer.location) return [...hops, "no Location"].join(" → ");
    const next = new URL(answer.location, url);
    // A redirect off the host (to a sign-in provider, a parked domain) is not
    // the day, whatever it answers.
    if (next.origin !== base.origin) return [...hops, `off the site to ${next.origin}`].join(" → ");
    hops.push(next.pathname + next.search);
    if (hops.length > MAX_REDIRECTS * 2) return [...hops, "too many redirects"].join(" → ");
    url = next;
  }
}

/**
 * `[{ href, reason }]` for every href that did not end on a 2xx, in the order
 * given. The 15 s default keeps a site that answers nothing (189 hrefs, 4 at a
 * time, two tries each: about 24 min) inside the workflow's 30 min.
 */
export async function checkLinks({ baseUrl, hrefs, timeoutMs = 15_000 }) {
  const base = new URL(baseUrl);
  const reasons = new Array(hrefs.length);
  let next = 0;
  async function worker() {
    while (next < hrefs.length) {
      const index = next++;
      reasons[index] = await check(hrefs[index], base, timeoutMs);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, hrefs.length) }, worker));
  return hrefs.flatMap((href, index) => (reasons[index] === null ? [] : [{ href, reason: reasons[index] }]));
}

/** Every href the sea links to. `japan`'s cells have none: they are drawn, not linked. */
export function seaHrefs(sea) {
  return [...(sea.cells ?? []), ...(sea.japan ?? [])].map((cell) => cell.href).filter((href) => typeof href === "string");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Required, never defaulted: a default would put the live site one stray
  // `node` invocation away.
  const baseUrl = process.env.SITE_URL;
  if (!baseUrl) throw new Error("SITE_URL is not set");
  const hrefs = seaHrefs(JSON.parse(readFileSync(process.env.SEA_JSON ?? SEA, "utf8")));
  if (hrefs.length === 0) throw new Error("the landing sea has no links to check");
  const failures = await checkLinks({ baseUrl, hrefs });
  for (const { href, reason } of failures) console.error(`::error::${href}: ${reason}`);
  console.log(`${hrefs.length - failures.length} of ${hrefs.length} sea links opened a page on ${baseUrl}`);
  if (failures.length > 0) process.exit(1);
}
