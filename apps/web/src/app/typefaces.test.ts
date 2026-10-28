import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// `typefaces.ts` cannot run under vitest (`next/font/local` is a build-time
// transform), so these read it as text. What they hold is the part the build
// does not check: a subset whose variable globals.css forgets is a face that
// silently never applies, and one `next/font/google` import puts a network
// fetch back into every production build (KI-2026-09-27-a).
const app = import.meta.dirname;
const typefaces = readFileSync(join(app, "typefaces.ts"), "utf8");
const globals = readFileSync(join(app, "globals.css"), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("the committed typefaces", () => {
  it("compose every subset into the variable its family's consumers read", () => {
    const declared = [...typefaces.matchAll(/variable: "(--font-next-[a-z-]+)"/g)].map((m) => m[1]!);
    const composed = [...globals.matchAll(/var\((--font-next-(?:display|sans|mono)-[a-z-]+)\)/g)].map((m) => m[1]!);
    expect(declared.length).toBe(14);
    expect([...new Set(composed)].sort()).toEqual([...declared].sort());
  });

  it("point at files that are in the repo", () => {
    const paths = [...typefaces.matchAll(/"\.\/(fonts\/[^"]+\.woff2)"/g)].map((m) => m[1]!);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((path) => !existsSync(join(app, path)))).toEqual([]);
  });

  it("fetch nothing from Google at build time", () => {
    const importers = sourceFiles(join(app, "..")).filter((file) =>
      readFileSync(file, "utf8").includes('from "next/font/google"'),
    );
    expect(importers).toEqual([]);
  });
});
