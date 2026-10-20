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

/** A stub preview: `routes` maps a path to a status, "drop" to close the socket unanswered, or a list of those, one per hit. */
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
    res.writeHead(answer ?? 404).end();
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
