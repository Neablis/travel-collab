import { describe, expect, it } from "vitest";
import { buildSteps } from "./vercel-build-migrate.mjs";

// M51 part 7: a preview's database holds the library the landing sea links
// into, so a preview build imports `content/` after migrating. Production's
// content is dispatched by hand (`import-content-production.yml`), never here.
describe("the Vercel build's database steps", () => {
  it("imports content on a disposable preview, after migrating and without pruning", () => {
    const steps = buildSteps({ VERCEL_ENV: "preview", PREVIEW_DB_IS_DISPOSABLE: "true" });
    expect(steps.run).toEqual([
      "pnpm drizzle-kit migrate",
      expect.stringMatching(/scripts\/import-content-production\.ts$/),
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
});
