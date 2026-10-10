---
name: build-a-milestone
description: Build the next milestone in travel-collab end to end — review its decisions with Mitchell, name the session, plan a stacked PR set with a prose-only gate PR as part 0 that merges last, build the parts back to back with diff-scoped local checks, get each part reviewed (CodeRabbit, or a subagent when it is rate-limited), and close the gate. Use when Mitchell says "next milestone", "start M41", "build the milestone", or similar.
---

# Build a milestone

The process is `docs/guidelines/building-a-milestone.md`. Read it first: it is the source, and this
skill only orders the steps and names the tools. The stack mechanics are in
`docs/guidelines/stacked-prs.md`.

## Checklist

Work through it in order. Make a task for each step so Mitchell can follow along.

1. **Find it.** Run `pnpm state`, and read `docs/STATUS.md` and the milestone file in full. If the
   README, `TODO.md`, STATUS or the milestone file disagree about which milestone is current or
   whether it is scoped, say so first.
2. **Review it with Mitchell.** Survey the code each decision touches, with file and line references.
   Then ask each open decision in plain language, with a recommendation (`AskUserQuestion`; mark the
   recommended option). Don't build on an unanswered decision.
3. **Name the session** after the milestone: `set_session_title` with its own session id.
4. **Open part 0** on the session's designated branch, after merging `main` into it. It is prose
   only: the decisions in the milestone file, any ADR, the plan in `docs/plans/`, and a PR body that
   tracks the gate. Pick migration, ADR and KI numbers only after that merge. Subscribe to it.
5. **Build parts 1…N** back to back. Each part:
   - has its own branch (a worktree each), based on the part below, and opens as a draft;
   - has tests seen to fail before they pass (`write-a-test`);
   - is checked locally **by diff only**: typecheck, plus lint and tests over the changed files and
     their neighbours (`minimal-check-subset`), plus the ci-like e2e for the specs it touches;
   - before adding a control or renaming visible text, gets
     `grep -rn '"<text>"' apps/web/e2e/` run against it;
   - leaves the full lint and full test runs to the PR's CI;
   - gets a self-review, then is marked ready and subscribed to.
6. **Review each part.**
   - Post `@coderabbitai review` as each hourly slot frees up, lowest part first, and schedule a
     reminder (`send_later`) for the next slot.
   - If CodeRabbit is rate-limited or unavailable, run the `code-review` skill on the part instead.
   - Work every finding: fix it, or reply why not.
   - Fixes go to the lowest part, then merge upward. Never push to a part under review.
7. **Mark each part reviewed and ready to merge** in its PR body and in part 0's tracker. Tell
   Mitchell.
8. **Mitchell's preview walk** of the top part. Read his comments with
   `mcp__Vercel__list_toolbar_threads`. Fix each one on the lowest part it touches, then reply on its
   thread with the commit. Leave resolving the threads to him.
9. **Mitchell merges bottom-up.** After a part with a migration, remind him to dispatch
   `migrate-production`, and check the workflow runs before saying it is outstanding.
10. **Close the gate on part 0.**
    - Merge `main` into it, then run the full `pnpm --filter web test:e2e:ci-like` on merged `main`.
    - Tick each gate box with its evidence, and append the retro.
    - Run `pnpm milestone close <id>`, then again with `--confirm`.
    - Write STATUS's current-work and *Next action*, then push.
    - Mitchell merges part 0.

## Never

- Merge a PR, or dispatch `migrate-production`.
- Run the live eval (`pnpm --filter web eval`) without asking Mitchell first.
- Poll with `sleep`. Wait by ending the turn: PR events and reminders wake the session.
