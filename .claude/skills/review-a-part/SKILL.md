---
name: review-a-part
description: Review policy for one milestone part in travel-collab — a part-reviewer subagent after every push, one extra fresh pass on the riskiest part, every finding fixed or answered, and when the part is ready to merge. Use right after a push to a part's PR.
---

# Review a part

1. **After every push, run a new `part-reviewer` agent** on the PR and its base (`main`). On a
   re-run, give it the path of the last review's file so it checks those fixes hold; never message
   the earlier reviewer (`closed-agent-guard.mjs`). A push of a part branch tells
   whoever pushed, usually the implementer, to report it (`push-review-nudge.mjs`); the hook does
   not reach you, so dispatch the reviewer when the implementer's report names the push.
2. **The riskiest part gets one extra pass.** Before the riskiest or largest part is called ready,
   run one more new `part-reviewer` on its whole diff against `main`, with no earlier review's
   file, so it reads the part fresh instead of checking fixes. CodeRabbit was this step until
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
   only if each has its own worktree. Parts sit on `main`, so nothing merges upward.
6. **Ready to merge** when CI is green on the part's head and every finding is fixed or answered.
   Say so in the PR body and in part 0's tracker, tick the part's task, and tell Mitchell.
   The PR body's "Ready to merge" section carries the **preview URL of the PR's head**, for
   Mitchell's walk (Mitchell, 2026-10-12: Vercel's own PR comment stays off, `github.silent` in
   `apps/web/vercel.json`, because its edits woke watching sessions). Take it from
   `mcp__Vercel__list_deployments` (project `prj_UoxcnmAsWMtHXx8jLXyespRqSULM`, team
   `team_FOAEiiLfMMxICIFszLWvzfzF`), filtered by the head's `sha`, state `READY`. If that
   deployment is `ERROR` with `git_info_fail`, re-run the head's `vercel-preview` run
   (`gh api -X POST repos/Neablis/travel-collab/actions/runs/<id>/rerun`); do not push to retry
   (KI-20261012-d).
