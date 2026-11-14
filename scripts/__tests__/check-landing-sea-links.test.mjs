// Tests for scripts/check-landing-sea-links.mjs (KI-2026-10-20-c).
//
// The failure that matters is a landing whose door opens a 404 in production
// while the scheduled check reports green: a 404 read as a pass, a redirect
// that lands on a 404 read as one, or a failure that does not say which href.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { checkLinks, seaHrefs } from "../check-landing-sea-links.mjs";

const SCRIPT = fileURLToPath(new URL("../check-landing-sea-links.mjs", import.meta.url));

/**
 * A stub site. `routes` maps a path to a status, `"drop"` to close the socket
 * unanswered, or `[status, location]` for a redirect. Anything else is a 404.
 */
async function stubSite(routes) {
  // A Map keyed by `req.url`, not an object: CodeQL reads object indexing by a
  // request field as remote property injection, even in a test.
  const table = new Map(Object.entries(routes));
  const hits = new Map();
  const server = createServer((req, res) => {
    hits.set(req.url, (hits.get(req.url) ?? 0) + 1);
    const route = table.get(req.url) ?? 404;
    if (route === "drop") return req.socket.destroy();
    const [status, location] = Array.isArray(route) ? route : [route];
    res.writeHead(status, location ? { location } : {}).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { baseUrl: `http://127.0.0.1:${port}`, hits, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("names the href that 404s, and passes the one that answers 200", async (t) => {
  const site = await stubSite({ "/playbooks/day/kept": 200, "/playbooks/day/unpublished": 404 });
  t.after(site.close);
  const failures = await checkLinks({
    baseUrl: site.baseUrl,
    hrefs: ["/playbooks/day/kept", "/playbooks/day/unpublished"],
  });
  assert.deepEqual(failures, [{ href: "/playbooks/day/unpublished", reason: "HTTP 404" }]);
});

test("follows a redirect on the site: a pass when it ends on a 2xx, a failure when it ends on a 404", async (t) => {
  const site = await stubSite({
    "/playbooks/day/old-slug": [308, "/playbooks/day/new-slug"],
    "/playbooks/day/new-slug": 200,
    "/playbooks/day/gone": [307, "/playbooks/day/removed"],
  });
  t.after(site.close);
  const failures = await checkLinks({
    baseUrl: site.baseUrl,
    hrefs: ["/playbooks/day/old-slug", "/playbooks/day/gone"],
  });
  assert.deepEqual(failures, [
    { href: "/playbooks/day/gone", reason: "HTTP 307 → /playbooks/day/removed → HTTP 404" },
  ]);
});

test("fails a redirect off the site, and never requests the other host", async (t) => {
  const elsewhere = await stubSite({ "/": 200 });
  const site = await stubSite({ "/playbooks/day/x": [302, `${elsewhere.baseUrl}/`] });
  t.after(site.close);
  t.after(elsewhere.close);
  const failures = await checkLinks({ baseUrl: site.baseUrl, hrefs: ["/playbooks/day/x"] });
  assert.equal(failures.length, 1);
  assert.match(failures[0].reason, /off the site/);
  assert.equal(elsewhere.hits.size, 0);
});

test("fails a redirect loop instead of following it forever", async (t) => {
  const site = await stubSite({ "/a": [302, "/b"], "/b": [302, "/a"] });
  t.after(site.close);
  const failures = await checkLinks({ baseUrl: site.baseUrl, hrefs: ["/a"] });
  assert.match(failures[0].reason, /too many redirects$/);
});

test("retries a dropped request once, then names it", async (t) => {
  const site = await stubSite({ "/silent": "drop" });
  t.after(site.close);
  const failures = await checkLinks({ baseUrl: site.baseUrl, hrefs: ["/silent"] });
  assert.deepEqual(failures, [{ href: "/silent", reason: "no response, twice" }]);
  assert.equal(site.hits.get("/silent"), 2);
});

test("refuses an absolute href without requesting it", async (t) => {
  const site = await stubSite({ "/ok": 200 });
  t.after(site.close);
  const failures = await checkLinks({ baseUrl: site.baseUrl, hrefs: [`${site.baseUrl}/ok`, "//example.com/ok"] });
  assert.equal(failures.length, 2);
  assert.equal(site.hits.size, 0);
});

test("reads every cell's href and skips the drawn-only cells that have none", () => {
  assert.deepEqual(seaHrefs({ cells: [{ href: "/a" }, { href: "/b" }], japan: [{ href: null }] }), ["/a", "/b"]);
});

test("the CLI exits 1 and prints an error line naming the 404", async (t) => {
  const site = await stubSite({ "/playbooks/day/kept": 200, "/playbooks/day/unpublished": 404 });
  const dir = mkdtempSync(join(tmpdir(), "sea-links-"));
  t.after(site.close);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sea = join(dir, "sea.json");
  writeFileSync(sea, JSON.stringify({ cells: [{ href: "/playbooks/day/kept" }, { href: "/playbooks/day/unpublished" }], japan: [] }));
  const run = promisify(execFile)(process.execPath, [SCRIPT], { env: { ...process.env, SITE_URL: site.baseUrl, SEA_JSON: sea } });
  const err = await run.then(() => null, (e) => e);
  assert.ok(err, "expected the CLI to exit non-zero");
  assert.equal(err.code, 1);
  assert.match(err.stderr, /::error::\/playbooks\/day\/unpublished: HTTP 404/);
  assert.match(err.stdout, /1 of 2 sea links opened a page/);
});
