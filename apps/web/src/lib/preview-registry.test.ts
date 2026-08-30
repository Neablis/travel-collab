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
// `middleware` and `proxy` are both listed: Next 16 renamed the convention to
// `proxy` (this repo uses `src/proxy.ts`) but still recognises `middleware`.
const NEXT_ENTRY =
  /(?:^|\/)(?:page|layout|template|loading|error|global-error|not-found|default|route|middleware|proxy|instrumentation|sitemap|robots|opengraph-image|icon|apple-icon)\.tsx?$/;

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
const importsFrom = new Map<string, string[]>();
for (const file of files) {
  if (isTest(file)) continue;
  const src = readFileSync(file, "utf8");
  const targets: string[] = [];
  for (const m of src.matchAll(/(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']([^"']+)["']/g)) {
    const target = resolveSpecifier(file, m[1]!);
    if (target !== null) targets.push(target);
  }
  importsFrom.set(file, targets);
}

// Reachability from the app's real entry points, not "is this imported by
// anything at all". The weaker one-level check let a dead file keep another
// file alive: two unrendered components importing each other both looked
// imported, so a Preview in either still counted as used. Walking outward from
// the Next.js entries instead means a file is rendered only if the framework
// can actually get to it. Found by CodeRabbit on PR #44.
//
// Measured when adopted: identical result to the one-level check on today's
// tree — the same 5 dead files of 171 non-test sources, 0 newly dead — so this
// is strictly stronger without being stricter about anything that exists yet.
// Imports made *from* test files are still never followed (a component whose
// only importer is its own unit test is not rendered), which falls out of test
// files never being roots and never being traversed.
function reachableFrom(roots: readonly string[], edges: ReadonlyMap<string, readonly string[]>): Set<string> {
  const seen = new Set<string>(roots);
  const queue = [...seen];
  while (queue.length > 0) {
    for (const target of edges.get(queue.pop()!) ?? []) {
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return seen;
}

const renderedFiles = reachableFrom(
  files.filter((f) => NEXT_ENTRY.test(f) && !isTest(f)),
  importsFrom,
);

const isRendered = (file: string) => renderedFiles.has(file);

// `//` and `/* */` comments, including JSX `{/* */}` blocks. Prose *about* a
// Preview is not a usage of it: EndOfTrip.tsx used to explain in a comment why
// it did not reuse `<Preview id="add-saved-day">`, and an uncommented scan
// counted that sentence as the id's real usage — the same phantom-usage class
// as KI-31 itself, in a file that IS rendered, so file-level reachability
// alone would not have caught it. (M11 link 6 wired that shell up and the
// comment went with it; several files still name ids in prose, and the
// stripping is what keeps those from counting.)
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

// Split from `previewIdsIn` so the id-extraction half can be driven with
// synthetic source. The regression test below used to assert only
// `reachableFrom`, which made it a statement about graph reachability rather
// than about Preview ids at all (CodeRabbit, PR #71).
function previewIdsInSource(src: string): string[] {
  return [...stripComments(src).matchAll(/<Preview[^>]*\bid=["']([\w-]+)["']/g)].map((m) => m[1]!);
}

function previewIdsIn(file: string): string[] {
  return previewIdsInSource(readFileSync(file, "utf8"));
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
// EMPTY as of M11 link 6, and that is the intended end state: the escape
// hatch exists for a shell parked in a component the app does not render, and
// its only occupant — "add-saved-day" in AddSavedDayButton.tsx — was wired up
// and mounted (EndOfTrip renders it now). The tests below are written to hold
// on an empty list rather than being deleted with it: the next milestone to
// park a shell gets the guard already working.
const PARKED: Readonly<Record<string, string>> = {};

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

  // M11b's exit-gate line: "All four Playbooks `<Preview>` shells are DELETED
  // from preview-registry.ts" — deleted, not re-pointed. Named literally on
  // purpose, unlike the scanner test below: these four ids are a decision that
  // was made, and the failure mode this guards is somebody reintroducing one
  // under the same name, which no derived assertion can see.
  //
  // The five OTHER M11-tagged entries are deliberately still here. None of them
  // is Playbooks and each is blocked on a contract field that does not exist —
  // see the registry's own note, and the build plan's finding 1, which records
  // retagging them as Mitchell's call rather than PR3's.
  it("has no Playbooks shell left, in the registry or in the tree", () => {
    for (const id of ["home-playbooks-strip", "playbooks-route", "insert-playbook", "wizard-playbook-panel"]) {
      expect(PREVIEW_REGISTRY, `"${id}" is back in the registry`).not.toHaveProperty(id);
      expect(declared, `"${id}" is back in the tree`).not.toContain(id);
    }
  });

  // The other half of the same gate box: "No `<option>` city list exists
  // anywhere in the tree." The handoff says it twice and the milestone restates
  // it, because the dropdown is what the server-side city search replaces —
  // and a static list of cities is the obvious thing to reach for when the
  // endpoint is inconvenient.
  it("has no static city <option> list anywhere in src", () => {
    const offenders = files
      .filter((f) => f.endsWith(".tsx") && !isTest(f))
      .filter((f) => /aria-label="City"|All cities/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
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
  // KI-31 regression, restated on a synthetic graph. It used to run against
  // the real `add-saved-day` shell in AddSavedDayButton.tsx; M11 link 6 wired
  // that up and emptied PARKED, so there is no unrendered component in the
  // tree to point at any more — and committing a dead fixture component to
  // src purely to keep this test literal is exactly what the repo's own
  // orphan tooling exists to flag. The property being guarded is unchanged:
  // a `<Preview id>` reachable only from a file the router cannot reach must
  // not count as used.
  it("does not count a <Preview id> whose only occurrence is in an unimported component", () => {
    const edges = new Map<string, readonly string[]>([
      ["app/page.tsx", ["components/Live.tsx"]],
      ["components/Live.tsx", []],
      ["components/Shelved.tsx", []],
    ]);
    const reached = reachableFrom(["app/page.tsx"], edges);
    expect(reached.has("components/Shelved.tsx")).toBe(false);
    expect(reached.has("components/Live.tsx")).toBe(true);

    // …and the ids that fall out of that, computed the way
    // `usedByRenderedCode` computes them: scan only what is reachable. Both
    // files below DO contain a `<Preview id>`, so this fails if the filter is
    // dropped — which the reachability assertions alone did not (CodeRabbit,
    // PR #71).
    const source = new Map<string, string>([
      ["app/page.tsx", "<main><Live /></main>"],
      ["components/Live.tsx", '<Preview id="live-shell">x</Preview>'],
      ["components/Shelved.tsx", '<Preview id="shelved-shell">x</Preview>'],
    ]);
    const used = new Set(
      [...source.keys()].filter((f) => reached.has(f)).flatMap((f) => previewIdsInSource(source.get(f)!)),
    );
    expect([...used]).toEqual(["live-shell"]);
    // The scanner does see the shelved id — it is the reachability filter, not
    // a blind spot in the regex, that keeps it out.
    expect(previewIdsInSource(source.get("components/Shelved.tsx")!)).toEqual(["shelved-shell"]);
  });

  // Rewritten in M11b, and the reason is the point. This used to name
  // `EndOfTrip.tsx` and `insert-playbook` as a literal pair — and M11b deleted
  // that shell, so the test failed for a reason that had nothing to do with
  // what it checks. A guard whose subject is a hardcoded fixture expires the
  // day its fixture does; the property it was after ("a `<Preview id>` in a
  // file the router can reach IS counted") is true of every such file, so it is
  // asserted over all of them.
  it("counts every <Preview id> that sits in a component the app renders", () => {
    const carriers = scanned.filter((f) => isRendered(f) && previewIdsIn(f).length > 0);
    // The witness: with no carriers the loop below asserts nothing and passes
    // vacuously, which is the exact failure `test-support/witness.ts` exists
    // for. Registered ids all have to be used, so this is also a floor of one.
    expect(
      carriers.length,
      "no rendered file carries a <Preview id> — the scanner or the resolver has broken",
    ).toBeGreaterThan(0);
    for (const file of carriers) {
      for (const id of previewIdsIn(file)) {
        expect(usedByRenderedCode, `${relative(SRC, file)} carries "${id}"`).toContain(id);
        expect(PREVIEW_REGISTRY, `${relative(SRC, file)} carries "${id}"`).toHaveProperty(id);
      }
    }
  });

  it("treats a Next.js entry point as rendered even though nothing imports it", () => {
    // M15 put the authenticated home route inside a route group
    // (`app/(app)/page.tsx`), so the match can't require "page.tsx" to sit
    // directly under "app/" — it walks through any number of `(group)/`
    // segments, which route groups are (they don't affect the URL or change
    // that Next.js renders the file as an entry point).
    const page = files.find((f) => /(?:\/|^)app\/(?:\([^/]+\)\/)*page\.tsx$/.test(f));
    expect(page, "expected an app-router page.tsx in src/app").toBeDefined();
    expect([...importsFrom.values()].flat()).not.toContain(page!);
    expect(isRendered(page!)).toBe(true);
  });

  // CodeRabbit on PR #44 asked for a case covering an unreachable import chain.
  // The tree has none today (every dead file is dead on its own), and inventing
  // one means committing dead fixture components to src that the repo's own
  // orphan tooling would then flag — so the traversal is tested directly on a
  // synthetic graph instead. Under the one-level check this PR replaced, `dead`
  // and `alsoDead` both looked "imported by something" and would have counted
  // as rendered; only entry-rooted reachability rules them out.
  it("does not count a file kept alive only by another unreachable file", () => {
    const edges = new Map<string, readonly string[]>([
      ["app/page.tsx", ["components/Live.tsx"]],
      ["components/Live.tsx", []],
      ["components/dead.tsx", ["components/alsoDead.tsx"]],
      ["components/alsoDead.tsx", ["components/dead.tsx"]],
    ]);
    const reached = reachableFrom(["app/page.tsx"], edges);
    expect([...reached].sort()).toEqual(["app/page.tsx", "components/Live.tsx"]);
    expect(reached.has("components/dead.tsx")).toBe(false);
    expect(reached.has("components/alsoDead.tsx")).toBe(false);
  });

  it("resolves alias and relative imports (so real components are not read as dead)", () => {
    // A broken specifier resolver would read most of the tree as dead and
    // quietly stop the orphan guard from covering anything. Two bounds, both
    // insensitive to files coming and going: nearly everything is rendered,
    // and nothing the router owns is ever counted dead. The 10% ceiling is
    // measured, not guessed — 5 dead of 171 non-test source files today (2.9%),
    // so the bound sits ~3.5x above the observed value.
    const source = files.filter((f) => !isTest(f));
    const dead = source.filter((f) => !isRendered(f)).map((f) => relative(SRC, f));
    expect(dead.length, `unexpectedly many unimported files: ${dead.join(", ")}`).toBeLessThan(
      source.length / 10,
    );
    for (const f of source.filter((f) => f.startsWith(join(SRC, "app")))) {
      expect(isRendered(f), `${relative(SRC, f)} under src/app read as dead`).toBe(true);
    }
  });
});
