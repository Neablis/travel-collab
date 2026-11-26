// The Coolify API calls shared by `coolify-deploy.mjs` (production) and
// `coolify-preview.mjs` (the preview app): refusals named with Coolify's own
// message, the image tag, queueing a deployment and waiting for it to end.
// Tested through those two scripts' tests.
//
// Coolify queues an API deploy as commit `HEAD` and refuses a second one
// ("Deployment already queued for this commit.") while a `HEAD` deployment of
// the same application is queued or building (`queue_application_deployment`,
// v4.7.5), answering 200 with a deployment uuid that was never stored.

/** Throws with Coolify's own message, so a red job names what Coolify refused. */
export async function failed(res, what) {
  const body = await res.text().catch(() => "");
  let message = body.slice(0, 500);
  try {
    message = JSON.parse(body).message ?? message;
  } catch {}
  throw new Error(`${what}: HTTP ${res.status} ${message}`.trim());
}

/**
 * Points the application at one image tag. The deploy that follows pulls
 * whatever tag the application holds when it starts, so this comes first.
 */
export async function setImageTag({ base, token, uuid, tag, fetchImpl = fetch }) {
  const res = await fetchImpl(`${base}/api/v1/applications/${encodeURIComponent(uuid)}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ docker_registry_image_tag: tag }),
  });
  if (res.status !== 200) await failed(res, `setting the image tag to ${tag}`);
}

export const DONE = new Set(["finished", "failed", "cancelled-by-user"]);
// Coolify's own wording for the skip above. Matched loosely: the message is the
// only thing that tells a skip apart, and a skip returns a deployment uuid that
// was never stored, so following it would 404.
const ALREADY_QUEUED = /already queued/i;

/**
 * Queues a deployment of the application's configured image tag.
 * @returns {Promise<{ deploymentUuid: string | null, message: string, skipped: boolean }>}
 *   `skipped` when Coolify already has a deployment of that branch in flight.
 */
export async function queueDeploy({ base, token, uuid, what = "the production deploy", fetchImpl = fetch }) {
  const res = await fetchImpl(`${base}/api/v1/deploy?uuid=${encodeURIComponent(uuid)}&force=false`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (res.status !== 200) await failed(res, `queueing ${what}`);
  const json = await res.json().catch(() => ({}));
  const entry = (json.deployments ?? []).find((d) => d.resource_uuid === uuid) ?? json.deployments?.[0];
  if (!entry) throw new Error(`queueing ${what}: Coolify answered 200 with no deployment`);
  const message = String(entry.message ?? "");
  if (ALREADY_QUEUED.test(message)) return { deploymentUuid: null, message, skipped: true };
  if (!entry.deployment_uuid) throw new Error(`queueing ${what}: ${message || "no deployment uuid returned"}`);
  return { deploymentUuid: entry.deployment_uuid, message, skipped: false };
}

/**
 * Polls one deployment until Coolify reports it finished, failed or cancelled.
 * @returns {Promise<string>} the final status.
 * @throws when the poll itself fails or `timeoutMs` passes first.
 */
export async function waitForDeployment({
  base,
  token,
  deploymentUuid,
  intervalMs = 15_000,
  timeoutMs = 30 * 60_000,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const res = await fetchImpl(`${base}/api/v1/deployments/${encodeURIComponent(deploymentUuid)}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (res.status !== 200) await failed(res, `reading deployment ${deploymentUuid}`);
    const { status } = await res.json().catch(() => ({}));
    if (DONE.has(status)) return status;
    if (now() >= deadline) {
      throw new Error(`deployment ${deploymentUuid} was still ${status ?? "unknown"} after ${Math.round(timeoutMs / 60_000)} min`);
    }
    await sleep(intervalMs);
  }
}

