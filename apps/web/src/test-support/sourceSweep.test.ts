import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sourceFilesUnder, strippedIfMentions } from "./sourceSweep";

// The helper the source sweeps share (KI-20260924-f). What it must never do is
// hide a file from a sweep that could have matched it.
describe("sourceSweep", () => {
  const root = mkdtempSync(path.join(tmpdir(), "source-sweep-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ["a", ".well-known/x", "node_modules/dep", ".next/server"]) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  const write = (rel: string, text: string) => writeFileSync(path.join(root, rel), text);
  write("a/gate.ts", 'export const g = (p: string) => p ===/* why */"premium";\n');
  write("a/plain.ts", "export const n = 1;\n");
  write("a/notes.md", '"premium"\n');
  write(".well-known/x/route.ts", "export const r = 1;\n");
  write("node_modules/dep/index.ts", "export const d = 1;\n");
  write(".next/server/chunk.ts", "export const c = 1;\n");

  it("walks shipped dot-directories and skips dependencies and build output", () => {
    const rel = sourceFilesUnder(root).map((file) => path.relative(root, file).split(path.sep).join("/"));
    expect(rel.sort()).toEqual([".well-known/x/route.ts", "a/gate.ts", "a/plain.ts"]);
  });

  it("parses a file that mentions the token and skips one that cannot match", () => {
    const token = /["']premium["']/;
    // The comment is blanked, so the comparison it split is now contiguous
    // enough for a `\s*` pattern — the pre-filter must not have hidden it.
    expect(strippedIfMentions(path.join(root, "a/gate.ts"), token)).toMatch(/===\s*"premium"/);
    expect(strippedIfMentions(path.join(root, "a/plain.ts"), token)).toBeNull();
  });
});
