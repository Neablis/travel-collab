// Requests every link the landing sea draws against a Coolify preview and fails
// on any that does not answer 200 (M51, "The links stay real"). Run by
// `.github/workflows/preview-link-check.yml` once a preview answers; tested by
// `scripts/__tests__/check-preview-links.test.mjs`.
//
// CLI: PREVIEW_URL=<url> node scripts/check-preview-links.mjs

import { readFileSync } from "node:fs";

const SEA = new URL("../apps/web/src/lib/landingSea.generated.json", import.meta.url);

// A few at a time: 148 at once from one runner looks like a burst to the box,
// and one at a time takes minutes for no gain.
const CONCURRENCY = 8;

/** One request; `null` when nothing came back (connection dropped, timed out). */
async function status(url, timeoutMs) {
  try {
    // `manual`: a redirect (to sign-in, say) is not the page, so it must not
    // be followed to a 200.
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.body?.cancel();
    return res.status;
  } catch {
    return null;
  }
}

/** The failure reason for one href, or `null` when it answered 200; a request with no response is retried once. */
async function check(href, base, timeoutMs) {
  // The check stays on the preview's own host. The sea's hrefs are
  // root-relative; an absolute one, or a protocol-relative `//host`, is a bug
  // in the sea.
  const url = new URL(href, base);
  if (URL.canParse(href) || url.origin !== base.origin) return "not a path on the preview";
  const answer = (await status(url, timeoutMs)) ?? (await status(url, timeoutMs));
  if (answer === 200) return null;
  return answer === null ? "no response, twice" : `HTTP ${answer}`;
}

/**
 * `[{ href, reason }]` for every href that did not answer 200. The 15 s
 * default keeps a preview that answers nothing (148 hrefs, 8 at a time, two
 * tries each: about 9.5 min) inside the job's 15 min, so the hrefs still get
 * named.
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const baseUrl = process.env.PREVIEW_URL;
  if (!baseUrl) throw new Error("PREVIEW_URL is not set");
  const hrefs = JSON.parse(readFileSync(SEA, "utf8")).cells.map((cell) => cell.href);
  if (hrefs.length === 0) throw new Error("the landing sea has no cells to check");
  const failures = await checkLinks({ baseUrl, hrefs });
  for (const { href, reason } of failures) console.error(`::error::${href}: ${reason}`);
  console.log(`${hrefs.length - failures.length} of ${hrefs.length} sea links answered 200 on ${baseUrl}`);
  if (failures.length > 0) process.exit(1);
}
