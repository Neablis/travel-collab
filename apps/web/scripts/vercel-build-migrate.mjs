// Runs drizzle migrations, then imports `content/`, during the Vercel build —
// PREVIEW ONLY, and only against a database the operator has explicitly marked
// disposable.
// Production is migrated by explicitly dispatching
// .github/workflows/migrate-production.yml (per ADR-004's "explicit
// CI/deploy step" rule — a dispatch is more explicit than the post-merge job
// this replaced, not less).
//
// **Why there are two conditions and not one.** For six weeks the only check
// here was `VERCEL_ENV === "preview"`, which asks where the BUILD is running
// and not what the DATABASE is. The Neon integration injected one
// `DATABASE_URL` scoped "Production and Preview" — the same value for both —
// so every preview build ran `drizzle-kit migrate` against production. Four
// migrations (0015-0018) reached the live database that way, while the
// carefully gated `migrate-production` workflow was writing to a different
// database nobody read. Discovered 2026-09-06; see
// docs/known-issues/open/KI-2026-09-06-h.
//
// `PREVIEW_DB_IS_DISPOSABLE` is the second condition because it is the one a
// misconfiguration cannot satisfy by accident. `VERCEL_ENV` is set by the
// platform and says nothing about the connection string; this variable is set
// by hand, on the Preview scope only, and means "I have checked that this
// database is a throwaway branch". A shared or production connection string
// cannot acquire it by drifting.
//
// Fail-closed, following `matchesSuperCode`'s reasoning in server/admission.ts:
// the two failure directions are not symmetric. A preview that refuses to
// migrate is a red build with this message on it. A preview that migrates the
// wrong database is silent, and stays silent for six weeks.
//
// **Why a preview imports content (M51 part 7).** The landing's sea links every
// library day to its page, and a preview that migrated but imported nothing
// answered 147 of its 148 links with a 404. The importer is the production one,
// which writes the database directly: `import-content.ts` talks HTTP to a
// running app, and none is running yet. It never gets `--prune`, because every
// open PR's preview shares this one database, and pruning to one branch's
// `content/` would delete the days another branch added.
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
      "node --import ./scripts/lib/ts-resolve-register.mjs scripts/import-content-production.ts",
    ],
  };
}

// Only as the command, so the test can import `buildSteps` without migrating.
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const steps = buildSteps(process.env);
  if ("skip" in steps) {
    console.log(steps.skip);
  } else if ("refuse" in steps) {
    console.error(steps.refuse);
    process.exit(1);
  } else {
    for (const command of steps.run) execSync(command, { stdio: "inherit" });
  }
}
