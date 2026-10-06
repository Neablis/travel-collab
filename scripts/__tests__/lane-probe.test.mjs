// Tests for scripts/lane-probe.mjs.
//
// The probe's whole value is telling a session the truth about its container
// BEFORE it promises a verification it cannot perform. The failure that
// matters is therefore not a crash — it is a probe that reports OK, or
// reports UNKNOWN, on a container where the lane is in fact broken. Each test
// below pins one such case to a known issue.

import { test } from "node:test";
import assert from "node:assert/strict";

import { pnpmMajorSkew, nodeLaneStatus, pinnedNodeMajor, probeDeps, probeBrowser } from "../lane-probe.mjs";
import { compareShell, parseVersion, cftShellUrl, shellPath } from "../e2e-browser.mjs";

// --- pnpm major skew (KI-2026-09-08-b) ------------------------------------

test("pnpmMajorSkew reads the QUOTED .modules.yaml form pnpm 11 writes", () => {
  // The real file in this repo, verified 2026-09-21:
  //   "packageManager": "pnpm@11.25.0",
  // The first draft of the probe matched only the KI's unquoted spelling and
  // therefore reported UNKNOWN on every modern tree — silently not probing
  // the one lane it exists to probe.
  const yaml = '  "packageManager": "pnpm@11.25.0",\n  "storeDir": "/root/.../store/v11",';
  assert.deepEqual(pnpmMajorSkew(yaml, "11.25.0"), {
    recorded: "11", onPath: "11", skewed: false,
  });
});

test("pnpmMajorSkew reads the BARE form the known issue quotes", () => {
  // KI-2026-09-08-b quotes: packageManager: pnpm@10.28.0
  const yaml = "packageManager: pnpm@10.28.0\nstoreDir: /x/store/v10";
  assert.deepEqual(pnpmMajorSkew(yaml, "11.25.0"), {
    recorded: "10", onPath: "11", skewed: true,
  });
});

test("pnpmMajorSkew compares MAJORS only — a patch difference is not a skew", () => {
  // pnpm's deps-status check objects at major granularity. Reporting BLOCKED
  // on 11.25.0 vs 11.25.1 would be a false alarm, and a probe that cries wolf
  // is trained away within a day.
  const yaml = '"packageManager": "pnpm@11.25.0"';
  assert.equal(pnpmMajorSkew(yaml, "11.26.3").skewed, false);
});

test("pnpmMajorSkew returns null when it cannot tell — never a false OK", () => {
  assert.equal(pnpmMajorSkew("nothing useful here", "11.25.0"), null);
  assert.equal(pnpmMajorSkew('"packageManager": "pnpm@11.0.0"', ""), null);
  assert.equal(pnpmMajorSkew(null, null), null);
});

// --- node major vs the pinned version (KI-2026-09-02-a) ------------------

test("nodeLaneStatus passes only the major .nvmrc pins", () => {
  assert.equal(nodeLaneStatus("v24.21.0", 24).status, "OK");
  for (const other of ["v22.22.2", "v26.0.0", "v20.0.0"]) {
    const r = nodeLaneStatus(other, 24);
    assert.equal(r.status, "BLOCKED", other);
    assert.equal(r.ki, "KI-2026-09-02-a");
    assert.match(r.note, /pins 24/);
  }
});

test("nodeLaneStatus says UNKNOWN rather than OK when either side is unreadable", () => {
  assert.equal(nodeLaneStatus("not-a-version", 24).status, "UNKNOWN");
  assert.equal(nodeLaneStatus(undefined, 24).status, "UNKNOWN");
  assert.equal(nodeLaneStatus("v24.21.0", null).status, "UNKNOWN");
});

test("pinnedNodeMajor reads the forms .nvmrc takes", () => {
  assert.equal(pinnedNodeMajor("24\n"), 24);
  assert.equal(pinnedNodeMajor("v24.21.0"), 24);
  assert.equal(pinnedNodeMajor("lts/*"), null);
  assert.equal(pinnedNodeMajor(null), null);
});

// --- node_modules presence (KI-2026-09-12-b) ------------------------------

