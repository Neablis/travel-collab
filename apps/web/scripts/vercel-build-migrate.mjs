// Runs drizzle migrations during the Vercel build — PREVIEW ONLY.
// Production is migrated by explicitly dispatching
// .github/workflows/migrate-production.yml (per ADR-004's "explicit
// CI/deploy step" rule — a dispatch is more explicit than the post-merge job
// this replaced, not less); previews own a disposable Neon branch (M2 Task
// 0a), so migrating at build time is safe there.
import { execSync } from "node:child_process";

if (process.env.VERCEL_ENV === "preview") {
  execSync("pnpm drizzle-kit migrate", { stdio: "inherit" });
} else {
  console.log(`[vercel-build-migrate] skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"})`);
}
