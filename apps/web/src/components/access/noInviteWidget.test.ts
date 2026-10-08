// **No invite-only copy of a widget** (M38 D6, gate box 4).
//
// The invite page shows the trip with the notebook's own widgets, through
// `renderMacro` and `MacroView`, fed by `previewContext`. The architecture wall
// (`invite-renders-shared-widgets-only` in `.dependency-cruiser.cjs`) keeps
// these files out of `@tc/pages`' widget modules — but it sees modules, not
// names, so a widget written HERE against the public index's `MacroDef` would
// pass it. This is the other half: a widget is a `MacroDef`, its resolver
// answers a `MacroResult`, and nothing on the invite side names either.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test-support/stripComments";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INVITE_SIDE = [path.join(SRC, "components/access"), path.join(SRC, "app/(front)/invite")];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("the invite side defines no widget", () => {
  const files = INVITE_SIDE.flatMap(sourceFiles);

  it("sweeps the files it claims to", () => {
    // A path typo would sweep nothing and pass; these two are the ones the
    // page is built from.
    const names = files.map((file) => path.relative(SRC, file));
    expect(names).toContain(path.join("components/access", "previewContext.ts"));
    expect(names).toContain(path.join("app/(front)/invite/[token]", "page.tsx"));
  });

  it("names no MacroDef and no MacroResult", () => {
    const offenders = files.flatMap((file) =>
      /\b(?:Any)?MacroDef\b|\bMacroResult\b/.test(stripComments(readFileSync(file, "utf8"), file))
        ? [path.relative(SRC, file)]
        : [],
    );
    expect(offenders).toEqual([]);
  });
});
