// What `build-migrate.mjs` does, apart from the entry, so the test can
// import it without migrating anything. The entry's header says why.
//
// M64 part 4: this runs in `coolify-preview.yml`, over the SSH tunnel, before
// the preview's image is deployed. It no longer runs inside the image build:
// `next build` has no database to migrate, and `Dockerfile` does not call it.

/** The one database a preview may be migrated into (D8): the box's, never production's. */
const PREVIEW_DATABASE = "caesura_preview";

/** The database name in a Postgres URL, or null when it is not a URL. */
function databaseName(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.slice(1));
  } catch {
    return null;
  }
}

/**
 * What this build does to its database, decided from the environment alone so
 * the decision can be tested without running a build: skip it, refuse it, or
 * run these commands in order.
 */
export function buildSteps(environment) {
  // The same precedence as `deployEnv()` in `src/lib/deployment/env.ts`, which
  // a script cannot import: `APP_ENV` first, `VERCEL_ENV` as the fallback, and
  // an empty string counts as unset.
  const env = environment.APP_ENV || environment.VERCEL_ENV || "unset";
  if (env !== "preview") return { skip: `[build-migrate] skipped (APP_ENV=${env})` };
  if (environment.PREVIEW_DB_IS_DISPOSABLE !== "true") {
    return {
      refuse:
        "[build-migrate] REFUSING to migrate: PREVIEW_DB_IS_DISPOSABLE is not " +
        `"true" (got ${JSON.stringify(environment.PREVIEW_DB_IS_DISPOSABLE ?? null)}).\n` +
        "\n" +
        "This would run the migrations against whatever DATABASE_URL it was given,\n" +
        "and the flag is how a person says that database is a throwaway.\n" +
        "\n" +
        "To fix: point the PREVIEW_DATABASE_URL secret at caesura_preview, then set\n" +
        "PREVIEW_DB_IS_DISPOSABLE=true in coolify-preview.yml ONLY. Never on production,\n" +
        "which deploy-production migrates, before it deploys.",
    };
  }
  // The flag is set by hand; the name is what the URL points at. A production
  // URL pasted into the preview secret stops here instead of being migrated.
  const database = databaseName(environment.DATABASE_URL ?? "");
  if (database !== PREVIEW_DATABASE) {
    return {
      refuse:
        `[build-migrate] REFUSING to migrate: DATABASE_URL names the database ${JSON.stringify(database)}, ` +
        `and a preview is only ever migrated into ${PREVIEW_DATABASE}.`,
    };
  }
  return {
    run: [
      // Not `pnpm drizzle-kit migrate`: its spinner hid the Postgres error,
      // and it cannot tell a renumbered migration (KI-2026-10-17-c).
      "node scripts/preview-migrate.mjs",
      // --lock: every open PR's preview imports into this one database.
      "node --import ./scripts/lib/ts-resolve-register.mjs scripts/import-content-production.ts --lock",
    ],
  };
}

/**
 * Carries out `buildSteps`, handing each command to `exec`, and returns the
 * exit code. A command that fails throws out of `exec`, which fails the build.
 */
export function runBuildSteps(environment, exec) {
  const steps = buildSteps(environment);
  if ("skip" in steps) {
    console.log(steps.skip);
    return 0;
  }
  if ("refuse" in steps) {
    console.error(steps.refuse);
    return 1;
  }
  for (const command of steps.run) exec(command);
  return 0;
}
