import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PREVIEW_REGISTRY, type PreviewId } from "./preview-registry";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

const SRC = join(__dirname, "..");
const used = new Set<string>();
for (const file of walk(SRC)) {
  // Skip the Preview component itself and *.test.tsx fixtures: this sync test
  // is about real app usage (shells), not the component's own definition or
  // unit-test render fixtures like `<Preview id="assistant-rail">` in
  // preview.test.tsx, which would otherwise falsely count as "used".
  if (file.endsWith("preview.tsx") || file.endsWith(".test.tsx")) continue;
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/<Preview[^>]*\bid=["']([\w-]+)["']/g)) used.add(m[1]!);
}

describe("preview registry ↔ usage", () => {
  it("every used <Preview id> is registered", () => {
    for (const id of used) expect(PREVIEW_REGISTRY).toHaveProperty(id);
  });
  // TODO(remove skip after Task 18): shells land incrementally across Tasks
  // 10, 14-18, so most registry entries are legitimately still unused for
  // most of that span — an `used.size === 0` guard only covers the very
  // first moment (before Task 10's first real <Preview> usage) and starts
  // failing on every not-yet-built shell the instant any one shell exists.
  // Skip the "no orphans" half entirely until Task 18 finishes the last
  // shell; the "every used id is registered" test above still runs
  // unconditionally throughout.
  it.skip("every registered id is used at least once (no orphans)", () => {
    for (const id of Object.keys(PREVIEW_REGISTRY) as PreviewId[]) {
      expect(used, `registry entry "${id}" is unused — remove it`).toContain(id);
    }
  });
});
