// THE ARCHITECTURE WALL — dependency-cruiser over the whole workspace.
//
// WHY THIS EXISTS. `AGENTS.md`'s module map has a column called "Explicitly
// does NOT know about", and until 2026-09-23 nothing read it. The eslint walls
// (apps/web/eslint.config.mjs, proven by scripts/check-lint-wall.mjs) guard two
// specific boundaries — UI ↛ server, and the assistant kernel's allowlist — and
// `entitlements/moduleBoundary.test.ts` guards one module with a regex. None of
// them sees a CYCLE, and the first run of this tool found 55 folder-level cycle
// reports, three of which contradict a written ADR. Design and litmus result:
// `docs/specs/2026-09-18-architecture-map-and-drift-audit-design.md` and
// `docs/reviews/2026-09-23-architecture-wall-first-run.md`.
//
// WHAT IT DOES NOT DUPLICATE. The UI/server wall stays eslint's: two walls
// over one boundary are two chances to disagree (the openapi.test.ts rule).
//
// KNOWN VIOLATIONS are NOT a blanket acceptance of the first run: everything
// cheap and uncontroversial was fixed first (55 folder-cycle reports → 9), and
// what is left is owned by an open KI:
//   - KI-2026-09-23-d  billing ↔ entitlements, against ADR-047 decision 1
//   - KI-2026-09-23-b  the server/ root hides module cycles from this wall
//   - KI-2026-09-23-c  the trip-workspace UI folders (board/trip/lenses)
// Folder cycles are named in KNOWN_CYCLE_CLUSTERS below. The six
// Billing → Entitlements imports are in `.dependency-cruiser-known-violations.json`
// (dependency-cruiser's baseline; it cannot hold folder cycles, which is why
// those are here instead). Regenerate that file ONLY when an entry is fixed —
// it shrinks — never to admit a new one: `pnpm arch:baseline`. Anything new
// fails `pnpm lint`.

// The modules the module map says Entitlements, Billing and Identity know
// nothing about: the planning domain and Access & Membership, by path.
const PLANNING_AND_ACCESS = [
  "^packages/domain/",
  "^apps/web/src/server/(access|accessPolicy|projections|commands|pageCommands|savedDays|savedDayAdds|savedDayRow|savedDayCities|pages|pages-guard|history|eventStore|cloneTrip|demoTrip|playbooks|tripGlobals|broadcast)(/|\\.ts$)",
];

// Folders still in a cycle after the first run's cleanup — ONE regex per KI.
// A folder cycle wholly inside one of these warns; any other fails. Delete a
// line when its KI resolves; never add one without filing a KI first.
const KNOWN_CYCLE_CLUSTERS = [
  // KI-2026-09-23-d — ADR-047 says Entitlements → Billing, one way.
  "^apps/web/src/server/(billing|entitlements)$",
  // KI-2026-09-23-c — the trip workspace is three folders that are one feature.
  "^apps/web/src/components/(board|trip|trip/editor|lenses)$",
];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "every-local-import-resolves",
      comment:
        "The wall is only as good as its resolver. The first run from the repo root resolved NONE of the 1,164 `@/` imports (tsconfig `paths` without a `baseUrl` resolve against the working directory — hence tsconfig.depcruise.json) and would have passed every rule over an empty graph. An unresolved local import is a broken wall, not a warning.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true, path: "^(@/|\\.)" },
    },
    {
      name: "no-runtime-cycle",
      comment:
        "A file-level import cycle that survives type erasure is an initialisation-order bug waiting for a reorder. Type-only cycles are allowed: they vanish at runtime (the first run found three, all type-only).",
      severity: "error",
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } },
    },
    {
      name: "no-folder-cycle",
      comment:
        "Two folders that import each other are one module wearing two names — the ai/ ↔ assistant/ cycle is what made ADR-043's 'extraction is a git mv' untrue. Move the shared piece to the side that owns it, or to lib/.",
      severity: "error",
      scope: "folder",
      from: { pathNot: KNOWN_CYCLE_CLUSTERS },
      to: { circular: true },
    },
    {
      name: "no-folder-cycle-known",
      comment:
        "The two clusters that were still cyclic after the first run's cleanup, each owned by an open KI. Printed on every run so they stay visible; not failing. A cycle that leaves its cluster reaches a folder outside it and fails the rule above.",
      severity: "warn",
      scope: "folder",
      from: { path: KNOWN_CYCLE_CLUSTERS },
      to: { circular: true },
    },
    {
      name: "contracts-depend-on-nothing",
      comment: "AGENTS.md dependency rules: packages/contracts depends on nothing in the workspace.",
      severity: "error",
      from: { path: "^packages/contracts/" },
      to: { path: "^(packages/(?!contracts/)|apps/)" },
    },
    {
      name: "domain-depends-on-contracts-only",
      comment: "Invariant 4: the domain core is pure and depends only on packages/contracts.",
      severity: "error",
      from: { path: "^packages/domain/" },
      to: { path: "^(packages/(?!(domain|contracts)/)|apps/)" },
    },
    {
      name: "packages-never-import-the-app",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "entitlements-knows-no-trips",
      comment:
        "Module map + ADR-045 rule 5: Entitlements answers can(account, capability); the caller knows what the capability is about.",
      severity: "error",
      from: { path: "^apps/web/src/server/entitlements/" },
      to: { path: PLANNING_AND_ACCESS },
    },
    {
      name: "billing-knows-no-trips",
      comment: "ADR-047 consequences: Billing knows what a plan id is and nothing about a trip.",
      severity: "error",
      from: { path: "^apps/web/src/server/billing/" },
      to: { path: PLANNING_AND_ACCESS },
    },
    {
      name: "billing-imports-no-entitlements",
      comment:
        "ADR-047 decision 1: 'The dependency runs Entitlements → Billing, one way … Billing imports no plan file and no resolver, so nothing closes a cycle.' The first run found six imports the other way — KI-2026-09-23-d.",
      severity: "error",
      from: { path: "^apps/web/src/server/billing/" },
      to: { path: "^apps/web/src/server/entitlements/" },
    },
    {
      name: "identity-knows-no-trips",
      comment: "Module map: Identity (accounts, sessions, profiles) knows nothing of trips or invites.",
      severity: "error",
      from: { path: "^apps/web/src/server/(users|auth|api-tokens)(/|\\.ts$)" },
      to: { path: PLANNING_AND_ACCESS },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // Tests may reach across modules to set up state; the rules are about what
    // ships. `.design-sync` is a build input, not app source (AGENTS.md).
    exclude: {
      path: "(node_modules|\\.design-sync|/e2e/|__tests__|/test-support/|\\.test\\.tsx?$|\\.d\\.ts$)",
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.depcruise.json" },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs", ".json"],
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
    reporterOptions: {
      // `pnpm arch:graph` — the module-level picture, on demand and never
      // committed (a committed diagram is a first-read file that can drift).
      dot: { collapsePattern: "^(packages/[^/]+|apps/web/src/server/[^/]+|apps/web/src/components/[^/]+|apps/web/src/[^/]+)" },
      archi: { collapsePattern: "^(packages/[^/]+|apps/web/src/server/[^/]+|apps/web/src/components/[^/]+|apps/web/src/[^/]+)" },
      mermaid: { minify: false },
    },
  },
};
