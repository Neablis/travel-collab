// Runs drizzle migrations during the Vercel build — PREVIEW ONLY, and only
// against a database the operator has explicitly marked disposable.
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
import { execSync } from "node:child_process";

const env = process.env.VERCEL_ENV ?? "unset";

if (env !== "preview") {
  console.log(`[vercel-build-migrate] skipped (VERCEL_ENV=${env})`);
} else if (process.env.PREVIEW_DB_IS_DISPOSABLE !== "true") {
  console.error(
    "[vercel-build-migrate] REFUSING to migrate: PREVIEW_DB_IS_DISPOSABLE is not " +
      `"true" (got ${JSON.stringify(process.env.PREVIEW_DB_IS_DISPOSABLE ?? null)}).\n` +
      "\n" +
      "This build would run drizzle-kit migrate against whatever DATABASE_URL it\n" +
      "was given, and nothing here can prove that is a disposable preview branch.\n" +
      "\n" +
      "To fix: point the Preview scope's DATABASE_URL at a preview branch, then set\n" +
      "PREVIEW_DB_IS_DISPOSABLE=true on the Preview scope ONLY. Never set it on\n" +
      "Production — production is migrated by dispatching migrate-production.",
  );
  process.exit(1);
} else {
  execSync("pnpm drizzle-kit migrate", { stdio: "inherit" });
}