test("probeDeps reports BLOCKED when a worktree has no node_modules", () => {
  // The 2026-09-12 sweep found a ki-fixer worktree with neither node_modules
  // nor apps/web/node_modules, because SessionStart had not run.
  const none = probeDeps({ existsSync: () => false }, "/w");
  assert.equal(none.status, "BLOCKED");
  assert.equal(none.ki, "KI-2026-09-12-b");
  assert.match(none.note, /root \+ apps\/web/);
});

test("probeDeps catches the HALF-installed tree, not just the empty one", () => {
  // Root present but apps/web missing is the shape a stale worktree actually
  // has; treating "root exists" as good enough would report OK on it.
  const half = probeDeps({ existsSync: (p) => String(p).endsWith("/w/node_modules") }, "/w");
  assert.equal(half.status, "BLOCKED");
  assert.match(half.note, /apps\/web/);
  assert.doesNotMatch(half.note, /root \+/);
});

test("probeDeps reports OK only when BOTH trees exist", () => {
  assert.equal(probeDeps({ existsSync: () => true }, "/w").status, "OK");
});

// --- Playwright browser cache, per platform --------------------------------

// A fake filesystem holding exactly the listed paths, so a probe that looks in
// the wrong place for the platform finds nothing — as it would on a real box.
const only = (...paths) => ({ existsSync: (p) => paths.includes(String(p)) });
// The location tests below are about WHERE the browsers are; the version check
// (KI-2026-09-25-i) is stubbed to "matches" so they test only that.
const matches = () => ({ state: "match" });

test("probeBrowser finds the macOS cache, which is not under ~/.cache", () => {
  // Verified on a Mac 2026-10-01: chromium-1234 lives in
  // ~/Library/Caches/ms-playwright and `playwright install --dry-run` names
  // that location. The probe looked only at the Linux default, printed "no
  // Playwright browsers — e2e cannot run here", and a session believed it and
  // skipped running a spec it had just edited.
  const cache = "/Users/m/Library/Caches/ms-playwright";
  const r = probeBrowser(only(cache), {}, "darwin", "/Users/m", matches);
  assert.equal(r.status, "OK");
  assert.ok(r.note.includes(cache), r.note);
});

test("probeBrowser finds the Windows cache under %LOCALAPPDATA%", () => {
  const cache = "C:\\Users\\m\\AppData\\Local\\ms-playwright";
  const r = probeBrowser(only(cache), { LOCALAPPDATA: "C:\\Users\\m\\AppData\\Local" }, "win32", "D:\\elsewhere", matches);
  assert.equal(r.status, "OK");
  assert.ok(r.note.includes(cache), r.note);
});

test("probeBrowser finds the Linux cache, honouring XDG_CACHE_HOME as Playwright does", () => {
  const home = probeBrowser(only("/root/.cache/ms-playwright"), {}, "linux", "/root", matches);
  assert.equal(home.status, "OK");
  assert.ok(home.note.includes("/root/.cache/ms-playwright"), home.note);
  const xdg = probeBrowser(only("/xdg/ms-playwright"), { XDG_CACHE_HOME: "/xdg" }, "linux", "/root", matches);
  assert.equal(xdg.status, "OK");
});

test("probeBrowser prefers PLAYWRIGHT_BROWSERS_PATH and reports it", () => {
  const r = probeBrowser(only("/opt/pw"), { PLAYWRIGHT_BROWSERS_PATH: "/opt/pw" }, "linux", "/root", matches);
  assert.equal(r.status, "OK");
  assert.ok(r.note.includes("/opt/pw"), r.note);
});

test("probeBrowser does not accept another platform's cache — never a false OK", () => {
  // Playwright on macOS does not read ~/.cache; a leftover directory there
  // (a synced dotfile tree, say) must not turn a browserless Mac green.
  const r = probeBrowser(only("/Users/m/.cache/ms-playwright"), {}, "darwin", "/Users/m", matches);
  assert.equal(r.status, "BLOCKED");
  assert.equal(probeBrowser(only(), {}, "linux", "/root", matches).status, "BLOCKED");
  assert.equal(probeBrowser(only(), {}, "win32", "C:\\Users\\m", matches).status, "BLOCKED");
});

