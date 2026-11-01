---
name: close-a-milestone
description: Test and close a travel-collab milestone — bring main into the stack, retarget the top part's PR to main and mark it ready for the one full CI run, keep part 0's tracker, support Mitchell's walk of the top preview, tick gate boxes only with evidence (CI on the top part's head for e2e), write the retro, run pnpm milestone close, update STATUS and delete the plan. Use once every part of the stack is done.
---

# Close a milestone

`docs/guidelines/building-a-milestone.md` §4 is the source. A subagent does the edits; you answer
Mitchell. The close runs on Sonnet (`building-a-milestone.md`, *Models*). **Steps 4 to 7 run in a fresh session**, which the orchestrator starts itself with
`create_session` from the `/next-prompt` handoff once CI is green on the top part
(`building-a-milestone.md`, *Hand-off*), so the close does not re-read the whole build on every
call.

1. **Test the stack on the top part**, once every part is done (`review-a-part` step 6). One
   subagent, in order: merge `origin/main` into part 1 and carry it up, part by part, to the top
   (`stacked-prs.md` §2), and pick any migration, ADR or KI number only after that merge;
   retarget the top PR to `main` (`github-rest`: `PATCH pulls/<n> -f base=main`); on the top
   branch, check `git diff origin/main...HEAD --stat` lists every part's files and nothing else;
   then mark the top PR ready (`POST pulls/<n>/ccr/ready_for_review`) and push nothing until its
   CI has started (a push while it is draft cancels the ready run). That run is the milestone's
   full lint, unit, integration and e2e. A red job goes to `ci-triage`, and its fix to a new
   `phase-implementer` on the lowest part it touches, merged up to the top; never a re-run. The
   top's own diff is now the whole milestone, so its reviews read against part N-1, not `main`.
   The lower parts stay drafts.
2. **Keep part 0's tracker current**: a table in its PR body, edited in place, with every part's PR,
   state, review result and fixes, the top's CI runs, and the merge and migration order. Update a row after
   every event; never post a comment per event (`working-a-review.md`, *What we post to GitHub is
   short*).
3. **Support Mitchell's walk** of the **top part's preview**, which holds the whole milestone,
   mouse and keyboard-only. The link is in the top PR body's "Ready to merge" section
   (`review-a-part` step 6), not a Vercel comment; with no preview yet he adds the `preview` label
   (previews are on demand). Read his comments with `mcp__Vercel__list_toolbar_threads`. Each fix
   goes on the lowest part it touches and is merged up (`build-a-part`), with a reply on the
   thread naming the commit. He resolves the threads.
4. **Tick gate boxes only with evidence**: a run, a commit, a file and line. CI on the top part's
   head is the e2e evidence; no full suite runs locally.
5. **Close on part 0.** Merge `main` into it, then:
   - append the retro to the milestone file, in the shape `docs/guidelines/writing-a-retro.md`
     gives. Its `## Spend` block comes from
     `pnpm -s session-metrics --milestone <the build session's transcript> --parts <n> --lines-added <n> --cost-usd <n>`,
     run in each build session before its hand-off, because the transcripts go with the container.
     The block carries the cost broken down by model, alongside the session-metrics total.
     The handoff text carries each session's block; the retro sums them.
     `pnpm milestone close` refuses without that block;
   - run `pnpm milestone close <M>`, then again with `--confirm`;
   - write STATUS's *Where the work is right now* and *Next action*;
   - delete the plan in the same commit as the retro (`docs/plans/README.md`), after promoting
     anything worth keeping to an ADR, the milestone file or a known issue.
6. **Push, then mark part 0 ready** before relying on its CI: a draft runs nothing.
7. **Merges.** Mitchell merges the top part's PR ("Create a merge commit"), which lands every
   part, then part 0. If any part added a migration, remind him to dispatch `migrate-production`
   once; re-read the workflow runs before calling it outstanding. Then close each lower part's
   draft PR with one line naming the top's merge commit. Then `rm "$(git rev-parse --absolute-git-dir)/tc-orchestrator"`, which lifts the
   no-code guard `build-a-milestone` set.
