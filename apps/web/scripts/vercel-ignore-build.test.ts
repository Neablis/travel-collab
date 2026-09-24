// The one decision in vercel-ignore-build.mjs: which builds Vercel skips.
// Getting it wrong in one direction burns the daily deployment limit (which
// once swallowed a production merge); in the other, a PR someone is reviewing
// has no preview. The GitHub lookup is not stubbed — `decide` takes its answer.
//
// Lives beside the script for the same reason with-test-db.test.ts does;
// vitest.unit.config.ts's node project names it file by file.
import { describe, expect, it } from "vitest";
import { decide } from "./vercel-ignore-build.mjs";

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
