// Runs drizzle migrations during the Vercel build — PREVIEW ONLY.
// Production is migrated by the migrate-production job in ci.yml (explicit,
// post-CI, per ADR-004); previews own a disposable Neon branch (M2 Task 0a),
// so migrating at build time is safe there.
import { execSync } from "node:child_process";

if (process.env.VERCEL_ENV === "preview") {
  execSync("pnpm drizzle-kit migrate", { stdio: "inherit" });
} else {
  console.log(`[vercel-build-migrate] skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"})`);
}
