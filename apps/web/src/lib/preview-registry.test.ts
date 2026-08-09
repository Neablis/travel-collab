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
  it("every registered id is used at least once (no orphans)", () => {
    // TODO(remove after Task 18): no shells consume <Preview> yet (they're
    // built in Tasks 10, 14-18), so `used` is empty and this assertion is
    // vacuously unenforceable until then. Remove this guard once real shells
    // using <Preview id=...> exist.
    if (used.size === 0) return;
    for (const id of Object.keys(PREVIEW_REGISTRY) as PreviewId[]) {
      expect(used, `registry entry "${id}" is unused — remove it`).toContain(id);
    }
  });
});
