import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { main, openPreview, removePreview } from "../coolify-preview.mjs";

// A stand-in for Coolify's API that records each request and answers from
// `respond`, so each test states the answer it is about.
let server;
let base;
const seen = [];
let respond = () => [500, {}];

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const request = { method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null };
      seen.push(request);
      const [status, json] = respond(request);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const common = () => ({ base, token: "t0k", uuid: "app-uuid" });

test("open posts the PR, its head commit and its URL, with the token, and reports a new preview", async () => {
  seen.length = 0;
  respond = () => [201, { message: "Preview created.", deployment_uuid: "dep-1" }];
  const result = await openPreview({ ...common(), pr: 745, sha: "0277f83f927a", url: "https://github.com/o/r/pull/745" });
  assert.deepEqual(result, { created: true, deploymentUuid: "dep-1" });
  assert.deepEqual(seen, [
    {
      method: "POST",
      url: "/api/v1/applications/app-uuid/previews",
      auth: "Bearer t0k",
      body: { pull_request_id: 745, pull_request_html_url: "https://github.com/o/r/pull/745", commit: "0277f83f927a", instant_deploy: true },
    },
  ]);
});

test("open on a PR that already has a preview rebuilds it (200, not created)", async () => {
  respond = () => [200, { message: "Preview updated.", deployment_uuid: "dep-2" }];
  assert.deepEqual(await openPreview({ ...common(), pr: 745, sha: "abcdef1", url: "u" }), { created: false, deploymentUuid: "dep-2" });
});

test("open names Coolify's refusal, so a red job says why", async () => {
  respond = () => [403, { message: "Missing required permissions: write." }];
  await assert.rejects(openPreview({ ...common(), pr: 9, sha: "abcdef1", url: "u" }), /opening the preview of PR 9: HTTP 403 Missing required permissions: write\./);
});

test("remove deletes the PR's preview, and a 404 means there was none", async () => {
  seen.length = 0;
  respond = () => [200, { message: "Preview deletion request queued." }];
  assert.deepEqual(await removePreview({ ...common(), pr: 745 }), { removed: true });
  assert.equal(seen[0].method, "DELETE");
  assert.equal(seen[0].url, "/api/v1/applications/app-uuid/previews/745");
  respond = () => [404, { message: "Preview not found." }];
  assert.deepEqual(await removePreview({ ...common(), pr: 745 }), { removed: false });
});

test("remove fails on any other error", async () => {
  respond = () => [500, { message: "boom" }];
  await assert.rejects(removePreview({ ...common(), pr: 1 }), /removing the preview of PR 1: HTTP 500 boom/);
});

test("the CLI refuses to run without its settings, a sha or a known command", async () => {
  const env = { COOLIFY_URL: base, COOLIFY_API_TOKEN: "t", COOLIFY_APP_UUID: "u" };
  await assert.rejects(main(["open", "1", "abcdef1", "u"], {}), /must all be set/);
  await assert.rejects(main(["open", "1", "", "u"], env), /a head sha is required/);
  await assert.rejects(main(["open", "0", "abcdef1", "u"], env), /positive integer/);
  await assert.rejects(main(["build", "1"], env), /unknown command/);
});
