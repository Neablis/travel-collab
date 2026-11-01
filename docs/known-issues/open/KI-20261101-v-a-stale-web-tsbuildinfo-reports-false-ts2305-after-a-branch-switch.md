### KI-2026-11-01-v — a stale `apps/web/tsconfig.tsbuildinfo` reports false TS2305 errors after a branch switch

- **Severity:** reliability. A local typecheck goes red on code that is correct, and a builder can
  spend a fix round on it or, worse, report the code as broken.
- **Area:** `apps/web/tsconfig.json` (`"incremental": true`), the ignored build-info file
  `apps/web/tsconfig.tsbuildinfo`.
- **Symptom / What happens:** in M43, part 4's builder merged part 3 into a worktree that had
  earlier held `main`, then ran `npx tsc --noEmit -p apps/web`. It exited 2 with
  `packages/pages/src/macros/primitives/open.ts(2,21): error TS2305: Module '"@tc/contracts"' has
  no exported member 'OpenClass'`, although `@tc/contracts` exports it and
  `pnpm --filter @tc/pages typecheck` passed. The same command with `--incremental false` passed.
  The build-info file still described the earlier checkout's declarations.
- **How to tell it from a real failure:** the missing export exists in the source, and the
  package's own typecheck passes. Re-run with `--incremental false`, or delete the file; a real
  error survives both.
- **Why not fixed here:** found in passing during M43 part 4; the close is prose only.
- **Fix path / Tripwire:** have the scoped typecheck recipe (`minimal-check-subset`,
  `build-a-part`) pass `--incremental false` for `apps/web`, or have worktree setup delete the
  file. Tripwire: a second false TS2305/TS2307 report from a builder.
- **Cross-reference:** M43 retro (*What could be better*); KI-091 (resolved) deleted the same file
  before a clean typecheck for another reason.
- **First noted:** 2026-11-01, PR 663's builder, merging part 3's rack fix into part 4 (`ce1df31`).
