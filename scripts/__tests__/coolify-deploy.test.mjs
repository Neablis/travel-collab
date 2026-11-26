import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { main, queueDeploy, waitForDeployment } from "../coolify-deploy.mjs";

// A stand-in for Coolify's API that records each request and answers from
// `respond`, so each test states the answers it is about.
let server;
let base;
const seen = [];
let respond = () => [500, {}];

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, ...(body ? { body: JSON.parse(body) } : {}) });
      const [status, json] = respond({ method: req.method, url: req.url });
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const env = () => ({ COOLIFY_URL: `${base}/`, COOLIFY_API_TOKEN: "t0k", COOLIFY_APP_UUID: "app-uuid", COOLIFY_IMAGE_TAG: "0123abc" });
const noWait = { sleep: async () => {}, intervalMs: 0 };
const queued = (message = "Application caesura-web deployment queued.") => [
  200,
  { deployments: [{ message, resource_uuid: "app-uuid", deployment_uuid: "dep-1" }] },
];

/** Answers the deploy with `queued()`, then each status poll with the next of `statuses`. */
function script(statuses) {
  const left = [...statuses];
  return ({ method, url }) => {
    if (method === "PATCH") return [200, { message: "Application updated successfully." }];
    if (method === "POST" && url.startsWith("/api/v1/deploy?")) return queued();
    if (method === "GET" && url === "/api/v1/deployments/dep-1") return [200, { status: left.shift() }];
    return [404, { message: "Not found." }];
  };
}

test("deploy sets the image tag, then POSTs the app's uuid with force=false, then follows the deployment to finished", async () => {
  seen.length = 0;
  respond = script(["queued", "in_progress", "finished"]);
  assert.equal(await main(env(), noWait), "Deployment dep-1 finished.");
  assert.deepEqual(seen, [
    // The PATCH comes first: the deploy pulls whatever tag the application holds
    // when it starts, so a POST before it would run the previous image.
    { method: "PATCH", url: "/api/v1/applications/app-uuid", auth: "Bearer t0k", body: { docker_registry_image_tag: "0123abc" } },
    { method: "POST", url: "/api/v1/deploy?uuid=app-uuid&force=false", auth: "Bearer t0k" },
    { method: "GET", url: "/api/v1/deployments/dep-1", auth: "Bearer t0k" },
    { method: "GET", url: "/api/v1/deployments/dep-1", auth: "Bearer t0k" },
    { method: "GET", url: "/api/v1/deployments/dep-1", auth: "Bearer t0k" },
  ]);
});

test("a deployment that fails or is cancelled fails the run, naming how it ended", async () => {
  respond = script(["in_progress", "failed"]);
  await assert.rejects(main(env(), noWait), /deployment dep-1 ended failed/);
  respond = script(["cancelled-by-user"]);
  await assert.rejects(main(env(), noWait), /deployment dep-1 ended cancelled-by-user/);
});

test("a deployment still building at the deadline fails the run instead of polling forever", async () => {
  respond = () => [200, { status: "in_progress" }];
  let clock = 0;
  // Ten polls is far past the deadline; the eleventh means the deadline is not
  // being read, and ends the test red instead of hanging the suite.
  let polls = 0;
  const sleep = async () => {
    clock += 30_000;
    if (++polls > 10) throw new Error("polled past the deadline");
  };
  const deps = { ...noWait, timeoutMs: 60_000, now: () => clock, sleep };
  await assert.rejects(
    waitForDeployment({ base, token: "t0k", deploymentUuid: "dep-1", ...deps }),
    /deployment dep-1 was still in_progress after 1 min/,
  );
});

test("Coolify's refusal is named: a full queue, a token without read, a missing app", async () => {
  respond = () => [429, { message: "Deployment queue is full. Please wait for existing deployments to complete." }];
  await assert.rejects(queueDeploy({ base, token: "t", uuid: "app-uuid" }), /queueing the production deploy: HTTP 429 Deployment queue is full/);
  respond = ({ method }) => (method === "GET" ? [403, { message: "Missing required permissions: read" }] : method === "PATCH" ? [200, {}] : queued());
  await assert.rejects(main(env(), noWait), /reading deployment dep-1: HTTP 403 Missing required permissions: read/);
  respond = () => [404, { message: "No resources found." }];
  await assert.rejects(queueDeploy({ base, token: "t", uuid: "app-uuid" }), /HTTP 404 No resources found\./);
});

test("a deploy Coolify skips because one is already in flight succeeds without following a uuid that was never stored", async () => {
  seen.length = 0;
  respond = ({ method }) =>
    method === "PATCH" ? [200, {}] : method === "POST" ? queued("Deployment already queued for this commit.") : [404, { message: "Deployment not found." }];
  assert.match(await main(env(), noWait), /already has a deployment in flight/);
  assert.deepEqual(seen.map((r) => r.method), ["PATCH", "POST"]);
});

test("a refused tag change stops the run before anything is deployed", async () => {
  seen.length = 0;
  respond = () => [422, { message: "Validation failed." }];
  await assert.rejects(main(env(), noWait), /setting the image tag to 0123abc: HTTP 422 Validation failed\./);
  assert.deepEqual(seen.map((r) => r.method), ["PATCH"]);
});

test("the CLI refuses to run without its settings, the image tag included", async () => {
  await assert.rejects(main({ COOLIFY_URL: base, COOLIFY_API_TOKEN: "t" }), /must all be set/);
  const { COOLIFY_IMAGE_TAG: _tag, ...noTag } = env();
  await assert.rejects(main(noTag), /COOLIFY_IMAGE_TAG/);
});
