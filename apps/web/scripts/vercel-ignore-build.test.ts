import { describe, expect, it } from "vitest";
import { isProseOnly, isProsePath } from "./lib/prose-only.mjs";

// A merge that changes only prose skips its production deployment
// (`vercel-ignore-build.mjs`). A wrong "prose" ships nothing; a wrong "code"
// only costs a build, so the doubtful cases are code.
describe("isProsePath", () => {
  it.each(["docs/STATUS.md", "docs/architecture/ADR-088.md", ".claude/skills/x/SKILL.md", "README.md", "TODO.md"])(
    "treats %s as prose",
    (path) => {
      expect(isProsePath(path)).toBe(true);
    },
  );

  it.each([
    "apps/web/src/app/robots.ts",
    "apps/web/README.md",
    "content/playbooks/kyoto.json",
    ".design-sync/tokens.json",
    "apps/web/vercel.json",
    "pnpm-lock.yaml",
    "docsy/x.md",
  ])("treats %s as code", (path) => {
    expect(isProsePath(path)).toBe(false);
  });
});

describe("isProseOnly", () => {
  it("skips a docs-only merge", () => {
    expect(isProseOnly(["docs/STATUS.md", "TODO.md", ""])).toBe(true);
  });

  it("builds when one path is code", () => {
    expect(isProseOnly(["docs/STATUS.md", "apps/web/src/proxy.ts"])).toBe(false);
  });

  // An empty diff is a redeploy of the same commit, which someone asked for.
  it("builds when nothing changed", () => {
    expect(isProseOnly([""])).toBe(false);
    expect(isProseOnly([])).toBe(false);
  });
});
