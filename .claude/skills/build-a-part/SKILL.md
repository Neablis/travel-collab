---
name: build-a-part
description: The hot loop for one milestone part in travel-collab, run by a phase-implementer subagent — red-first test, implement, a fixed scoped local-check recipe (never a full suite), self-check of its own diff, push, and open the PR ready for review against main. Use when building or fixing one part of a milestone.
---

# Build a part

One part, one branch from `main`, one PR into `main`. CI on the PR is the verdict; locally you run
only what touches your diff.

The branch is `claude/m<N>-part<K>-<slug>`, with K from 1 (`claude/m42-part2-drawer-is-cards`). The
hooks know a part by that name (`scripts/hooks/lib/part-branch.mjs`): on it, and only on it, the
PR opens ready and a push prints the review reminder.

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

   Never `pnpm check`, the whole vitest suite or the whole e2e suite (`check-test-lane.mjs` denies
   them, and a web vitest run without `-c`). `pnpm lint` is not denied, but the recipe lints only
   your changed files. A change under `packages/contracts/src` adds `pnpm typecheck` across every
   package; the rest is still CI's.
4. **Self-check your diff** (`git diff origin/main...HEAD`): scope, invariants, comments
   (`commenting.md`), a second way to do something that already has one (ADR-068).
5. **Push, then open the PR ready for review, never draft.** In a cloud session that is the
   `github-rest` skill's *Create a PR* recipe (`gh api -X POST … -F draft=false`), since
   `gh pr create` is GraphQL and fails there; on a laptop `gh pr create` (no `--draft`) works
   too. From a part branch `draft-pr-guard.mjs` refuses `gh pr create --draft` and
   `pr-tool-guard.mjs` refuses `draft: true` through the MCP tools; on `gh api` the no-draft
   rule is yours to keep. A model id is refused in the PR
   title or body (`--title`, `--body`, `--body-file`, or the MCP fields) and in the commit message
   (`commit-message-guard.mjs`). A push while a PR is draft cancels its ready-for-review run. Fill `.github/PULL_REQUEST_TEMPLATE.md`, with each test's source edit and
   real failure text. After that, do not push again until CI has started on the head. Anything
   else you post on GitHub is short (`working-a-review.md`, *What we post to GitHub is short*): a
   thread reply is one line naming the commit. Git runs as plain single commands from your worktree
   root: no `cd … &&`, `git -C`, `$(…)`, pipes or `;`/`&&` chains, which the isolation guard refuses (PR 510: 10 of 18 failed calls; Mitchell, 2026-10-21).
6. **Report** in the `phase-implementer` format; a stop without the pushed sha, the red-first
   table and the `Closed:` line is sent back (`implementer-report-check.mjs`). Review is
   `review-a-part`. Once you have reported you are closed: you take no follow-up.

A fix after review is the same loop on the same branch, run by a **new** agent from a brief: the
branch and its head sha, the findings (usually the path of the reviewer's file: read it first), the
files, and what done means. Start from those files, not from a survey of the repo. Red first where
the fix is a behaviour, then the recipe, then push.
