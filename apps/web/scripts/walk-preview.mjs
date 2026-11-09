#!/usr/bin/env node
/**
 * Walk a Coolify preview deployment in a real browser, from anywhere —
 * including a Claude Code cloud session, where the network had to be solved
 * before a single page would load. `docs/guidelines/cloud-agent-sessions.md`
 * records the whole diagnosis; this file is the executable half.
 *
 *   pnpm --filter web walk:preview <url> [path ...]
 *
 * `<url>` is a preview URL (`https://<pr>.preview.caesura.today`). Paths
 * default to `/`. Previews are public and NOINDEX, so no credential is needed
 * or sent.
 *
 * ── Getting Chromium onto the network at all (cloud sessions) ─────────────────
 * One container fact, which does not affect a laptop: egress goes through the
 * agent proxy, and Chromium does not read /etc/ssl/certs. Hosts the gateway inspects (github.com, most of the web)
 *      fail ERR_CERT_AUTHORITY_INVALID until the gateway's own CAs are trusted.
 *      certutil is not installed here, so the CAs are pinned by SPKI hash —
 *      computed from the certificates the environment itself installed, so
 *      exactly those are trusted. It is not `--ignore-certificate-errors` and
 *      it is not a blanket disable. This half lives in
 *      `container-chromium.mjs` (the e2e lane shared it until 2026-09-24,
 *      when it stopped fetching from any third party); that file carries the
 *      full reasoning, including why the count is computed rather
 *      than written down (this paragraph used to say "five"; the image now
 *      installs six).
 *
 * Exits non-zero if any path fails to load, so it is usable as a check.
 */
import { chromium } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { containerChromiumArgs } from "./container-chromium.mjs";

const PW_BROWSERS = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";

/**
 * `undefined` when Playwright's own resolution points at a binary that exists —
 * the normal case, and the one to prefer, because Playwright knows which
 * revision its client speaks to. Otherwise the newest `chromium-*` build under
 * the browsers directory, accepting either the `chrome-linux/` layout older
 * revisions use or the `chrome-linux64/` newer ones do.
 */
function resolveFallbackChromium() {
  try {
    if (existsSync(chromium.executablePath())) return undefined;
  } catch {
    // executablePath() throws when the registry has no entry at all; scan.
  }
  let candidates;
  try {
    candidates = readdirSync(PW_BROWSERS).filter((d) => /^chromium-\d+$/.test(d));
  } catch {
    return undefined;
  }
  const byRevisionDesc = candidates.sort(
    (a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]),
  );
  for (const dir of byRevisionDesc) {
    for (const layout of ["chrome-linux64", "chrome-linux"]) {
      const exe = join(PW_BROWSERS, dir, layout, "chrome");
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}

const fallbackChromium = resolveFallbackChromium();

const [target, ...paths] = process.argv.slice(2);
if (!target) {
  console.error("usage: walk-preview.mjs <preview-url> [path ...]");
  process.exit(2);
}
if (paths.length === 0) paths.push("/");

// The CA pin lives in container-chromium.mjs, whose header explains it.
const args = containerChromiumArgs();

const browser = await chromium.launch({
  // No `executablePath`. An earlier version of this file pinned
  // /opt/pw-browsers/chromium-1194/chrome-linux/chrome, copied from a
  // guideline written when that was the only build present. By the time this
  // script was reviewed the image also carried chromium-1228 — the revision
  // playwright-core actually asks for — under a *different* layout
  // (chrome-linux64/, not chrome-linux/). So the pin was wrong twice over: it
  // selected the stale build, and a version-only fix would still have missed
  // it. Playwright resolves the right binary by itself, which is what it is
  // for; `resolveFallbackChromium()` above steps in only when that resolution
  // points at nothing, which is the case the pin was originally written for.
  proxy: process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" }
    : undefined,
  args,
  ...(fallbackChromium ? { executablePath: fallbackChromium } : {}),
});

const context = await browser.newContext();

const previewOrigin = new URL(target).origin;

const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().trim());
});
page.on("pageerror", (e) => consoleErrors.push(`[pageerror] ${e.message}`));

let failed = 0;

for (const path of paths) {
  // An absolute URL is accepted for convenience, but only onto the deployment
  // being walked. Navigating elsewhere is refused rather than silently walked:
  // this script exists to look at one deployment.
  let url;
  try {
    const resolved = new URL(path, target);
    if (resolved.origin !== previewOrigin) {
      throw new Error(`refusing to leave ${previewOrigin} for ${resolved.origin}`);
    }
    url = resolved.toString();
  } catch (e) {
    console.log(`FAIL ${path}   ${e.message}`);
    failed += 1;
    continue;
  }
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded" });
    const status = res?.status() ?? 0;
    const landed = new URL(page.url()).pathname;
    const redirected = landed !== new URL(url).pathname ? `  -> ${landed}` : "";
    console.log(`${String(status).padEnd(4)} ${path}${redirected}   ${await page.title()}`);
    if (status >= 400) failed += 1;
  } catch (e) {
    console.log(`FAIL ${path}   ${e.message.split("\n")[0]}`);
    failed += 1;
  }
}

if (consoleErrors.length) {
  console.log(`\nconsole errors (${consoleErrors.length}, deduped):`);
  for (const e of [...new Set(consoleErrors)]) console.log(`  - ${e}`);
} else {
  console.log("\nconsole errors: none");
}

await browser.close();
process.exit(failed > 0 ? 1 : 0);
