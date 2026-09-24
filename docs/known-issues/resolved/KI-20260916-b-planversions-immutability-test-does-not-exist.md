### KI-2026-09-16-b — `planVersions.ts` cites an immutability test that does not exist, and the runtime freeze it promises is unasserted — RESOLVED

- **Severity:** cleanup, shading into correctness — nothing is wrong today, but a
  load-bearing guarantee rests on a comment rather than on a test, which is the
  species `AGENTS.md`'s testing model names explicitly.
- **Area:** `apps/web/src/server/entitlements/planVersions.ts:14` (the module
  header), `apps/web/src/server/entitlements/planVersions.noExtension.test.ts`
- **Symptom / What happens:** the module header states —

  > Nothing in the codebase has a write path to this file: the only way an entry
  > changes is a pull request, and `planVersions.immutability.test.ts` fails if a
  > published entry's shape is mutated at runtime or if any code path can update
  > one.

  **`planVersions.immutability.test.ts` does not exist.** Verified 2026-09-16:
  `find . -name "*immutab*"` outside `node_modules` returns nothing, and no test
  in the repository asserts `Object.isFrozen` or that mutating a published entry
  throws or no-ops.
- **What IS covered, so the gap is narrower than the missing filename suggests:**
  - `planVersions.noExtension.test.ts`'s `V1_AS_PUBLISHED` pins every published
    v1 entry field by field, price included. That covers the *"a pull request
    cannot silently edit a published entry"* half, and covers it well — an
    in-place edit fails a test in the same diff that makes it.
  - `planVersions.ts:282-299` really does `Object.freeze` each entry, its
    `entitlements`, its `ceilings`, its `price` when non-null, and
    `PLAN_VERSIONS` itself. The runtime guarantee exists in the code.
- **What is NOT covered:** nothing asserts the freeze holds. Remove or reorder
  those `Object.freeze` calls, or add a nested object the shallow freeze misses
  — which is the exact failure the `price` freeze comment says it exists to
  prevent — and **every test still passes** while the header's claim silently
  becomes false.
- **Why it matters:** ADR-045 rule 3 makes this file the single chokepoint for
  "what were this account's terms", and M20's gate box *"editing `premium`'s
  entitlements or ceilings creates `v2`; `v1`'s entry is byte-identical
  afterwards"* is ticked against it. `AGENTS.md`: *"If a comment asserts an
  invariant, a test enforces it or the comment is a lie with a timer on it.
  KI-1, the `evolveTrip` totality hole, and KI-14 were all the same species."*
- **The fix, either half of which closes this:**
  1. *Preferred* — write `planVersions.immutability.test.ts` so the cited file
     exists and asserts what the comment claims: `Object.isFrozen` on
     `PLAN_VERSIONS` and on every entry, on each `entitlements`, `ceilings` and
     non-null `price`, and that a mutation attempt on a published entry does not
     take effect. Assert the behaviour the runtime actually gives (a write to a
     frozen object throws in strict-mode ESM) rather than assuming it.
  2. Or correct the comment to name `noExtension.test.ts` and state precisely
     what is and is not enforced.
- **Found by:** the M22 API design session, 2026-09-16, while establishing
  whether `api.tokens` could be added to `premium@v1` in place. The answer turned
  on how immutability is enforced, and the enforcement was one file short of what
  the comment described.
- **Check subset for the fix:** `pnpm --filter web typecheck`, plus
  `pnpm --filter web test src/server/entitlements/`. Note `moduleBoundary.test.ts`
  forbids importing any trip type under `server/entitlements/`. Red-first applies:
  remove one `Object.freeze` call, watch it go red for your reason, restore it.
- **Fix.** Took the preferred half: `apps/web/src/server/entitlements/planVersions.immutability.test.ts`
  now exists, so the module header's citation is true as written and
  `planVersions.ts` is unchanged. The test does two things. It walks every
  object reachable from `PLAN_VERSIONS` and requires each to be frozen, so a
  nested record added to `PlanVersion` later without its own freeze also goes
  red. It also names the fields the entry lists: every entry, its
  `entitlements`, `ceilings` and non-null `price`, plus the list itself. It then
  asserts the behaviour the runtime actually gives. Writing a price, replacing
  `price`, pushing an entitlement, writing a ceiling or `version`, and running
  `sort`/`push`/`pop` on the list each throw `TypeError`, and the value
  afterwards is unchanged. No code defect was found: the freeze loop was
  already correct and had only never been asserted.
- **Proven.** Reproduction: with `if (entry.price !== null) Object.freeze(entry.price);`
  commented out, every existing unit test in `server/entitlements/` and
  `server/billing/` still passed: `Test Files 16 passed (16)`, `Tests 137
  passed (137)`. That is the entry's claim, reproduced. The new file failed on
  the same source: `expected [ 'PLAN_VERSIONS.0.price', …(3) ] to deeply equal
  []`, `expected false to be true` for each priced version, and `cannot change
  what a version costs`: `expected function to throw an error, but it didn't`.
  In total `Tests 6 failed | 4 passed (10)`. A second break, removing
  `Object.freeze(PLAN_VERSIONS)`, failed three tests, including `expected [
  'PLAN_VERSIONS' ] to deeply equal []` and the `sort`/`push`/`pop` test with
  `expected function to throw an error, but it didn't`. Once the source was
  restored the file passed with `Tests 10 passed (10)`. Checks
  (`minimal-check-subset`, `web` only): `pnpm --filter web typecheck` was
  clean, and `eslint --max-warnings 0` on the new file was clean.
- **Resolved:** 2026-09-24.
