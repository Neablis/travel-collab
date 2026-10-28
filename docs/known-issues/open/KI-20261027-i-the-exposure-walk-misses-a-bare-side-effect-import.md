### KI-2026-10-27-i — The exposure walk misses a bare side-effect import

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
