### KI-2026-09-23-f — the production content import dies at module load on a TypeScript parameter property, before touching any database — RESOLVED

- **Severity:** correctness. `import-content-production.yml` is the only route
  by which `content/` reaches production (ADR-041), and it cannot run at all,
  dry run included.
- **Area:** `apps/web/src/server/entitlements/planVersions.ts`
  (`UnknownPlanVersionError`), `apps/web/scripts/import-content-production.ts`,
  `apps/web/scripts/lib/ts-resolve-register.mjs`,
  `.github/workflows/import-content-production.yml`.
- **Symptom / What happens:** the workflow's Import step runs
  `node --import ./scripts/lib/ts-resolve-register.mjs scripts/import-content-production.ts`
  on Node 22, which executes `.ts` by *stripping* types rather than compiling
  them. It dies before any connection is attempted:

  ```
  file:///…/apps/web/src/server/entitlements/planVersions.ts:358
  export class UnknownPlanVersionError extends Error {
    constructor(readonly ref: string) {
                         ^^^^^^^^^^^
  SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript parameter property is not supported in strip-only mode
  ```

  Reproduced 2026-09-23 on Node 22.23.2 and 26.4.0, from `apps/web`, with
  `DATABASE_URL=postgres://nobody@127.0.0.1:1/none … --dry-run`. The path is
  `server/commands.ts` → `server/access/members.ts` →
  `server/entitlements/resolver.ts` → `planVersions.ts`.
- **Why nothing noticed:** introduced by #174 (2026-09-14). The workflow is
  dispatched by hand, and its last successful run was 2026-09-07. Nothing in CI
  runs any `.ts` entry point under plain `node`. Typecheck, lint, vitest and
  `next build` all *compile* TypeScript, and a parameter property is valid
  TypeScript, so every lane stayed green.
- **Why not fixed here:** filed and fixed on the same branch. The intended fix
  is a declared field assigned in the constructor. Also a guard
  that runs each plain-`node` `.ts` entry point through its real import graph
  in CI, so the next non-erasable construct fails a PR rather than a dispatch.
- **Cross-reference:** ADR-041 (content bundles), `docs/guidelines/content-bundles.md`.
- **First noted:** 2026-09-23, reproducing a dispatch failure locally.
- **Fix (2026-09-23):** `UnknownPlanVersionError` declares `readonly ref:
  string` as a field and assigns it after `super()`. The class's public shape
  is unchanged.

  **Inventory.** Every tracked `.ts`/`.mts` file was run through Node's own
  `module.stripTypeScriptTypes`. Six files fail, with seven constructors
  between them, all using parameter properties. There is no `enum` or
  `namespace` anywhere. Each plain-`node` entry point's runtime graph was then
  intersected with that set (dependency-cruiser):

  | entry point | run by | files reached | incompatible |
  |---|---|---|---|
  | `scripts/import-content-production.ts` | the workflow | 82 | `planVersions.ts` |
  | `scripts/import-content.ts` | `content:import`, `content:verify` | 41 | none |
  | `scripts/db-seed.ts` | `db:seed` | 39 | none |
  | `scripts/geocode-japan-seed.mts` | by hand | 45 | none |

  So only `planVersions.ts` was reachable. **Left alone, deliberately**,
  because no entry point reaches them: `server/billing/checkout.ts`,
  `planChange.ts`, `prices.ts`, `stripeApi.ts` and
  `server/public-api/commands.ts`. Each is valid TypeScript under Next and
  Vitest. If an importer's graph ever reaches one, the guard below names it.

  **Guard.** `scripts/__tests__/strip-only-entry-points.test.mjs`, in the root
  `node --test` lane that `pnpm test` runs on CI's Node 22. It spawns each
  entry point above with `process.execPath` and its real flags, with
  `DATABASE_URL`, the web base URL and the geocoder key all pointed at
  nothing. It asserts each one got past module load: a dry run that exits 0,
  or a failure at its first piece of I/O. A second test reads every
  `node … *.ts` invocation out of the package.json scripts and the workflows,
  and fails if one is missing from the list.

  **Proof.** Before the fix, the reproduction above failed on Node 22.23.2.
  After it, the same command prints `target 127.0.0.1:1 (DRY RUN — nothing
  will be written) · would write 148 playbook day(s) and up to 4 trip(s)` and
  exits 0. With the guard in place and only the source edit reverted, test 1
  goes red with the same `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` text, and the
  other entry points stay green. Restored, all 5 pass on Node 22.23.2 and 26.4.0.
  Renaming the `db-seed.ts` key turns the coverage test red, naming
  `scripts/db-seed.ts (apps/web/package.json "db:seed")`. Tier 2 subset:
  `pnpm --filter web typecheck`, eslint on the changed file, 8 entitlements
  unit files (55 tests), and the docstring, KI-filename, KI-citation, sleep,
  case and surface walls all passed. The root `node --test` lane is 299/303;
  its 4 failures are the stale generated indexes PR #207 fixes.
