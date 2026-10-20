// What `vercel-build-migrate.mjs` does, apart from the entry, so the test can
// import it without migrating anything. The entry's header says why.

/**
 * What this build does to its database, decided from the environment alone so
 * the decision can be tested without running a build: skip it, refuse it, or
 * run these commands in order.
 */
export function buildSteps(environment) {
  const env = environment.VERCEL_ENV ?? "unset";
  if (env !== "preview") return { skip: `[vercel-build-migrate] skipped (VERCEL_ENV=${env})` };
  if (environment.PREVIEW_DB_IS_DISPOSABLE !== "true") {
    return {
      refuse:
        "[vercel-build-migrate] REFUSING to migrate: PREVIEW_DB_IS_DISPOSABLE is not " +
        `"true" (got ${JSON.stringify(environment.PREVIEW_DB_IS_DISPOSABLE ?? null)}).\n` +
        "\n" +
        "This build would run drizzle-kit migrate against whatever DATABASE_URL it\n" +
        "was given, and nothing here can prove that is a disposable preview branch.\n" +
        "\n" +
        "To fix: point the Preview scope's DATABASE_URL at a preview branch, then set\n" +
        "PREVIEW_DB_IS_DISPOSABLE=true on the Preview scope ONLY. Never set it on\n" +
        "Production — production is migrated by dispatching migrate-production.",
    };
  }
  return {
    run: [
      "pnpm drizzle-kit migrate",
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
