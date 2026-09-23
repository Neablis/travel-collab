### KI-2026-09-23-e — the production content import cannot load: Node's type stripping rejects a TypeScript parameter property

- **Severity:** correctness. The workflow that publishes content to production
  could not start. (As found.)
- **Area:** `.github/workflows/import-content-production.yml` (the Import step,
  `node --import ./scripts/lib/ts-resolve-register.mjs
  scripts/import-content-production.ts`), `apps/web/src/server/entitlements/planVersions.ts`
  (`UnknownPlanVersionError`), and the five other classes with the same syntax:
  `server/billing/checkout.ts`, `planChange.ts`, `prices.ts` (two),
  `stripeApi.ts`, and `server/public-api/commands.ts`. `tsconfig.base.json` is
  where the guard lives.
- **Symptom:** loading the script fails before any bundle is read:

  ```
  file:///…/apps/web/src/server/entitlements/planVersions.ts:358
  export class UnknownPlanVersionError extends Error {
  SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript parameter property is not supported in strip-only mode
  ```

  It reproduced on **both** Node 22.22.2 and Node 24.21.0 with
  `--dry-run`. So this was never a version-skew bug, and moving the workflow to
  24 would not have fixed it. It fails the same way through `savedDays.ts`,
  `commands.ts`, `pageCommands.ts` and `projections.ts`, all of which import
  code that reaches `planVersions.ts`.
- **Cause:** Node runs `.ts` files by *stripping* types, which only works for
  syntax that disappears without a trace. A parameter property
  (`constructor(readonly ref: string)`) is not erasable: it emits an assignment.
  Everything else in the repo goes through `tsc` or Next's compiler, which
  handle it. So nothing noticed until a script run directly by `node` imported a
  file that used one.
- **How it was found:** a review-fix session on PR #206 (M12 backend) could not
  run `import-content-production.ts` to verify a change to it.
- **Fix, 2026-09-23:**
  1. The seven parameter properties are now declared fields assigned in the
     constructor. Behaviour is unchanged: same fields, same `readonly`, same
     values.
  2. **`"erasableSyntaxOnly": true` in `tsconfig.base.json`**, which every
     package extends. `tsc` now refuses this whole class (parameter properties,
     `enum`, `namespace`, `import =`) with TS1294 in every typecheck, locally
     and in CI. Before the rewrite it reported exactly the seven sites above.
     This is the guard; the rewrite alone would have lasted until the next
     `constructor(readonly …)`.
- **Verified:** `import-content-production.ts --dry-run` under the workflow's
  exact loader now prints `would write 148 playbook day(s) and up to 4 trip(s)`
  and exits 0, on Node 22 and on Node 24.
