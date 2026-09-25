// The one decision in vercel-ignore-build.mjs: which builds Vercel skips.
// Getting it wrong in one direction burns the daily deployment limit (which
// once swallowed a production merge); in the other, a PR someone is reviewing
// has no preview. The GitHub lookup is not stubbed — `decide` takes its answer.
//
// Lives beside the script for the same reason with-test-db.test.ts does;
// vitest.unit.config.ts's node project names it file by file.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decide, exitCodeFor } from "./vercel-ignore-build.mjs";

const SCRIPT = fileURLToPath(new URL("./vercel-ignore-build.mjs", import.meta.url));

const preview = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "claude/some-branch" };

describe("vercel-ignore-build decide", () => {
  it("always builds production, whatever GitHub says", () => {
    expect(decide({ ...preview, VERCEL_ENV: "production" }, null).build).toBe(true);
  });

  it("skips a preview for a branch with no open pull request", () => {
    expect(decide(preview, null).build).toBe(false);
  });

  it("skips a preview for a draft pull request", () => {
    expect(decide(preview, { draft: true }).build).toBe(false);
  });

  it("builds a preview for an open, non-draft pull request", () => {
    expect(decide(preview, { draft: false }).build).toBe(true);
  });

  it("builds when GitHub could not be asked, rather than lose a preview", () => {
    expect(decide(preview, "unknown").build).toBe(true);
  });
});

// Vercel reads exit 0 as "skip" — the reverse of the usual convention — so the
// mapping is pinned on its own, and once through the real command.
describe("vercel-ignore-build exit code", () => {
  it("exits 0 to skip and 1 to build", () => {
    expect(exitCodeFor(false)).toBe(0);
    expect(exitCodeFor(true)).toBe(1);
  });

  it("exits 1 from the command for a production build", () => {
    const run = spawnSync(process.execPath, [SCRIPT], {
      env: { ...process.env, VERCEL_ENV: "production" },
      encoding: "utf8",
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("building — production build");
  });
});
