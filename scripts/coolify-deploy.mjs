// Deploys one image tag to production on Coolify and waits for the deployment to end,
// so `.github/workflows/deploy-production.yml` can apply migrations FIRST and
// only then put new code in front of users (ADR-091). Tested by
// `scripts/__tests__/coolify-deploy.test.mjs`.
//
// What it deploys (M64, D6): Actions builds `ghcr.io/<repo>/web:<sha>` and pushes
// it, and Coolify only pulls and runs it. So the application's image tag is set
// first (PATCH), and the deploy that follows pulls that tag; a POST alone would
// run whatever tag the application held before.
//
// Why it waits instead of firing and forgetting: Coolify queues an API deploy
// as commit `HEAD`, and refuses a second one ("Deployment already
// queued for this commit.") while a `HEAD` deployment of the same application
// is queued or building (`queue_application_deployment`, Coolify v4.7.5). Two
// pushes close together would otherwise build only the first. The workflow's
// concurrency group runs one deploy at a time, and this wait is what makes
// "one at a time" true on the box and not just in Actions.
//
// The API (Coolify v4.7.5, `routes/api.php` and `DeployController`):
//   PATCH /api/v1/applications/{uuid}   { docker_registry_image_tag }; needs `write`.
//   POST /api/v1/deploy?uuid=<app>&force=false   needs `deploy`; `GET /deploy`
//        answers "use POST" on this version. 200 { deployments: [{ message,
//        resource_uuid, deployment_uuid }] }; 429 when the queue is full.
//   GET  /api/v1/deployments/{deployment_uuid}    needs `read`; `status` is one
//        of queued, in_progress, finished, failed, cancelled-by-user.
//
// CLI (prints no secret; the token goes only into the Authorization header):
//   COOLIFY_URL=https://coolify.caesura.today COOLIFY_API_TOKEN=… COOLIFY_APP_UUID=… \
//   COOLIFY_IMAGE_TAG=<sha> node scripts/coolify-deploy.mjs
import { queueDeploy, setImageTag, waitForDeployment } from "./coolify-api.mjs";

export { queueDeploy, waitForDeployment };

/**
 * The CLI: set the image tag, queue, wait, and throw unless the deployment finished.
 * @returns {Promise<string>} the line to print.
 */
export async function main(env, deps = {}) {
  const base = (env.COOLIFY_URL ?? "").replace(/\/+$/, "");
  const { COOLIFY_API_TOKEN: token, COOLIFY_APP_UUID: uuid, COOLIFY_IMAGE_TAG: tag } = env;
  if (!base || !token || !uuid || !tag) {
    throw new Error("COOLIFY_URL, COOLIFY_API_TOKEN, COOLIFY_APP_UUID and COOLIFY_IMAGE_TAG must all be set");
  }
  await setImageTag({ base, token, uuid, tag, ...deps });
  const queued = await queueDeploy({ base, token, uuid, ...deps });
  if (queued.skipped) {
    // Somebody started a deployment outside this workflow (the dashboard's
    // Redeploy). It pulls the tag set just above; waiting on a deployment this
    // run cannot name buys nothing.
    return `Coolify already has a deployment in flight (${queued.message}); not starting a second one.`;
  }
  const status = await waitForDeployment({ base, token, deploymentUuid: queued.deploymentUuid, ...deps });
  if (status !== "finished") throw new Error(`deployment ${queued.deploymentUuid} ended ${status}; see Coolify → caesura-web → Deployments`);
  return `Deployment ${queued.deploymentUuid} finished.`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.env).then(
    (line) => console.log(line),
    (error) => {
      console.error(`::error::${error.message}`);
      process.exit(1);
    },
  );
}
