// Tests for scripts/check-preview-links.mjs.
//
// The failure that matters is a preview whose landing links are dead while the
// check reports green: a 404 or a dropped connection read as a pass, or a
// failure reported without saying which href it was.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { checkLinks } from "../check-preview-links.mjs";

const BYPASS = "test-bypass";

/** A stub preview: `routes` maps a path to a status, "drop" to close the socket unanswered, or a list of those, one per hit. A 3xx points at `/ok`. */
async function stubPreview(routes) {
  // Maps, and no function to call, keyed by `req.url`: CodeQL reads either as
  // remote property injection or a dynamic call, even in a test.
  const table = new Map(Object.entries(routes));
  const hits = new Map();
  const server = createServer((req, res) => {
    const hit = (hits.get(req.url) ?? 0) + 1;
    hits.set(req.url, hit);
    if (req.headers["x-vercel-protection-bypass"] !== BYPASS) return res.writeHead(401).end();
    const route = table.get(req.url);
    const answer = Array.isArray(route) ? route[hit - 1] : route;
    if (answer === "drop") return req.socket.destroy();
    const status = answer ?? 404;
    res.writeHead(status, status >= 300 && status < 400 ? { location: "/ok" } : {}).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { baseUrl: `http://127.0.0.1:${port}`, hits, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("names each href that 404s or never answers, and passes the rest", async (t) => {
  const preview = await stubPreview({ "/ok": 200, "/missing": 404, "/silent": "drop" });
  t.after(preview.close);
  const failures = await checkLinks({ baseUrl: preview.baseUrl, hrefs: ["/ok", "/missing", "/silent"], bypass: BYPASS });
  assert.deepEqual(
    failures.map((failure) => failure.href),
    ["/missing", "/silent"],
  );
  assert.match(failures[0].reason, /404/);
  assert.match(failures[1].reason, /no response/);
});

test("retries once when a request gets no response, and only then", async (t) => {
  const preview = await stubPreview({ "/flaky": ["drop", 200], "/missing": 404 });
  t.after(preview.close);
  const failures = await checkLinks({ baseUrl: preview.baseUrl, hrefs: ["/flaky", "/missing"], bypass: BYPASS });
  assert.deepEqual(failures.map((failure) => failure.href), ["/missing"]);
  assert.deepEqual(Object.fromEntries(preview.hits), { "/flaky": 2, "/missing": 1 });
});

test("counts a redirect as a failure, even one that ends on a 200", async (t) => {
  // Vercel's sign-in is a 302, so a followed redirect could read as a pass.
  const preview = await stubPreview({ "/ok": 200, "/moved": 302 });
  t.after(preview.close);
  const failures = await checkLinks({ baseUrl: preview.baseUrl, hrefs: ["/moved"], bypass: BYPASS });
  assert.deepEqual(failures, [{ href: "/moved", reason: "HTTP 302" }]);
});

test("refuses an absolute href, and never sends the secret to another host", async (t) => {
  const preview = await stubPreview({ "/ok": 200 });
  const elsewhere = await stubPreview({ "/ok": 200 });
  t.after(preview.close);
  t.after(elsewhere.close);
  const hrefs = [`${preview.baseUrl}/ok`, `${elsewhere.baseUrl}/ok`, `//${new URL(elsewhere.baseUrl).host}/ok`, "/ok"];
  const failures = await checkLinks({ baseUrl: preview.baseUrl, hrefs, bypass: BYPASS });
  assert.deepEqual(failures.map((failure) => failure.href), hrefs.slice(0, 3));
  assert.equal(elsewhere.hits.size, 0);
});
