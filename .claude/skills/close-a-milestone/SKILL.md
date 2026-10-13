---
name: close-a-milestone
description: Close a travel-collab milestone on its prose-only part 0 — keep the tracker, support Mitchell's preview walk, tick gate boxes only with evidence (CI on the merged parts for e2e), write the retro, run pnpm milestone close, update STATUS and delete the plan. Use once the parts are merged or ready.
---

# Close a milestone

`docs/guidelines/building-a-milestone.md` §4 is the source. A subagent does the edits; you answer
Mitchell. **Steps 4 to 6 run in a fresh session**, started from the `/next-prompt` handoff once
every part is merged, so the close does not re-read the whole build on every call.

1. **Keep part 0's tracker current**: a table in its PR body, edited in place, with every part's PR,
   state, review result, CI run and merge, plus the merge and migration order. Update a row after
   every event; never post a comment per event (`working-a-review.md`, *What we post to GitHub is
   short*).
2. **Support Mitchell's walk** of each part's preview, mouse and keyboard-only. The link is in the
   PR body's "Ready to merge" section (`review-a-part` step 6), not a Vercel comment. Read his comments
   with `mcp__Vercel__list_toolbar_threads`. Each fix goes on that part's branch (`build-a-part`),
   with a reply on the thread naming the commit. He resolves the threads.
3. **Merges.** Mitchell merges each part unless he says otherwise. After a part with a migration,
   remind him to dispatch `migrate-production`; re-read the workflow runs before calling it
   outstanding.
4. **Tick gate boxes only with evidence**: a run, a commit, a file and line. CI on the merged parts
   is the e2e evidence; no full suite runs locally.
5. **Close on part 0.** Merge `main` into it, then:
   - append the retro to the milestone file, in the shape `docs/guidelines/writing-a-retro.md`
     gives. Its `## Spend` block comes from
     `pnpm -s session-metrics --milestone <the build session's transcript> --parts <n> --lines-added <n> --cost-usd <n>`,
     run in the build session before the handoff, because the transcripts go with the container.
     `pnpm milestone close` refuses without that block;
   - run `pnpm milestone close <M>`, then again with `--confirm`;
   - write STATUS's *Where the work is right now* and *Next action*;
   - delete the plan in the same commit as the retro (`docs/plans/README.md`), after promoting
     anything worth keeping to an ADR, the milestone file or a known issue.
6. **Push, then mark part 0 ready** before relying on its CI: a draft runs nothing. Mitchell merges
   part 0. Then `rm "$(git rev-parse --absolute-git-dir)/tc-orchestrator"`, which lifts the
   no-code guard `build-a-milestone` set.
