### KI-2026-09-23-f — the production content import dies at module load on a TypeScript parameter property, before touching any database

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
- **Intended fix:** a declared field assigned in the constructor. Also a guard
  that runs each plain-`node` `.ts` entry point through its real import graph
  in CI, so the next non-erasable construct fails a PR rather than a dispatch.
- **Cross-reference:** ADR-041 (content bundles), `docs/guidelines/content-bundles.md`.
- **First noted:** 2026-09-23, reproducing a dispatch failure locally.
