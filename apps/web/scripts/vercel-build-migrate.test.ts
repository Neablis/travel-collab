import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildSteps, runBuildSteps } from "./lib/vercel-build-steps.mjs";
import {
  describeMigrateError,
  diagnoseAppliedMigrations,
  renumberedMessage,
} from "./lib/preview-migrate.mjs";

const ENTRY = fileURLToPath(new URL("./vercel-build-migrate.mjs", import.meta.url));

// M51 part 7: a preview's database holds the library the landing sea links
// into, so a preview build imports `content/` after migrating. Production's
// content is dispatched by hand (`import-content-production.yml`), never here.
describe("the Vercel build's database steps", () => {
  it("imports content on a disposable preview, after migrating and without pruning", () => {
    const steps = buildSteps({ VERCEL_ENV: "preview", PREVIEW_DB_IS_DISPOSABLE: "true" });
    expect(steps.run).toEqual([
      "node scripts/preview-migrate.mjs",
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

// KI-2026-10-17-c: every preview migrates one shared Neon branch, and drizzle
// applies whatever is newer than the newest applied row. A migration applied by
// its preview and then regenerated under a newer number runs twice.
describe("the preview migrate's check of the applied rows", () => {
  const journal = [
    { tag: "0055_a", when: 1000, hash: "h55" },
    { tag: "0056_b", when: 2000, hash: "h56" },
    { tag: "0057_tier_weekly", when: 3000, hash: "hTier" },
  ];
  const row = (id: number, hash: string, createdAt: number) => ({ id, hash, created_at: String(createdAt) });

  it("refuses a row whose number changed but whose SQL is about to run again", () => {
    // M47: part 4's 0056_tier_weekly (when 2500) was applied, then regenerated as 0057.
    const rows = [row(57, "h55", 1000), row(59, "hTier", 2500)];
    const { renumbered } = diagnoseAppliedMigrations(journal, rows);
    expect(renumbered.map(({ row: r, entry }) => [r.id, entry.tag])).toEqual([[59, "0057_tier_weekly"]]);
  });

  it("lets another open PR's newer migration be, since nothing in this tree would run after it", () => {
    const rows = [row(57, "h55", 1000), row(58, "h56", 2000), row(59, "hTier", 3000), row(60, "hOther", 4000)];
    expect(diagnoseAppliedMigrations(journal, rows)).toMatchObject({ toApply: [], orphans: [], renumbered: [] });
  });

  it("does not refuse an unmatched row whose SQL differs, but names it as an orphan", () => {
    const rows = [row(57, "h55", 1000), row(58, "hOther", 1500)];
    const { orphans, renumbered } = diagnoseAppliedMigrations(journal, rows);
    expect({ orphans: orphans.map((r: { id: number }) => r.id), renumbered }).toEqual({ orphans: [58], renumbered: [] });
  });

  it("prints the row to delete in the recovery steps", () => {
    const { renumbered } = diagnoseAppliedMigrations(journal, [row(59, "hTier", 2500)]);
    expect(renumberedMessage(renumbered)).toContain("DELETE FROM drizzle.__drizzle_migrations WHERE id IN (59);");
  });

  it("puts the Postgres error drizzle wraps on the page", () => {
    const cause = Object.assign(new Error('relation "tier_weekly" already exists'), { code: "42P07" });
    const error = Object.assign(new Error("Failed query: CREATE TABLE tier_weekly"), { cause });
    expect(describeMigrateError(error).split("\n").slice(1)).toEqual([
      '  postgres: relation "tier_weekly" already exists',
      "  code: 42P07",
    ]);
  });
});
