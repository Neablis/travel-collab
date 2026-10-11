---
name: build-a-part
description: The hot loop for one milestone part in travel-collab, run by a phase-implementer subagent — red-first test, implement, a fixed scoped local-check recipe (never a full suite), self-check of its own diff, push, and open the PR ready for review against main. Use when building or fixing one part of a milestone.
---

# Build a part

One part, one branch from `main`, one PR into `main`. CI on the PR is the verdict; locally you run
only what touches your diff.

1. **Red first.** Write the test before the code (`write-a-test`). Run it and see it fail for the
   reason it names. This is the one local run that must happen.
2. **Implement** inside the part's file scope. Before adding a control or renaming visible text,
   run `grep -rn '"<the text>"' apps/web/e2e/`: a spec that now finds it twice breaks.
3. **Scoped checks**, this recipe and nothing more (`minimal-check-subset` for anything it misses):
   - `npx tsc --noEmit -p apps/web`, or the touched package's tsconfig.
   - `pnpm --filter web exec eslint <changed files>`
   - `pnpm --filter web exec vitest run -c vitest.unit.config.ts <touched test files>`. Without
     `-c` it runs nothing.
   - `WEB_PORT=<n> pnpm --filter web test:e2e:ci-like <spec path>`, for the part's own spec only.
     No `--` before the path: it drops the filter and runs every spec.

   Never `pnpm check`, `pnpm lint`, the whole vitest suite or the whole e2e suite
   (`check-test-lane.mjs` denies them, and a web vitest run without `-c`). A change under
   `packages/contracts/src` adds `pnpm typecheck` across every package; the rest is still CI's.
4. **Self-check your diff** (`git diff origin/main...HEAD`): scope, invariants, comments
   (`commenting.md`), a second way to do something that already has one (ADR-068).
5. **Push, then open the PR ready for review, never draft** (`pr-tool-guard.mjs` refuses a draft,
   and a model id in the title, body or commit message). A push while a PR is draft cancels its
   ready-for-review run. Fill `.github/PULL_REQUEST_TEMPLATE.md`, with each test's source edit and
   real failure text. After that, do not push again until CI has started on the head.
6. **Report** in the `phase-implementer` format; a stop without the pushed sha and the red-first
   table is sent back (`implementer-report-check.mjs`). Review is `review-a-part`.

A fix after review is the same loop on the same branch: red first where the fix is a behaviour,
then the recipe, then push.
