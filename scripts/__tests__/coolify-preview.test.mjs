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

test("open sets the PR's image tag, then deploys the preview app, with the token", async () => {
  seen.length = 0;
  respond = ({ method }) =>
    method === "PATCH" ? [200, { message: "Application updated successfully." }] : [200, { deployments: [{ deployment_uuid: "dep-1" }] }];
  assert.deepEqual(await openPreview({ ...common(), pr: 745 }), { deploymentUuid: "dep-1" });
  assert.deepEqual(seen, [
    // Tag first: the deploy pulls whatever tag the application holds when it starts.
    { method: "PATCH", url: "/api/v1/applications/app-uuid", auth: "Bearer t0k", body: { docker_registry_image_tag: "pr-745" } },
    { method: "POST", url: "/api/v1/deploy?uuid=app-uuid&force=false", auth: "Bearer t0k", body: null },
  ]);
});

test("open names Coolify's refusal, so a red job says why, and deploys nothing after a refused tag", async () => {
  seen.length = 0;
  respond = () => [403, { message: "Missing required permissions: write." }];
  await assert.rejects(openPreview({ ...common(), pr: 9 }), /setting the image tag to pr-9: HTTP 403 Missing required permissions: write\./);
  assert.deepEqual(seen.map((r) => r.method), ["PATCH"]);
  respond = ({ method }) => (method === "PATCH" ? [200, {}] : [429, { message: "Deployment queue is full." }]);
  await assert.rejects(openPreview({ ...common(), pr: 9 }), /deploying the preview of PR 9: HTTP 429 Deployment queue is full\./);
});

test("remove stops the preview app, and a 404 means there was none", async () => {
  seen.length = 0;
  respond = () => [200, { message: "Application stopping request queued." }];
  assert.deepEqual(await removePreview({ ...common(), pr: 745 }), { removed: true });
  assert.equal(seen[0].method, "POST");
  assert.equal(seen[0].url, "/api/v1/applications/app-uuid/stop");
  respond = () => [404, { message: "Application not found." }];
  assert.deepEqual(await removePreview({ ...common(), pr: 745 }), { removed: false });
});

test("remove fails on any other error", async () => {
  respond = () => [500, { message: "boom" }];
  await assert.rejects(removePreview({ ...common(), pr: 1 }), /stopping the preview for PR 1: HTTP 500 boom/);
});

test("the CLI refuses to run without its settings, a sha or a known command", async () => {
  const env = { COOLIFY_URL: base, COOLIFY_API_TOKEN: "t", COOLIFY_APP_UUID: "u" };
  await assert.rejects(main(["open", "1", "abcdef1", "u"], {}), /must all be set/);
  await assert.rejects(main(["open", "1", "", "u"], env), /a head sha is required/);
  await assert.rejects(main(["open", "0", "abcdef1", "u"], env), /positive integer/);
  await assert.rejects(main(["build", "1"], env), /unknown command/);
});
