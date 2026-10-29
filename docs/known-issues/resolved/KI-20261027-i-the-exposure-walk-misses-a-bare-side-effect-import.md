### KI-2026-10-27-i — The exposure walk misses a bare side-effect import — RESOLVED

- **Severity:** guard gap, low. No public-side file has one today, and a bare import binds
  nothing callable.
- **Area:** `apps/web/src/server/public-api/exposure.test.ts` (:72), the import reader behind
  check 3 (a public route must not reach a `never` symbol).
- **Symptom / What happens:** the reader matches `import { … } from "x"` and similar forms, but not
  `import "x";`. A module pulled in only for its side effects is not walked, so anything it
  reaches is invisible to the check.
- **Why not fixed here:** it predates M55 (unchanged from main); found by M55 part 4's fix while
  the walk was extended to `app/api/mcp/**`.
- **Fix path / Tripwire:** match `import\s+["']…["']` in the reader, and prove it by adding a bare
  import of a `never` module to a walked file and watching check 3 go red.
- **Cross-reference:** M55 part 4, PR 617 (review-617-b).
- **First noted:** 2026-10-27, M55 part 4 fix.
- **Resolved, 2026-10-28 (KI sweep, unit-test hygiene):** `importsOf` in `exposure.test.ts` now
  reads `import "x";` as a whole-module import (`symbols: null`), and the static-import pattern gained
  a `(?!["'])` lookahead so a bare import no longer starts a lazy clause that runs on to the next
  statement's `from` (without it, `import "a"; import { h } from "b"` read `b` as whole-module). The
  reader's own test covers both. **Reproduced** by adding `import "@/server/billing/planChange";` to
  `server/mcp/dispatch.ts`: check 3 stayed green (11 passed). **Red after the fix, same edit:**
  `../../server/mcp/dispatch.ts reaches @/server/billing/planChange (never: billing/change — Moves
  money — session-only forever)`; restored, 11 passed. Removing the lookahead turns the reader test
  red on `@/server/after-bare` read as `symbols: null` instead of `["h"]`.
