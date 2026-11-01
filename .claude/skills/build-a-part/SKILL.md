---
name: build-a-part
description: The hot loop for one milestone part in travel-collab, run by a phase-implementer subagent — red-first test, implement, a fixed scoped local-check recipe (never a full suite), self-check of its own diff, push, and open the PR as a draft on the part below it (main for part 1). Use when building or fixing one part of a milestone.
---

# Build a part

One part, one branch in the milestone's stack, one **draft** PR. Part 1 branches from `main` and
its PR targets `main`; part K+1 branches from part K's head (`origin/claude/m<N>-part<K>-…`) and
its PR targets part K's branch. The brief names the base. A draft runs no CI: the milestone's one
full CI run is on the top part (`close-a-milestone` step 1), so locally you run only what touches
your diff, and that is the only check this part gets until then. This skill runs on Sonnet unless the brief names another model; the
model is named in the brief, never in the PR title or body.

The branch is `claude/m<N>-part<K>-<slug>`, with K from 1 (`claude/m42-part2-drawer-is-cards`). The
hooks know a part by that name (`scripts/hooks/lib/part-branch.mjs`): on it, and only on it, the
PR must open as a draft and a push prints the review reminder.

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
4. **Self-check your diff** against your base (`git diff origin/<base>...HEAD`, the part below
   or `main`): scope, invariants, comments
   (`commenting.md`), a second way to do something that already has one (ADR-068).
5. **Push, then open the PR as a draft on your base.** In a cloud session that is the
   `github-rest` skill's *Create a PR* recipe with `-f base=<the part below, or main> -F
   draft=true`, since `gh pr create` is GraphQL and fails there; on a laptop
   `gh pr create --draft --base <base>` works too. From a part branch `draft-pr-guard.mjs`
   refuses `gh pr create` without `--draft` and `pr-tool-guard.mjs` refuses a create without
   `draft: true` through the MCP tools; on `gh api` the draft rule is yours to keep. Never mark
   a part ready yourself: only the top part is marked ready, by the stack's CI step. A model id is refused in the PR
   title or body (`--title`, `--body`, `--body-file`, or the MCP fields) and in the commit message
   (`commit-message-guard.mjs`).
   Fill `.github/PULL_REQUEST_TEMPLATE.md`, with each test's source edit and
   real failure text, and put `Part K of N`, the base, and "lands through the top part's PR"
   at the top of the body. Anything
   else you post on GitHub is short (`working-a-review.md`, *What we post to GitHub is short*): a
   thread reply is one line naming the commit. Git runs as plain single commands from your worktree
   root: no `cd … &&`, `git -C`, `$(…)`, pipes or `;`/`&&` chains, which the isolation guard refuses (PR 510: 10 of 18 failed calls; Mitchell, 2026-10-21).
6. **Report** in the `phase-implementer` format; a stop without the pushed sha, the red-first
   table and the `Closed:` line is sent back (`implementer-report-check.mjs`). Paste no code in the
   report; refer to files by file:line. Review is
   `review-a-part`. Once you have reported you are closed: you take no follow-up.

A fix after review is the same loop on the same branch, run by a **new** agent from a brief: the
branch and its head sha, the findings (usually the path of the reviewer's file: read it first), the
files, and what done means. Start from those files, not from a survey of the repo. Red first where
the fix is a behaviour, then the recipe, then push. A fix goes on the lowest part whose code it
changes; then **merge it upward**: check out each part above in turn, `git merge` the one below,
and push, up to the top (`stacked-prs.md` §3). A merge that conflicts is resolved on the upper
part, and the report names every part pushed and its new sha.
