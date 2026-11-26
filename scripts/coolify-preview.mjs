// Deploys, or stops, the ONE preview app (`caesura-preview`) on Coolify, so a
// preview exists only while a PR carries the `preview` label. Run by
// `.github/workflows/coolify-preview.yml`; tested by
// `scripts/__tests__/coolify-preview.test.mjs`.
//
// Why an app and not Coolify's git previews (M64, D6 and D8; the plan is
// `docs/plans/2026-11-24-M64-one-cheap-box-own-postgres.md`): Actions builds the
// image and pushes it to GHCR as `web:pr-<n>`, and Coolify only pulls and runs
// it, so there is no git source to hang a `<pr>.preview` URL on. The preview is
// a second application at https://preview.caesura.today, and deploying a PR to
// it replaces whichever PR was there. The box's memory ceiling is why there is
// one (on 2026-11-14 fifteen previews plus ten production builds ran it out of
// memory); with no build on the box the ceiling is lower, but one stays.
//
// The API (Coolify v4.7.5):
//   PATCH  /api/v1/applications/{uuid}   { docker_registry_image_tag }; needs `write`
//   POST   /api/v1/deploy?uuid=<app>     needs `deploy`; 200 { deployments: [{ deployment_uuid }] }
//   POST   /api/v1/applications/{uuid}/stop   needs `deploy`; 404 means no such application
//
// CLI:
//   COOLIFY_URL=https://coolify.caesura.today COOLIFY_API_TOKEN=… COOLIFY_APP_UUID=… \
//   node scripts/coolify-preview.mjs open <pr> <head sha>     deploys image tag pr-<pr>
//   node scripts/coolify-preview.mjs remove <pr>              stops the preview app

/** Throws with Coolify's own message, so a red job names what Coolify refused. */
export async function failed(res, what) {
  const body = await res.text().catch(() => "");
  let message = body.slice(0, 500);
  try {
    message = JSON.parse(body).message ?? message;
  } catch {}
  throw new Error(`${what}: HTTP ${res.status} ${message}`.trim());
}

/** The image tag a PR's preview is built under (`web:pr-<n>`). */
export const previewTag = (pr) => `pr-${pr}`;

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

/**
 * Deploys PR `pr`'s image to the preview app.
 * @returns {Promise<{ deploymentUuid: string | null }>}
 */
export async function openPreview({ base, token, uuid, pr, fetchImpl = fetch }) {
  await setImageTag({ base, token, uuid, tag: previewTag(pr), fetchImpl });
  const res = await fetchImpl(`${base}/api/v1/deploy?uuid=${encodeURIComponent(uuid)}&force=false`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (res.status !== 200) await failed(res, `deploying the preview of PR ${pr}`);
  const json = await res.json().catch(() => ({}));
  return { deploymentUuid: json.deployments?.[0]?.deployment_uuid ?? null };
}

/**
 * Stops the preview app, so the box holds no preview container.
 * @returns {Promise<{ removed: boolean }>} `removed: false` when Coolify has no such application.
 */
export async function removePreview({ base, token, uuid, pr, fetchImpl = fetch }) {
  const res = await fetchImpl(`${base}/api/v1/applications/${encodeURIComponent(uuid)}/stop`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (res.status === 404) return { removed: false };
  if (res.status < 200 || res.status >= 300) await failed(res, `stopping the preview for PR ${pr}`);
  return { removed: true };
}

function positiveInt(text, name) {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer, got ${JSON.stringify(text)}`);
  return n;
}

async function main(argv, env) {
  const [command, prText, sha] = argv;
  const base = (env.COOLIFY_URL ?? "").replace(/\/+$/, "");
  const { COOLIFY_API_TOKEN: token, COOLIFY_APP_UUID: uuid } = env;
  if (!base || !token || !uuid) throw new Error("COOLIFY_URL, COOLIFY_API_TOKEN and COOLIFY_APP_UUID must all be set");
  const pr = positiveInt(prText, "the PR number");
  if (command === "open") {
    if (!/^[0-9a-f]{7,40}$/i.test(sha ?? "")) throw new Error(`a head sha is required, got ${JSON.stringify(sha)}`);
    const { deploymentUuid } = await openPreview({ base, token, uuid, pr });
    console.log(`Deploying the preview of PR ${pr} at ${sha} (deployment ${deploymentUuid ?? "not reported"}).`);
  } else if (command === "remove") {
    const { removed } = await removePreview({ base, token, uuid, pr });
    console.log(removed ? `Stopped the preview app (PR ${pr} had it).` : "The preview app does not exist; nothing to stop.");
  } else {
    throw new Error(`unknown command ${JSON.stringify(command)}: use "open" or "remove"`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2), process.env).catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}

export { main };