test("probeBrowser falls back to the home directory when the env vars are absent", () => {
  // Playwright 1.62.1 resolves its cache from os.homedir(), not $HOME, and on
  // Windows uses <home>\\AppData\\Local when LOCALAPPDATA is unset. A probe that
  // needs the variables reports BLOCKED on a box Playwright can use. Copilot,
  // PR #287.
  const mac = probeBrowser(only("/Users/m/Library/Caches/ms-playwright"), {}, "darwin", "/Users/m", matches);
  assert.equal(mac.status, "OK");
  const linux = probeBrowser(only("/root/.cache/ms-playwright"), {}, "linux", "/root", matches);
  assert.equal(linux.status, "OK");
  const winCache = "C:\\Users\\m\\AppData\\Local\\ms-playwright";
  const win = probeBrowser(only(winCache), {}, "win32", "C:\\Users\\m", matches);
  assert.equal(win.status, "OK");
  assert.ok(win.note.includes(winCache), win.note);
});

// --- the browser's VERSION, not just its presence (KI-2026-09-25-i) -------

test("probeBrowser reports BLOCKED when the headless shell is not the build CI runs", () => {
  // The cloud image linked chromium_headless_shell-1243 (Chrome 153 in CI) at
  // its own Chromium 141. The probe said "OK browser", e2e passed on 141, and
  // a product bug only 151+ exposes (KI-5's unload flush) stayed green here
  // while CI went red three times.
  const skewed = () => ({ state: "mismatch", expected: "153.0.8010.12", actual: "141.0.7390.37" });
  const r = probeBrowser(only("/opt/pw"), { PLAYWRIGHT_BROWSERS_PATH: "/opt/pw" }, "linux", "/root", skewed);
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.ki, "KI-2026-09-25-i");
  assert.ok(r.note.includes("141.0.7390.37") && r.note.includes("153.0.8010.12"), r.note);
});

test("probeBrowser asks the version check about the directory it found", () => {
  let asked = null;
  const r = probeBrowser(only("/root/.cache/ms-playwright"), {}, "linux", "/root", (dir) => {
    asked = dir;
    return { state: "match" };
  });
  assert.equal(r.status, "OK");
  assert.equal(asked, "/root/.cache/ms-playwright");
});

test("probeBrowser stays OK when the version cannot be determined — never a false alarm", () => {
  const r = probeBrowser(only("/opt/pw"), { PLAYWRIGHT_BROWSERS_PATH: "/opt/pw" }, "linux", "/root",
    () => ({ state: "unknown", reason: "no manifest" }));
  assert.equal(r.status, "OK");
});

test("compareShell demands the exact pinned build, not the same major", () => {
  const pinned = { revision: "1243", browserVersion: "153.0.8010.12" };
  assert.equal(compareShell(pinned, "153.0.8010.12").state, "match");
  assert.equal(compareShell(pinned, "141.0.7390.37").state, "mismatch");
  assert.equal(compareShell(pinned, "153.0.8010.5").state, "mismatch");
  assert.equal(compareShell(pinned, null).state, "missing");
  assert.equal(compareShell(null, "153.0.8010.12").state, "unknown");
});

test("parseVersion reads both spellings a headless shell prints", () => {
  // Real output, 2026-10-06: the image's chrome, then Chrome for Testing's shell.
  assert.equal(parseVersion("Chromium 141.0.7390.37 \n"), "141.0.7390.37");
  assert.equal(parseVersion("Google Chrome for Testing 153.0.8010.12"), "153.0.8010.12");
  assert.equal(parseVersion(""), null);
});

test("cftShellUrl and shellPath match Playwright's layout, and arm64 has no download", () => {
  assert.equal(
    cftShellUrl("153.0.8010.12", "x64"),
    "https://storage.googleapis.com/chrome-for-testing-public/153.0.8010.12/linux64/chrome-headless-shell-linux64.zip",
  );
  assert.equal(cftShellUrl("153.0.8010.12", "arm64"), null);
  assert.equal(
    shellPath("/opt/pw-browsers", "1243", "x64"),
    "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell",
  );
});
