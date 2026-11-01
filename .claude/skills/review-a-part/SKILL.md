---
name: review-a-part
description: Review policy for one milestone part in travel-collab — a part-reviewer subagent after every push, one extra fresh pass on the riskiest part, every finding fixed or answered, and when the part is done and the stack is ready to merge. Use right after a push to a part's PR.
---

# Review a part

1. **After every push, run a new `part-reviewer` agent** (Sonnet) on the PR and its own base: the part below it, or
   `main` for part 1, so it reads this part's diff and nothing from the parts under it. On a
   re-run, give it the path of the last review's file so it checks those fixes hold, and nothing
   else about the earlier review; never message the earlier reviewer (`closed-agent-guard.mjs`). A push of a part branch tells
   whoever pushed, usually the implementer, to report it (`push-review-nudge.mjs`); the hook does
   not reach you, so dispatch the reviewer when the implementer's report names the push.
2. **The riskiest part gets one extra pass.** Before the riskiest or largest part is called ready,
   run one more new `part-reviewer`, on Opus, on its whole diff against `main`, with no earlier
   review's file, so it reads the part fresh instead of checking fixes. CodeRabbit was this step until
   Mitchell removed it on 2026-10-13; nothing outside the repo reviews a part now.
3. **Work every finding.** Fix it, or answer on its thread why not and resolve the thread
   (`working-a-review.md`). A finding is a claim to check against the code, not an order.
4. **Every review goes on the PR as a short comment** (Mitchell, 2026-10-11: "so I can see what was
   found and fixed"; 2026-10-13: shorter). The orchestrator posts it, never the read-only reviewer,
   in the shape `working-a-review.md` (*What we post to GitHub is short*) gives: a verdict line
   and one line per blocking finding, `file:line — the problem`, at most about 10 lines, built from
   the reviewer's hand-back. **Never post the reviewer's file** (`--body-file`): it stays local and
   goes to the fixer. After the fix push, each finding's thread or line gets one line naming its
   commit, and a CI fix gets one line.
5. **Fixes go on the part's own branch**, through `build-a-part`, by a **new**
   `phase-implementer` whose brief names the branch, the head sha, the review file's path, the
   files and what done means. Findings in different files can go to separate agents in parallel
   only if each has its own worktree. The fix goes on the lowest part it touches, and the brief says to merge it upward to the top
   (`build-a-part`, last paragraph), so the top always holds every fix.
6. **A part is done** when every finding is fixed or answered and the fixes have reached the
   top. It is a draft and runs no CI, so it is never "ready to merge" on its own; tick its task
   and its row in part 0's tracker, and tell Mitchell nothing yet. **The stack is ready to merge**
   when every part is done, CI is green on the top part's head after it is retargeted to `main`
   and marked ready (`close-a-milestone` step 1), and the top's own findings are worked. Say so in
   the top PR's body and part 0's tracker, and tell Mitchell then.
   **Do not request a preview for Mitchell's walk** (2026-10-25: previews are billed and built
   on demand). The top PR's body's "Ready to merge" section says how to get one: add the `preview`
   label to the PR, or run `vercel-preview` with the PR number. If one already exists for the
   head (a `phase-verifier` walk asked for it), that section carries its **URL**, for
   Mitchell's walk (Mitchell, 2026-10-12: Vercel's own PR comment stays off, `github.silent` in
   `apps/web/vercel.json`, because its edits woke watching sessions). Take it from
   `mcp__Vercel__list_deployments` (project `prj_UoxcnmAsWMtHXx8jLXyespRqSULM`, team
   `team_FOAEiiLfMMxICIFszLWvzfzF`), filtered by the head's `sha`, state `READY`. If that
   deployment is `ERROR` with `git_info_fail`, re-run the head's `vercel-preview` run
   (`gh api -X POST repos/Neablis/travel-collab/actions/runs/<id>/rerun`); do not push to retry
   (KI-20261012-d).
