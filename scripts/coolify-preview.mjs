// Opens, rebuilds or removes ONE pull request's preview on Coolify, so a preview
// exists only while the PR carries the `preview` label. Run by
// `.github/workflows/coolify-preview.yml`; tested by
// `scripts/__tests__/coolify-preview.test.mjs`.
//
// Why: Coolify's GitHub App, with Preview Deployments switched on, builds and
// keeps running a preview of EVERY pull request. On the 8 GB box that is not a
// bill but a memory ceiling: on 2026-11-14 fifteen previews plus ten production
// builds ran it out of memory and took caesura.today down. So Preview
// Deployments is switched off on `caesura-web`, and previews are opened through
// Coolify's API instead, the way the `preview` label opened Vercel previews
// before M59. A closed PR's preview is still torn down by Coolify's own webhook
// (it handles `closed` with previews off); `remove` here is for taking the label
// off an open PR, and is idempotent.
//
// The API (Coolify v4.4.0 or later):
//   POST   /api/v1/applications/{uuid}/previews   create or update, then deploy
//          { pull_request_id, pull_request_html_url, commit, instant_deploy }
//          needs a token with `write` (opening a preview, choosing a commit)
//   DELETE /api/v1/applications/{uuid}/previews/{pull_request_id}
//          needs `delete`; 404 means there was nothing to remove
//
// CLI:
//   COOLIFY_URL=https://coolify.caesura.today COOLIFY_API_TOKEN=… COOLIFY_APP_UUID=… \
//   node scripts/coolify-preview.mjs open <pr> <head sha> <pr html url>
//   node scripts/coolify-preview.mjs remove <pr>

/** Throws with Coolify's own message, so a red job names what Coolify refused. */
async function failed(res, what) {
  const body = await res.text().catch(() => "");
  let message = body.slice(0, 500);
  try {
    message = JSON.parse(body).message ?? message;
  } catch {}
  throw new Error(`${what}: HTTP ${res.status} ${message}`.trim());
}

/**
 * Creates the PR's preview if it has none, and deploys `sha` to it.
 * @returns {Promise<{ created: boolean, deploymentUuid: string | null }>}
 */
export async function openPreview({ base, token, uuid, pr, sha, url, fetchImpl = fetch }) {
  const res = await fetchImpl(`${base}/api/v1/applications/${encodeURIComponent(uuid)}/previews`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ pull_request_id: pr, pull_request_html_url: url, commit: sha, instant_deploy: true }),
  });
  if (res.status !== 200 && res.status !== 201) await failed(res, `opening the preview of PR ${pr}`);
  const json = await res.json().catch(() => ({}));
  return { created: res.status === 201, deploymentUuid: json.deployment_uuid ?? null };
}

/**
 * Removes the PR's preview (its container and its record).
 * @returns {Promise<{ removed: boolean }>} `removed: false` when there was none.
 */
export async function removePreview({ base, token, uuid, pr, fetchImpl = fetch }) {
  const res = await fetchImpl(`${base}/api/v1/applications/${encodeURIComponent(uuid)}/previews/${pr}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (res.status === 404) return { removed: false };
  if (res.status < 200 || res.status >= 300) await failed(res, `removing the preview of PR ${pr}`);
  return { removed: true };
}

function positiveInt(text, name) {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer, got ${JSON.stringify(text)}`);
  return n;
}

async function main(argv, env) {
  const [command, prText, sha, url] = argv;
  const base = (env.COOLIFY_URL ?? "").replace(/\/+$/, "");
  const { COOLIFY_API_TOKEN: token, COOLIFY_APP_UUID: uuid } = env;
  if (!base || !token || !uuid) throw new Error("COOLIFY_URL, COOLIFY_API_TOKEN and COOLIFY_APP_UUID must all be set");
  const pr = positiveInt(prText, "the PR number");
  if (command === "open") {
    if (!/^[0-9a-f]{7,40}$/i.test(sha ?? "")) throw new Error(`a head sha is required, got ${JSON.stringify(sha)}`);
    const { created, deploymentUuid } = await openPreview({ base, token, uuid, pr, sha, url });
    console.log(`${created ? "Opened" : "Rebuilding"} the preview of PR ${pr} at ${sha} (deployment ${deploymentUuid ?? "not reported"}).`);
  } else if (command === "remove") {
    const { removed } = await removePreview({ base, token, uuid, pr });
    console.log(removed ? `Removed the preview of PR ${pr}.` : `PR ${pr} had no preview to remove.`);
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
