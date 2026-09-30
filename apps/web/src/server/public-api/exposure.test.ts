// **Holds the public API to `exposure.ts`** — what it may, may not, and does
// not yet expose. Why each check exists is in that file's header; this one only
// walks the disk. Reads source text and never imports a route, so it needs no
// mocks and cannot be satisfied by what a module does at load time.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXPOSURE, type Reach } from "./exposure";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, "..");
const API = path.resolve(HERE, "../../app/api");
const V1 = path.join(API, "v1");

const posix = (p: string) => p.split(path.sep).join("/");

/** Every directory under `root` holding a `route.ts`, relative to `root`. */
function routeDirs(root: string, skip?: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && full !== skip) walk(full);
      else if (entry.name === "route.ts") out.push(posix(path.relative(root, dir)));
    }
  };
  walk(root);
  return out.sort();
}

/** The public side: every `v1/` route, and the non-test helpers they delegate to. */
function publicSources(): string[] {
  const v1 = routeDirs(V1).map((dir) => path.join(V1, dir, "route.ts"));
  const helpers = readdirSync(HERE)
    .filter((f) => f.endsWith(".ts") && !f.includes(".test.") && f !== "exposure.ts")
    .map((f) => path.join(HERE, f));
  return [...v1, ...helpers];
}

interface Import {
  module: string;
  /** `null` = the whole module (namespace, default, side effect or dynamic). */
  symbols: string[] | null;
}

/** Relative specifiers become `@/server/...`, so they compare against `Reach.module`. */
function normalise(specifier: string, fromFile: string): string {
  if (!specifier.startsWith(".")) return specifier;
  const abs = path.resolve(path.dirname(fromFile), specifier);
  const rel = posix(path.relative(SERVER, abs));
  return rel.startsWith("..") ? specifier : `@/server/${rel}`;
}

function importsOf(source: string, fromFile: string): Import[] {
  const out: Import[] = [];
  const statics = /(?:import|export)\s+(?:type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
  for (const [, clause = "", specifier = ""] of source.matchAll(statics)) {
    const named = /^\{([\s\S]*)\}$/.exec(clause.trim());
    out.push({
      module: normalise(specifier, fromFile),
      symbols: named
        ? named[1]!
            .split(",")
            .map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!)
            .filter(Boolean)
        : null,
    });
  }
  for (const [, specifier = ""] of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
    out.push({ module: normalise(specifier, fromFile), symbols: null });
  }
  return out;
}

function reaches(imp: Import, reach: Reach): boolean {
  if (imp.module !== reach.module) return false;
  if (reach.symbols === undefined || imp.symbols === null) return true;
  return imp.symbols.some((s) => reach.symbols!.includes(s));
}

describe("exposure.ts decides every internal route, and the API obeys it", () => {
  const internal = routeDirs(API, V1);
  const published = new Set(routeDirs(V1));

  it("finds routes on both sides at all", () => {
    expect(internal.length).toBeGreaterThan(0);
    expect(published.size).toBeGreaterThan(0);
  });

  it("has a line for every internal route, and no line for a route that is gone", () => {
    const missing = internal.filter((dir) => !(dir in EXPOSURE));
    const stale = Object.keys(EXPOSURE).filter((key) => !internal.includes(key));
    expect(
      { missing, stale },
      "add each missing route to exposure.ts as public, planned or never; drop stale lines",
    ).toEqual({ missing: [], stale: [] });
  });

  it("names only v1 routes that exist on every public line", () => {
    const dangling = Object.entries(EXPOSURE).flatMap(([key, e]) =>
      e.status === "public" ? e.v1.filter((v) => !published.has(v)).map((v) => `${key} → v1/${v}`) : [],
    );
    expect(dangling).toEqual([]);
  });

  it("publishes nothing at a never route's own path", () => {
    const mirrored = Object.entries(EXPOSURE)
      .filter(([key, e]) => e.status === "never" && published.has(key))
      .map(([key]) => `v1/${key}`);
    expect(mirrored).toEqual([]);
  });

  it("imports nothing a never route reaches, anywhere on the public side", () => {
    const offenders: string[] = [];
    for (const file of publicSources()) {
      const imports = importsOf(readFileSync(file, "utf8"), file);
      for (const [key, e] of Object.entries(EXPOSURE)) {
        if (e.status !== "never") continue;
        for (const reach of e.reaches) {
          if (imports.some((imp) => reaches(imp, reach))) {
            const what = reach.symbols ? `${reach.module} {${reach.symbols.join(", ")}}` : reach.module;
            offenders.push(`${posix(path.relative(API, file))} reaches ${what} (never: ${key} — ${e.why})`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // A `reaches` naming a module that does not exist protects nothing: a rename
  // of the module would silently empty the check above.
  it("names only modules that exist in every never line", () => {
    const unresolved = Object.entries(EXPOSURE).flatMap(([key, e]) =>
      e.status !== "never"
        ? []
        : e.reaches
            .map((r) => r.module)
            .filter((m) => {
              const base = path.join(SERVER, m.replace(/^@\/server\//, ""));
              return ![".ts", ".tsx", "/index.ts"].some((ext) => existsSync(base + ext));
            })
            .map((m) => `${key} → ${m}`),
    );
    expect(unresolved).toEqual([]);
  });
});

describe("the import reader the never check depends on", () => {
  const file = path.join(HERE, "x.ts");
  it("reads named, renamed, type-only, multi-line, namespace, relative and dynamic imports", () => {
    const src = [
      `import { a, b as c, type D } from "@/server/m";`,
      `import {\n  e,\n  f,\n} from "./sibling";`,
      `import * as ns from "@/server/whole";`,
      `const x = await import("@/server/lazy");`,
      `export { g } from "@/server/re";`,
    ].join("\n");
    expect(importsOf(src, file)).toEqual([
      { module: "@/server/m", symbols: ["a", "b", "D"] },
      { module: "@/server/public-api/sibling", symbols: ["e", "f"] },
      { module: "@/server/whole", symbols: null },
      { module: "@/server/re", symbols: ["g"] },
      { module: "@/server/lazy", symbols: null },
    ]);
  });

  it("matches a symbol-limited reach only on those symbols", () => {
    const reach = { module: "@/server/pageCommands", symbols: ["resetPageToDefault"] };
    expect(reaches({ module: "@/server/pageCommands", symbols: ["executePageCommand"] }, reach)).toBe(false);
    expect(reaches({ module: "@/server/pageCommands", symbols: ["resetPageToDefault"] }, reach)).toBe(true);
    expect(reaches({ module: "@/server/pageCommands", symbols: null }, reach)).toBe(true);
  });
});
