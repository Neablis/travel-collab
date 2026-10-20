import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildSteps, runBuildSteps } from "./lib/vercel-build-steps.mjs";

const ENTRY = fileURLToPath(new URL("./vercel-build-migrate.mjs", import.meta.url));

// M51 part 7: a preview's database holds the library the landing sea links
// into, so a preview build imports `content/` after migrating. Production's
// content is dispatched by hand (`import-content-production.yml`), never here.
describe("the Vercel build's database steps", () => {
  it("imports content on a disposable preview, after migrating and without pruning", () => {
    const steps = buildSteps({ VERCEL_ENV: "preview", PREVIEW_DB_IS_DISPOSABLE: "true" });
    expect(steps.run).toEqual([
      "pnpm drizzle-kit migrate",
      expect.stringMatching(/scripts\/import-content-production\.ts --lock$/),
    ]);
  });

  it("never prunes a preview: the database is shared by every open PR", () => {
    const steps = buildSteps({ VERCEL_ENV: "preview", PREVIEW_DB_IS_DISPOSABLE: "true" });
    expect(steps.run?.filter((command) => command.includes("--prune"))).toEqual([]);
  });

  it("touches no database on production", () => {
    expect(buildSteps({ VERCEL_ENV: "production", PREVIEW_DB_IS_DISPOSABLE: "true" })).toEqual({
      skip: "[vercel-build-migrate] skipped (VERCEL_ENV=production)",
    });
  });

  it("refuses a preview whose database nobody has marked disposable", () => {
    expect(buildSteps({ VERCEL_ENV: "preview" })).toHaveProperty("refuse");
  });

  it("runs every step it decided on, in order", () => {
    const ran: string[] = [];
    const environment = { VERCEL_ENV: "preview", PREVIEW_DB_IS_DISPOSABLE: "true" };
    expect(runBuildSteps(environment, (command: string) => ran.push(command))).toBe(0);
    expect(ran).toEqual(buildSteps(environment).run);
  });

  // PR 509 review: the entry once acted only when `argv[1]` matched its own
  // URL. Node realpaths the URL and not `argv[1]`, so a symlink in the build
  // path made the whole step exit 0 in silence. Through one, it still refuses.
  it("refuses from the entry itself, even when it is reached through a symlink", () => {
    const dir = mkdtempSync(join(tmpdir(), "vercel-build-"));
    try {
      const link = join(dir, "vercel-build-migrate.mjs");
      symlinkSync(ENTRY, link);
      const env: NodeJS.ProcessEnv = { ...process.env, VERCEL_ENV: "preview" };
      delete env.PREVIEW_DB_IS_DISPOSABLE;
      const result = spawnSync(process.execPath, [link], { env, encoding: "utf8" });
      expect({ status: result.status, refused: result.stderr.includes("REFUSING") }).toEqual({
        status: 1,
        refused: true,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
