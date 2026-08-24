import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PREVIEW_REGISTRY, type PreviewId } from "./preview-registry";

const SRC = join(__dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
}

const isTest = (file: string) => /\.test\.tsx?$/.test(file);

// Next.js app-router entry points are rendered by the framework, not imported
// by another module, so "nothing imports it" does not make one dead.
const NEXT_ENTRY =
  /(?:^|\/)(?:page|layout|template|loading|error|global-error|not-found|default|route|middleware|instrumentation|sitemap|robots|opengraph-image|icon|apple-icon)\.tsx?$/;

// Resolve an import specifier (`@/…` alias or relative) to a file inside src/,
// mirroring the tsconfig `@/*` → `src/*` path mapping. Bare package specifiers
// resolve to node_modules and are irrelevant here.
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const cand of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

const files = walk(SRC);

// Which files are imported by real app code? Imports *from test files* are
// deliberately not counted: a component whose only importer is its own unit
// test is not rendered by the app. This is a one-level check ("is this file
// imported anywhere at all"), not full reachability from a rendered root —
// KI-31's option (b). It is enough to catch the case that motivated it: a
// Preview whose sole usage is its own never-rendered component file.
const importedByAppCode = new Set<string>();
for (const file of files) {
  if (isTest(file)) continue;
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']([^"']+)["']/g)) {
    const target = resolveSpecifier(file, m[1]!);
    if (target !== null) importedByAppCode.add(target);
  }
}

const isRendered = (file: string) => NEXT_ENTRY.test(file) || importedByAppCode.has(file);

