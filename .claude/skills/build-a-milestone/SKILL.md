---
name: build-a-milestone
description: Orchestrate the next milestone in travel-collab end to end — plan it with Mitchell, have subagents build and review the parts as one stack of draft PRs without waiting on a merge, run the one full CI on the top part, and close the gate on a prose-only part 0 that merges last. Loads one sub-skill per stage. Use when Mitchell says "next milestone", "start M41", "build the milestone", or similar.
---

# Build a milestone

The process is `docs/guidelines/building-a-milestone.md`. This skill is the orchestrator: it loads
one sub-skill per stage and hands every hands-on step to a subagent.

| Stage | Load | Who runs it |
|---|---|---|
| Decisions, session name, part 0, the parts, the sidebar tasks | `plan-a-milestone` | you |
| Each part: red test, code, scoped checks, draft PR on the part below | `build-a-part` | `phase-implementer` |
| After every push to a part | `review-a-part` | `part-reviewer` |
| Main merged in, top retargeted and ready, CI, walk, gate boxes, retro, close | `close-a-milestone` | a subagent, then you |

## Your own rules

- **You never write or read source code.** Start by running
  `touch "$(git rev-parse --absolute-git-dir)/tc-orchestrator"`: from then on
  `orchestrator-no-code.mjs` refuses this session's edits under `apps/` and `packages/`. Every build, fix, merge, review and gate-close step goes
  to a subagent with a written brief: the part, its branch, its scope, what done means.
- **You own** the decisions with Mitchell, the sidebar tasks, PR state, and answering Mitchell.
  Move a part's task the moment its state changes.
- **A wake costs your whole context, read or not** (M42: 190 GitHub wakes, $57, 141 of them for
  nothing). So you subscribe to no PR, part 0 included. The harness subscribes you to every PR
  opened in this session, a subagent's too: call `unsubscribe_pr_activity` for it at once,
  and again on any GitHub wake that still reaches you.
- **You wait on a scheduled check-in.** Keep one `send_later` armed: about 60 minutes while any part
  is building or in review or the top is in CI, about 4 hours once everything waits on Mitchell's
  walk and merge. On each, run
  `pnpm -s pr-digest` once, act on everything it prints in that one batch (dispatch reviewers and
  fixers, update the tracker, tell Mitchell), then re-arm. Stop re-arming when nothing is open.
  Subagent reports still wake you as before.
- **A subagent that has reported is closed.** Review fixes, CI fixes and Mitchell's walk changes go
  to a **new** `phase-implementer`; a re-review goes to a new `part-reviewer`.
  `closed-agent-guard.mjs` denies `SendMessage` to an agent idle over 270 seconds or over 150k
  context, because resuming it re-writes and then carries everything it ever read. `SendMessage`
  is for answering an agent that is still running and blocked on you.
- **A brief names the branch, the files and what done means**, and for a follow-up the head sha and
  the findings (`implementer-brief-check.mjs` refuses a dispatch without them). Pass findings as
  the path of the reviewer's file, not as text. A brief names at most about 15 files, the entry
  points and test files; the full scope list lives in the plan, referenced by section, not pasted.
  No code excerpts, no pasted diffs, in any brief. Every follow-up brief, not just a fix, names
  the branch, the head sha, the findings file's path and the files.
- **Keep your own context small.** Never read job logs (`orchestrator-lean-reads.mjs` denies it):
  send a red run to a subagent with `ci-triage` and ask for the cause in under 200 words. Speak to
  Mitchell only on a finding, a failure, a merge, or a question.
- **The parts are one stack, and you never wait on a merge** (Mitchell, 2026-11-01). Part 1
  branches from `main`; part K+1 from part K's head, its draft PR on part K's branch. Dispatch part
  K+1's builder as soon as part K's report names its push, alongside part K's reviewer, so at most
  two parts are in flight: one building, the one below it in review or fixes. A fix goes to the
  lowest part it touches and its brief says to merge it upward to the top
  (`stacked-prs.md` §3).
- **CI runs once, on the top.** Every part's PR is a draft, so none of them runs CI. When every
  part is done, dispatch one subagent to merge `main` into part 1 and carry it up, retarget the top
  PR to `main`, check its diff, and mark it ready (`close-a-milestone` step 1). A red run goes to
  `ci-triage` and then a fixer on the lowest part, never a re-run. Tell Mitchell only when the top
  is green and reviewed, or when something needs his call.
- **Models, by role** (`building-a-milestone.md`, *Models*): Opus plans, the riskiest part's
  extra review, and any decision the plan did not settle; Sonnet is the default for the build,
  the close and this session once the plan exists; the cheapest model triages logs. Name the
  model in the brief, never in a PR title, body or commit message. On a rate limit, fall back
  one tier and note it, never retry in a loop.
- **Merges are Mitchell's** unless he says otherwise: the top part's PR, then part 0. After the
  top merges, close each lower draft PR with one line naming the merge commit.
  `migrate-production` is always his.
- Never run the live eval (`pnpm --filter web eval`) without asking him first.
- Never poll with `sleep`. Wait by ending the turn: subagent reports and your check-ins wake the
  session.
- **You start the fresh session yourself.** Plan one hand-off, for the gate close once CI is green
  on the top part; make at most one more mid-build, only past about 200k context with roughly 100 or more
  of your calls still to come, and never while a subagent is running. Each time: `session-metrics`
  first, then `/next-prompt` (its first line tells the new session to run `pr-digest` and arm a
  check-in), then `create_session` with that text, then delete your pending check-ins, tell Mitchell the new
  session's id in one line, and stop acting (`building-a-milestone.md`, *Hand-off*). A fresh
  session starts near 94k; M42's close ran at about 400k.
- Re-read a PR's head check status, a check or a workflow run before reporting its state; never
  re-read a whole diff to report it, the reviewer owns the diff.
