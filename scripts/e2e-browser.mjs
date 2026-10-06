#!/usr/bin/env node
// Is the browser the e2e suite launches HERE the browser CI launches?
//
// WHY THIS EXISTS (KI-2026-09-25-i)
//
// A cloud container ships Playwright browsers under /opt/pw-browsers, but not
// the revision this repo's @playwright/test pins. The session hook's
// `link_playwright_shell` used to make up the difference by symlinking the
// pinned revision's directory at whatever chrome the image had — so
// `chromium_headless_shell-1234` (Chrome 151 in CI) launched Chromium 141.
// Every e2e run "passed" against a browser ten majors older than CI's, and on
// 2026-09-25 that hid a real product bug: `m6-unload-flush.spec.ts` failed in
// CI three times identically and passed locally every time, because only
// Chromium 151 cancels the unit in flight before `pagehide` runs (KI-5's flush
// re-sent a head the server had already applied). Downloading CI's exact
// build reproduced it at once. By 2026-10-06 the skew was 141 vs 153.
//
// A symlink keeps the suite LAUNCHING; it says nothing about whether the
// verdict means anything. This script answers the second question:
//
//   node scripts/e2e-browser.mjs            report expected vs actual, exit 0
//   node scripts/e2e-browser.mjs --install  if they differ, fetch the pinned
//                                           build from Chrome for Testing into
//                                           PLAYWRIGHT_BROWSERS_PATH
//
// Chrome for Testing (storage.googleapis.com) is reachable through the cloud
// proxy; Playwright's own CDN (cdn.playwright.dev) answers 403, which is why
// `playwright install` cannot do this itself. The headless shell is ~120 MB
// and downloaded in about a second there.
//
// Only the headless shell is checked and installed: every project in
// apps/web/playwright.config.ts is `devices["Desktop Chrome"]` with the
// default headless mode, which launches `chromium-headless-shell`, never
// headed `chromium`.
//
// ADVISORY, like the rest of the session tooling: it never exits non-zero. A
// failed install leaves the old link in place (so e2e still runs) and says,
// loudly, that a local e2e verdict cannot be trusted.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

const SHELL_REL = {
  x64: "chrome-headless-shell-linux64/chrome-headless-shell",
  arm64: "chrome-linux/headless_shell",
};

