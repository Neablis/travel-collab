# Building a milestone

This is how a milestone goes from "next milestone" to a closed gate in one session. It was written from
M40 (2026-10-09 → 10, #375 → #376 → #377 → #378), whose retro is at the end of
`docs/milestones/M40-a-big-change-is-one-change.md`. Mitchell confirmed the process on 2026-10-10.
The `build-a-milestone` skill runs it.

The mechanics of a stack (file budgets, where fixes go, merge commits, squash recovery, worktree
hygiene) are in `stacked-prs.md`. This file is the order of the whole session, and it does not
repeat them.

## The process

**1. Find the milestone.** Mitchell says "next milestone" (or names one). Run `pnpm state` and read
`docs/STATUS.md`. If the files that record the current milestone disagree (README, `TODO.md`,
STATUS, the milestone file), say so before going further.

**2. Review it with Mitchell.** Read the milestone file in full, and survey the code it touches,
with file and line references. Then put each open decision to him in plain language, with a
recommendation and what changes if he picks otherwise. He answers. Nothing is built on a decision he
has not answered.

**3. Name the session** after the milestone, in its own words, short enough to read in a list:
*"M40 — A big change is reviewed, taken and undone whole"*.

**4. Plan the stack, with the gate PR as part 0.**
- **Part 0** is prose only. It holds:
  - the answered decisions, written into the milestone file;
  - any ADR;
  - the plan in `docs/plans/`, which says per part what to click on its preview to see it work;
  - the gate tracker, in its PR body: the stack table, every gate box with its evidence, the review
    log, and the merge and migration order. **Update it after every event**: a part opened, a
    review result, a merge, a migration.
- **Parts 1…N** split the work in dependency order, one theme each, inside `stacked-prs.md` §1's
  budget. Each part is on its own branch, based on the part below. Each opens as a draft.
- **Part 0 merges last**, once every gate box is ticked. It is also where the gate is closed (step 10).

**5. Build the parts back to back.** Start the next part while the one below is in review. For each
part:
- Write tests that are seen to fail before they pass (`testing.md`; CLAUDE.md rule 3).
- **Check locally with a diff-scoped run, not the whole suite.** Run typecheck, and run lint and
  tests over the files you changed and their neighbours: what imports them, what they import, and
  the specs that exercise them. Use `minimal-check-subset` to pick these. Before adding a control or
  renaming visible text, `grep -rn '"<the text>"' apps/web/e2e/` finds every spec that would now
  see it twice. M40 broke `m16-assistant.spec.ts` that way. Run the ci-like e2e for the specs the
  part touches (CLAUDE.md rule 1).
- **Leave the full lint and full test runs to the PR's CI.** CI runs the whole suite on every push
  to a ready PR, so a full local run only repeats it. When CI goes red, root-cause it and push a fix.
  Never re-run it and hope.
- Self-review the part's own diff before asking anyone else (`stacked-prs.md` §3a).
- Mark it ready, which starts CI. Don't push in the same second as marking it ready: CI can run on
  the old head. If it does, mark the PR draft and ready again.

**6. Review each part.**
- **CodeRabbit** allows about one review an hour. Trigger it with `@coderabbitai review` as each
  slot frees up, lowest part first. Mitchell asked for this on 2026-10-09. Schedule a reminder for
  the next slot rather than polling. Never push to a part while its review runs (`stacked-prs.md` §3).
- **When CodeRabbit is rate-limited or unavailable**, review the part with a subagent (the
  `code-review` skill) instead of waiting.
- Work every finding: fix it, or reply on its thread with why not (`working-a-review.md`). A bot
  finding is a claim to check, not an order.
- Fixes go to the lowest part they touch, then merge upward (`stacked-prs.md` §3).

**7. Mark each part reviewed and ready to merge.** When its review is worked and its CI is green,
say so in its PR body and in part 0's tracker, and tell Mitchell.

**8. Mitchell walks the top part's preview.** The top part contains everything, so the walk happens
there. Each of his Vercel comments is fixed on the lowest part it touches, with a reply on its thread
naming the commit. He resolves the threads, not the agent.

**9. Mitchell merges parts 1…N bottom-up**, each with "Create a merge commit" (`stacked-prs.md` §4).
After any part that adds a migration, `migrate-production` is dispatched before the next part
merges. Before saying a migration is outstanding, re-read the workflow runs.

**10. Close the gate on part 0.**
- Merge `main` into part 0.
- Run the full `test:e2e:ci-like` on merged `main`. This is the one full local run, and it is
  what the e2e gate box asks for.
- Tick every gate box with its evidence.
- Append the retro to the milestone file.
- Run `pnpm milestone close <id>` (dry run, then `--confirm`).
- Write STATUS's *Where the work is right now* and *Next action*.
- Push. Mitchell merges part 0, and the milestone is closed.

## Standing rules

- **Nothing merges without Mitchell**, and he dispatches `migrate-production`.
- **Never run the live eval without asking him first.** `pnpm --filter web eval` costs money. The
  grader's own tests are free.
- **Re-read the source before reporting state.** A PR, a check or a workflow run read earlier may
  be out of date by the time it is reported.
- **Wait by ending the turn**, with PR subscriptions and scheduled reminders, not by polling.