// `//` and `/* */` comments, including JSX `{/* */}` blocks. Prose *about* a
// Preview is not a usage of it: EndOfTrip.tsx explains in a comment why it does
// not reuse `<Preview id="add-saved-day">`, and an uncommented scan counted
// that sentence as the id's real usage — the same phantom-usage class as KI-31
// itself, in a file that is rendered, so file-level reachability alone would
// not have caught it.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function previewIdsIn(file: string): string[] {
  const src = stripComments(readFileSync(file, "utf8"));
  return [...src.matchAll(/<Preview[^>]*\bid=["']([\w-]+)["']/g)].map((m) => m[1]!);
}

// Skip the Preview component itself and *.test.tsx fixtures: this sync test
// is about real app usage (shells), not the component's own definition or
// unit-test render fixtures like `<Preview id="assistant-rail">` in
// preview.test.tsx, which would otherwise falsely count as "used".
const scanned = files.filter((f) => f.endsWith(".tsx") && !f.endsWith("preview.tsx") && !isTest(f));

// Every `<Preview id>` occurrence anywhere in non-test source. Used for the
// registration check, which only cares that an id exists in the registry.
const declared = new Set<string>(scanned.flatMap(previewIdsIn));

// Occurrences that are actually reachable from something the app renders.
// This is the set the orphan guard must use — before KI-31 it used `declared`,
// so a registry entry stayed "used" purely because its own dead component file
// still existed on disk.
const usedByRenderedCode = new Set<string>(scanned.filter(isRendered).flatMap(previewIdsIn));

// Registry ids deliberately parked in a component the app does not render yet:
// the shell is kept on purpose for the milestone named in its `wiredUpBy`.
// Each value is the file that parks the id, relative to src/. This list is the
// *documented* exception to the orphan guard — every other id must have a real,
// rendered usage — and the test below expires an entry as soon as its reason
// stops holding.
const PARKED: Readonly<Record<string, string>> = {
  // M10 Wave 2 Phase 1 moved this action out of TripHeader and Phase 6 gave the
  // plan flow its own button under <Preview id="insert-playbook">, so nothing
  // renders AddSavedDayButton today. phase-6-growth.md Step 3 item 7 says to
  // keep the component file for M11's insert-a-saved-day trigger, and the id
  // cannot be dropped while the file still renders <Preview id="add-saved-day">
  // (Preview's `id` prop is typed `PreviewId`). See KI-31.
  "add-saved-day": "components/trip/AddSavedDayButton.tsx",
};

describe("preview registry ↔ usage", () => {
  it("every used <Preview id> is registered", () => {
    for (const id of declared) expect(PREVIEW_REGISTRY).toHaveProperty(id);
  });

  // Task 18 is the last shell task in the M10 plan (Tasks 10, 14-18 landed
  // each registry entry's real <Preview id> usage incrementally) — every
  // registry entry now has a real usage somewhere in the app, so this guard
  // runs for real from here on.
  it("every registered id is used at least once (no orphans)", () => {
    for (const id of Object.keys(PREVIEW_REGISTRY) as PreviewId[]) {
      if (id in PARKED) continue;
      expect(
        usedByRenderedCode,
        `registry entry "${id}" is unused — remove it (a <Preview id> inside a component nothing imports does not count)`,
      ).toContain(id);
    }
  });

  // Keeps the PARKED escape hatch honest: an entry is only legitimate while its
  // named file still parks that id and still isn't rendered. Wire the component
  // up (or delete it) and this fails until the entry is removed, so the
  // exception cannot quietly outlive its reason.
  it("every parked id is still parked in the file that claims it", () => {
    for (const [id, rel] of Object.entries(PARKED)) {
      expect(PREVIEW_REGISTRY, `parked id "${id}" is not in the registry`).toHaveProperty(id);
      const file = join(SRC, rel);
      expect(existsSync(file), `parked id "${id}" names a missing file ${rel}`).toBe(true);
      expect(previewIdsIn(file), `${rel} no longer uses <Preview id="${id}">`).toContain(id);
      expect(
        isRendered(file),
        `${rel} is rendered now — drop "${id}" from PARKED so the orphan guard covers it`,
      ).toBe(false);
      expect(
        usedByRenderedCode,
        `parked id "${id}" has a real rendered usage now — drop it from PARKED`,
      ).not.toContain(id);
    }
  });
});

describe("the orphan scanner itself", () => {
  // KI-31 regression: the guard used to count a `<Preview id>` that only ever
  // appeared inside a component file nothing imports, so such an id read as
  // "used" and the orphan test was structurally unable to report it. These
  // assert the two halves of the fix on real files in the tree rather than on
  // a synthetic fixture, so they stay true only while the scanner does.
  it("does not count a <Preview id> whose only occurrence is in an unimported component", () => {
    const parkingFile = join(SRC, PARKED["add-saved-day"]!);
    expect(previewIdsIn(parkingFile)).toContain("add-saved-day");
    expect(isRendered(parkingFile)).toBe(false);
    expect(usedByRenderedCode).not.toContain("add-saved-day");
  });

  it("still counts a <Preview id> in a component the app imports", () => {
    const rendered = join(SRC, "components/trip/EndOfTrip.tsx");
    expect(isRendered(rendered)).toBe(true);
    expect(previewIdsIn(rendered)).toContain("insert-playbook");
    expect(usedByRenderedCode).toContain("insert-playbook");
  });

  it("treats a Next.js entry point as rendered even though nothing imports it", () => {
    const page = files.find((f) => f.endsWith(join("app", "page.tsx")));
    expect(page, "expected an app-router page.tsx in src/app").toBeDefined();
    expect(importedByAppCode.has(page!)).toBe(false);
    expect(isRendered(page!)).toBe(true);
  });

  it("resolves alias and relative imports (so real components are not read as dead)", () => {
    // A broken specifier resolver would read most of the tree as dead and
    // quietly stop the orphan guard from covering anything. Two bounds, both
    // insensitive to files coming and going: nearly everything is rendered,
    // and nothing the router owns is ever counted dead. The 10% ceiling is
    // measured, not guessed — 5 dead of 177 non-test source files today (2.8%),
    // so the bound sits ~3.5x above the observed value.
    const source = files.filter((f) => !isTest(f));
    const dead = source.filter((f) => !isRendered(f)).map((f) => relative(SRC, f));
    expect(dead.length, `unexpectedly many unimported files: ${dead.join(", ")}`).toBeLessThan(
      source.length / 10,
    );
    expect(dead).toContain(relative(SRC, join(SRC, PARKED["add-saved-day"]!)));
    for (const f of source.filter((f) => f.startsWith(join(SRC, "app")))) {
      expect(isRendered(f), `${relative(SRC, f)} under src/app read as dead`).toBe(true);
    }
  });
});
