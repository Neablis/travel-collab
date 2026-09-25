import { readFileSync } from "node:fs";

// KI-2026-09-25-g GUARD: some packages must resolve to exactly ONE version.
//
// Web pinned `@atlaskit/pragmatic-drag-and-drop` at `^2.0.2` while the
// `-auto-scroll` and `-hitbox` packages depended on core `3.1.0`, so pnpm
// installed both. Cards registered with 2.0.2's element adapter; auto-scroll
// listened on 3.1.0's and never saw a drag start. Nothing failed — every test
// stayed green and window auto-scroll during a card drag silently did nothing
// from at least 2026-09-14 (the oldest lockfile in this repo's history) until
// KI-2026-09-25-c bumped web to `^3.1.0`. No test can see this class of bug
// cheaply; the lockfile can, so this reads the lockfile.
//
// Usage: `node scripts/check-singletons.mjs [path/to/pnpm-lock.yaml]`
// (defaults to `pnpm-lock.yaml` in the cwd — `pnpm lint` runs from the root).

/**
 * Packages whose module-level state breaks when two copies load. Only list a
 * package here once the lockfile holds exactly one version of it — the wall
 * must pass on the day it lands.
 */
export const SINGLETONS = [
  // Drag state (the element adapter's registry of draggables, drop targets and
  // monitors) lives in module scope. Two cores = two registries, and anything
  // importing the other copy — auto-scroll, hitbox — never sees a drag.
  "@atlaskit/pragmatic-drag-and-drop",
  // Hooks read the current dispatcher from module state; a component rendered
  // by one copy calling hooks from another throws "Invalid hook call".
  "react",
  // Must be the same copy as `react` for the same reason, and owns the root
  // (and the event system) the whole tree hangs off.
  "react-dom",
];

/**
 * Every version of each package in a pnpm (v9) lockfile's `packages:` section.
 * Keys there look like `  react@19.2.8:` or `  '@scope/name@1.2.3':`.
 * `snapshots:` is skipped: its keys repeat these versions with peer suffixes.
 */
export function versionsByPackage(lockfileText) {
  const versions = new Map();
  let inPackages = false;
  for (const line of lockfileText.split("\n")) {
    if (/^\S/.test(line)) {
      inPackages = line.trimEnd() === "packages:";
      continue;
    }
    if (!inPackages) continue;
    const match = /^ {2}'?((?:@[^/\s]+\/)?[^@\s']+)@([^'(:\s]+)/.exec(line);
    if (match === null) continue;
    const [, name, version] = match;
    if (!versions.has(name)) versions.set(name, new Set());
    versions.get(name).add(version);
  }
  return versions;
}

/** Singletons holding more than one version: `[[name, [v1, v2, …]], …]`. */
export function duplicatedSingletons(lockfileText, singletons = SINGLETONS) {
  const versions = versionsByPackage(lockfileText);
  return singletons
    .filter((name) => (versions.get(name)?.size ?? 0) > 1)
    .map((name) => [name, [...versions.get(name)].sort()]);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const path = process.argv[2] ?? "pnpm-lock.yaml";
  const text = readFileSync(path, "utf8");
  const versions = versionsByPackage(text);
  if (versions.size === 0) {
    // A parser that matches nothing would pass every lockfile forever.
    console.error(`singleton check: found no packages in ${path}'s \`packages:\` section — has the lockfile format changed?`);
    process.exit(1);
  }
  const duplicated = duplicatedSingletons(text);
  if (duplicated.length > 0) {
    for (const [name, found] of duplicated) {
      console.error(`singleton with more than one version: ${name} → ${found.join(", ")}`);
    }
    console.error(
      "\nThese packages must resolve to ONE copy (see SINGLETONS in scripts/check-singletons.mjs " +
        "for why each). Align the ranges so every dependant accepts the same version — " +
        "`pnpm why <name>` shows who pulls in which (KI-2026-09-25-g).",
    );
    process.exit(1);
  }
  console.log(`singleton check OK (${SINGLETONS.length} singletons, ${versions.size} packages)`);
}
