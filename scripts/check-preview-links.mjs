// Requests every link the landing sea draws against a Vercel preview and fails
// on any that does not answer 200 (M51, "The links stay real"). Run by
// `.github/workflows/preview-link-check.yml` once a preview is built; tested by
// `scripts/__tests__/check-preview-links.test.mjs`.
//
// CLI: PREVIEW_URL=<url> VERCEL_AUTOMATION_BYPASS_SECRET=<secret> node scripts/check-preview-links.mjs

import { readFileSync } from "node:fs";

const SEA = new URL("../apps/web/src/lib/landingSea.generated.json", import.meta.url);

// A few at a time: 148 at once from one runner looks like a burst to Vercel,
// and one at a time takes minutes for no gain.
const CONCURRENCY = 8;

/** One request; `null` when nothing came back (connection dropped, timed out). */
async function status(url, bypass, timeoutMs) {
  try {
    // `manual`: a redirect (to sign-in, say) is not the page, so it must not
    // be followed to a 200.
    const res = await fetch(url, {
      headers: { "x-vercel-protection-bypass": bypass },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.body?.cancel();
    return res.status;
  } catch {
    return null;
  }
}

/** `[{ href, reason }]` for every href that did not answer 200; a request with no response is retried once. */
export async function checkLinks({ baseUrl, hrefs, bypass, timeoutMs = 30_000 }) {
  const results = new Array(hrefs.length);
  let next = 0;
  async function worker() {
    while (next < hrefs.length) {
      const index = next++;
      const url = new URL(hrefs[index], baseUrl);
      results[index] = (await status(url, bypass, timeoutMs)) ?? (await status(url, bypass, timeoutMs));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, hrefs.length) }, worker));
  return hrefs.flatMap((href, index) =>
    results[index] === 200 ? [] : [{ href, reason: results[index] === null ? "no response, twice" : `HTTP ${results[index]}` }],
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const baseUrl = process.env.PREVIEW_URL;
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!baseUrl) throw new Error("PREVIEW_URL is not set");
  // Without the header every request is a 401 from Deployment Protection,
  // which would read as 148 broken links rather than one missing secret.
  if (!bypass) {
    console.error("::error::VERCEL_AUTOMATION_BYPASS_SECRET is empty, so the preview cannot be reached past Deployment Protection.");
    process.exit(1);
  }
  const hrefs = JSON.parse(readFileSync(SEA, "utf8")).cells.map((cell) => cell.href);
  if (hrefs.length === 0) throw new Error("the landing sea has no cells to check");
  const failures = await checkLinks({ baseUrl, hrefs, bypass });
  for (const { href, reason } of failures) console.error(`::error::${href}: ${reason}`);
  console.log(`${hrefs.length - failures.length} of ${hrefs.length} sea links answered 200 on ${baseUrl}`);
  if (failures.length > 0) process.exit(1);
}