/** The pinned `chromium-headless-shell` entry of apps/web's Playwright, or null. */
export function readPinnedShell(webDir = join(root, "apps", "web")) {
  try {
    // Same chain as link_playwright_shell: each hop is a declared dependency,
    // so this never relies on pnpm's hoist directory.
    const req = createRequire(join(webDir, "package.json"));
    const testMain = req.resolve("@playwright/test");
    const playwrightMain = createRequire(testMain).resolve("playwright");
    const coreMain = createRequire(playwrightMain).resolve("playwright-core");
    let dir = dirname(coreMain);
    for (let i = 0; i < 6; i++) {
      const manifest = join(dir, "browsers.json");
      if (existsSync(manifest)) {
        const browsers = JSON.parse(readFileSync(manifest, "utf8")).browsers ?? [];
        const shell = browsers.find((b) => b.name === "chromium-headless-shell");
        return shell ? { revision: shell.revision, browserVersion: shell.browserVersion } : null;
      }
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  } catch {
    // fall through: unknown is reported as unknown, never as a match
  }
  return null;
}

/** "Chromium 141.0.7390.37 " / "Google Chrome for Testing 153.0.8010.12" → "141.0.7390.37". */
export function parseVersion(versionOutput) {
  return /(\d+\.\d+\.\d+\.\d+)/.exec(String(versionOutput ?? ""))?.[1] ?? null;
}

/**
 * Compare the pinned build with the one on disk. `actual` is the binary's
 * parsed `--version`, or null when it could not be run. An exact match is
 * required: CI installs exactly `browserVersion`, and the defect this exists
 * for was a behaviour difference between builds, not an API break.
 */
export function compareShell(pinned, actual) {
  if (!pinned?.browserVersion) return { state: "unknown", reason: "could not read Playwright's browser manifest" };
  if (!actual) return { state: "missing", expected: pinned.browserVersion };
  if (actual === pinned.browserVersion) return { state: "match", expected: actual, actual };
  return { state: "mismatch", expected: pinned.browserVersion, actual };
}

/** Chrome for Testing publishes linux64 only; there is no arm64 Linux build. */
export function cftShellUrl(browserVersion, arch) {
  if (arch !== "x64") return null;
  return `https://storage.googleapis.com/chrome-for-testing-public/${browserVersion}/linux64/chrome-headless-shell-linux64.zip`;
}

export function shellPath(browsersDir, revision, arch = process.arch) {
  const rel = SHELL_REL[arch];
  return rel ? join(browsersDir, `chromium_headless_shell-${revision}`, rel) : null;
}

function binaryVersion(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return parseVersion(execFileSync(path, ["--version"], { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return null;
  }
}

/** What the lane probe and the hook both ask: the pinned build vs the one on disk. */
export function checkShell({ dir = process.env.PLAYWRIGHT_BROWSERS_PATH, arch = process.arch, webDir } = {}) {
  const pinned = readPinnedShell(webDir);
  if (!dir) return { state: "unknown", reason: "PLAYWRIGHT_BROWSERS_PATH is not set" };
  const path = pinned ? shellPath(dir, pinned.revision, arch) : null;
  return { ...compareShell(pinned, binaryVersion(path)), path, pinned };
}

/**
 * Download and unpack the pinned headless shell, then swap it into place.
 * The old directory (often just a symlink to an older chrome) is replaced only
 * after the new binary has answered `--version` with the expected build.
 */
function install(check, arch) {
  const url = cftShellUrl(check.pinned.browserVersion, arch);
  if (!url) return { ok: false, why: `no Chrome for Testing build for linux-${arch}` };
  const revDir = dirname(dirname(check.path));
  mkdirSync(dirname(revDir), { recursive: true });
  const work = mkdtempSync(join(dirname(revDir), ".e2e-browser-"));
  try {
    const zip = join(work, "shell.zip");
    execFileSync("curl", ["-fsSL", "--max-time", "300", "-o", zip, url], { stdio: ["ignore", "ignore", "pipe"] });
    const staged = join(work, "rev");
    mkdirSync(staged);
    execFileSync("unzip", ["-q", zip, "-d", staged], { stdio: ["ignore", "ignore", "pipe"] });
    const stagedBin = join(staged, SHELL_REL[arch]);
    const got = binaryVersion(stagedBin);
    if (got !== check.pinned.browserVersion) {
      return { ok: false, why: `downloaded build reports ${got ?? "nothing"}, expected ${check.pinned.browserVersion}` };
    }
    // Playwright's own installer writes this marker; nothing reads it for the
    // shell today, but a directory without it looks half-installed.
    writeFileSync(join(staged, "INSTALLATION_COMPLETE"), "");
    rmSync(revDir, { recursive: true, force: true });
    renameSync(staged, revDir);
    return { ok: true };
  } catch (error) {
    return { ok: false, why: String(error?.stderr || error?.message || error).trim().split("\n")[0] };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main() {
  const arch = process.arch;
  let check = checkShell({ arch });
  if (check.state === "unknown") {
    console.log(`e2e-browser: cannot check the e2e browser — ${check.reason}.`);
    return;
  }
  if (check.state === "match") {
    if (!process.argv.includes("--quiet")) console.log(`e2e-browser: headless shell ${check.actual} matches what CI installs.`);
    return;
  }
  if (process.argv.includes("--install")) {
    const result = install(check, arch);
    if (result.ok) {
      const was = check.actual ? `was ${check.actual}` : "was missing";
      check = checkShell({ arch });
      console.log(`e2e-browser: installed Chrome Headless Shell ${check.actual} (revision ${check.pinned.revision}, ${was}) from Chrome for Testing.`);
      return;
    }
    console.error(`e2e-browser: could not install the pinned headless shell: ${result.why}`);
  }
  const actual = check.actual ?? "no runnable binary";
  console.error(
    `e2e-browser: WARNING — e2e here launches ${actual}; CI launches ${check.expected}. ` +
      "A local e2e verdict may be wrong (KI-2026-09-25-i). Run `node scripts/e2e-browser.mjs --install`.",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
