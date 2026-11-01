# Building a milestone

This is how a milestone goes from "next milestone" to a closed gate in one session. It was first
written from M40 (PR 375 → PR 378) and rewritten after M41 (PR 391 → PR 399), whose retro is at the
end of `docs/milestones/M41-planning-without-friction.md`. M41 taught three things: CodeRabbit's
hourly limit set the pace of a stack, full local suites wasted hours that CI was already spending,
and a design settled only after Mitchell played with the preview cost a second build.

**Changed 2026-10-13, after M45's cost retro.** Mitchell's verdict on M45: *"it was better but not
great, still a lot of waste and less automatey"* (`docs/milestones/M45-the-assistant-beyond-one-trip.md`,
*The whole milestone's cost*). He decided four things the same day:

1. **CodeRabbit is removed; we do our own reviews.** A `part-reviewer` after every push, and one
   extra fresh pass on the riskiest part (§3; `AGENTS.md`, *Review is ours*).
2. **What we post to GitHub is short** (`working-a-review.md`, *What we post to GitHub is short*).
3. **The orchestrator starts its own continuation session** (*Hand-off*, below).
4. **Scheduled check-ins replace PR subscriptions** (`AGENTS.md`, *Waiting on PR checks*).

These are process choices, so they are recorded here and in `AGENTS.md`, not in an ADR.

**Changed 2026-11-01: a milestone is one stack, built end to end.** Mitchell: *"use stacked PRs
rather than stop and wait for me to merge. I want the milestone built end to end and the testing
is done on the last PR."* Until then each part targeted `main` and a part that needed an earlier one
waited for Mitchell to merge it, so a build stalled on him between parts. Now part K+1 branches from
part K, every part's PR is a draft, and the top part's PR, retargeted to `main` and marked ready
once the whole stack is built and reviewed, carries the one full CI run. The overnight-only stack
that `plan-a-milestone` allowed since 2026-10-17 is now the only shape.

So the process now has three properties:

- **The orchestrating session stays lean.** It holds the decisions, the tasks, PR state and the
  conversation with Mitchell. It never writes or reads source code; subagents carry every build,
  fix, review and gate-close step, each with a written brief. A session costs about *calls ×
  context*, so it is also woken as rarely as possible: by subagent reports and by its own scheduled
  check-in, never by a GitHub event. It hands follow-ups to new agents (see *Spend*, below).
- **The parts are one stack, and nothing waits on a merge.** Part 1 branches from `main`; part K+1
  branches from part K's head and its PR targets part K's branch. Each part's PR is a draft and the
  review unit for that part's diff alone. Mitchell is needed for the decisions at the start and
  for the walk and the merge at the end, not in between.
- **CI on the top PR is the verdict.** Locally a part runs the checks that touch its diff and
  nothing more. A draft runs no CI, so the full lint, test and e2e run happens once, on the top
  part's PR after it is retargeted to `main` and marked ready, against a tree holding every part.

The `build-a-milestone` skill is the orchestrator. It loads one sub-skill per stage, so each stage's
detail is read only when it is needed. This file says what each stage is for; the skills say how.
The mechanics of a stack (merging `main` in, fixes to the lowest part, the squash recovery) are
`stacked-prs.md`; this file says what is different for a milestone.

## 1. Plan — `plan-a-milestone`

Find the milestone (`pnpm state`, `docs/STATUS.md`, the milestone file) and say so if the files
that record it disagree. Put each open decision to Mitchell in plain language, with a
recommendation and the code it touches. **For every part with user-visible behavior, show him the interaction model**
before it is built: a few lines on how it is driven, such as the palette's *Action › Type ›
Target*. Then name the session, open part 0, and split the work into parts. **Every decision is
answered before part 1 starts**: this is the one stage that needs Mitchell in the room, and the
build after it runs without him.

- **Part 0** is prose only: the answered decisions, any ADR, the plan in `docs/plans/`, and the
  gate tracker in its PR body. It lives on the session's branch, from `main`, outside the stack;
  it opens as a draft, is marked ready at the gate, and merges last, after the top part.
- **Parts 1…N** are one stack, in the order the plan gives: one theme each, under about 80
  reviewable files, on branches named `claude/m<N>-part<K>-<slug>` (the hooks' part-only rules key
  on that name). Part 1 branches from `main` and its PR targets `main`; part K+1 branches from part
  K's head and its PR targets part K's branch. Each PR's body says `Part K of N`, its base, and that
  the milestone lands through the top part's PR. Order the parts so the ones others build on come
  first; parts with no dependency still go in the stack, in any order.
- **The sidebar tasks** are one per part, stepped through build → test seen red → scoped checks →
  push (draft PR on the part below) → review → fixes (merged upward), plus one for the decisions,
  one for the stack's CI (`main` merged in → top retargeted and ready → CI green → Mitchell's walk →
  merged), and one for the gate close. They are how Mitchell follows along, so they move when the
  part moves.

## 2. Build each part — `build-a-part`

A `phase-implementer` subagent builds one part: a test seen to fail first (CLAUDE.md rule 3), the
code, a fixed scoped local-check recipe, a check of its own diff, a push, and the PR opened **as a
draft on the part below it** (`main` for part 1). A draft runs no CI, which is the point: the
stack's CI runs once, on the top.

Part K+1 starts as soon as part K has pushed; part K's review runs alongside it. So at most two
parts are in flight: one building, the one below it in review or fixes. The full lint, test and e2e
suites are never run locally (CLAUDE.md rule 1).

## 3. Review each part — `review-a-part`

A new **`part-reviewer` subagent** reviews every push, of each part's diff against **its own base**
(the part below it; `main` for part 1). It is read-only: it writes ranked findings with a failure
scenario and a fix to a file, which goes to a new implementer. The orchestrator never posts that
file: it posts a short verdict built from the hand-back (`working-a-review.md`).
The riskiest or largest part gets one extra, fresh `part-reviewer` pass on its whole diff before it
is called done. That pass replaced CodeRabbit, which Mitchell removed on 2026-10-13: we do our own
reviews. Every finding is fixed, or answered on its thread and resolved (`working-a-review.md`).

**A fix goes on the lowest part whose code it changes, then merges upward** (`stacked-prs.md` §3):
the fixer merges part K into K+1, and so on to the top, pushing each. A part is **done** when its
findings are fixed or answered and its fixes have reached the top. A draft part is never "ready to
merge" on its own; it lands through the top.

## 4. Test the stack, then close the gate — `close-a-milestone`

**Once every part is done**, a subagent merges `main` into part 1 and carries it up to the top
(`stacked-prs.md` §2), retargets the top part's PR to `main`
(`gh api -X PATCH …/pulls/<n> -f base=main`), checks that `git diff origin/main...HEAD --stat` on
the top branch lists every part's files and nothing else, and marks that PR ready
(`…/pulls/<n>/ccr/ready_for_review`). That is the milestone's one full CI run: lint, unit,
integration and e2e, on the whole milestone against `main`. When it goes red, `ci-triage` finds the
cause and the fix goes to the lowest part it touches and merges up, so the top's next push re-runs
CI; it is a fix, never a re-run. The lower parts stay drafts throughout.

Part 0's tracker records every part, review, fix and the top's CI runs as they happen. With CI green
on the top's head, the close runs in a fresh session, which the orchestrator starts itself
(*Hand-off*, below). Each gate box is ticked only with evidence; CI on the top part's head is the
e2e evidence. Mitchell walks **the top part's preview**, which holds the whole milestone, with the
mouse and keyboard-only, and each comment is fixed on the lowest part it touches and merged up.
Part 0 gets the retro (`writing-a-retro.md`, with its spend block), `pnpm milestone close <M>` (dry
run, then `--confirm`), the STATUS update, and the plan's deletion (`docs/plans/README.md`). Part 0
is marked ready before its CI is relied on.

**Mitchell merges the top part's PR** ("Create a merge commit"), which lands the whole milestone in
one merge, dispatches `migrate-production` once if any part added a migration, then merges part 0.
The orchestrator then closes each lower part's draft PR with one line naming the merge commit:
its commits are on `main` through the top.

## Models

Model routing is the tier control: the expensive model is spent only where judgment is the work, and the bulk of the tokens run on the cheaper one. Routing is named in briefs and in this file, never in a PR title, body or commit message (a model id there is refused).

- **Opus:** `plan-a-milestone` (the decisions, the plan, the interaction sketches), the riskiest part's extra fresh review, and any decision the plan did not settle.
- **Sonnet:** the default. The orchestrator session, every `phase-implementer` build and fix, the regular `part-reviewer` pass, and the gate close.
- **Cheapest model:** `ci-triage` cause summaries and any "summarize this log or file in under 200 words" subtask. A cheap-model cause is a lead, not a verdict: the fixer verifies it against the code before fixing.

**Session shape.** The plan session runs on Opus; once the plan exists, a planned hand-off starts a Sonnet session for the build and the close, on the hand-off machinery below. One re-orientation (about 94k) buys Sonnet pricing across the whole build instead of Opus.

**On a rate limit,** the step falls back one tier and notes it in its report; it never retries in a loop.

## Hand-off

A session that has grown large hands the rest to a fresh one, and the orchestrator starts that
session itself (Mitchell, 2026-10-13: M45's four hand-offs each waited on him to start them).

**When.** Plan one hand-off, for the close, once CI is green on the top part. Make at most one more mid-build, and only when the
orchestrator's context is past about 200k *and* roughly 100 or more of its calls are still to come.
Below that, a new session's re-orientation costs more than the context it saves (M45's retro, *The
whole milestone's cost*). `orchestrator-context-limit.mjs` is the backstop: it says so on every
prompt that wakes the orchestrator (a check-in, a subagent's report) and after each `pr-digest` run,
once context is past 250k.

**Only with no subagent running.** A `phase-implementer` or `part-reviewer` reports to the session
that dispatched it; one still running at the hand-off would report to a session that has stopped
acting, and its sha, red-first table and review file would reach no one. Wait for every hand-back,
then hand off.

**How**, in this order:

1. **Run `session-metrics`** on this session's transcript and put its block in the handoff text.
   The transcript goes with the container, and M45's spend block covered one session in five
   because only the last one ran it (`writing-a-retro.md`).
2. **Write the handoff** with `/next-prompt`. For a milestone its first instruction to the new
   session is: run `pnpm -s pr-digest`, then arm one `send_later` check-in (`build-a-milestone`).
   The new session has no subscription and no subagents, so without that nothing ever wakes it.
3. **Start the continuation** with `create_session` (the claude-code-remote MCP tool): `source_url`
   `https://github.com/Neablis/travel-collab`, no `environment_id` (it inherits this session's
   environment and model), a title such as `M46 — continued (close)`, and the handoff text as
   `prompt`.
4. **Delete your own pending check-ins**: `list_triggers`, then `delete_trigger` for each one this
   session armed, so the old session is not woken again.
5. **Tell Mitchell in one line**, with the new session's id, and stop acting. A wake that still
   reaches the old session gets that one line again, nothing more.

Measured 2026-10-13: a child session started, cloned `main` and answered in about 40 seconds. It
starts at about 94k context, a trivial first turn cost $0.43, and a chain of sessions started this
way stops at a depth of 8.

## Spend

M42 cost $334, 2.1× M41, for the same amount of code
(`docs/retros/2026-10-12-m42-token-spend-retro.md`). Three habits did it, and each now has a hook
rather than a rule, because the rule that existed ("read routine notifications silently") was
followed and still cost $34:

| Habit | What stops it |
|---|---|
| The orchestrator woken 190 times by GitHub events on part PRs | It subscribes to no PR (2026-10-13) and wakes on one scheduled check-in that runs `pnpm -s pr-digest`; `build-a-milestone` says to unsubscribe on any GitHub wake that still arrives. |
| Follow-ups sent to builders 250k–480k deep, often after their cache expired | `closed-agent-guard.mjs` denies the message; `implementer-brief-check.mjs` makes the new agent's brief complete. |
| Logs and full reviews read into the orchestrator | `orchestrator-lean-reads.mjs` denies job logs; `reviewer-report-check.mjs` keeps the review in a file. |

Every milestone's retro carries a `## Spend` block from `pnpm session-metrics --milestone`, and
the gate close refuses without it. The block carries the cost broken down by model (see *Models*). The targets are in `writing-a-retro.md`.

## Standing rules

- **Merges are Mitchell's** unless he says otherwise, and there are two: the top part's PR, then
  part 0. Nothing in the build waits on one. `migrate-production` is always his.
- **Never run the live eval without asking him first.** `pnpm --filter web eval` costs money. The
  grader's own tests are free.
- **Speak to Mitchell on a finding, a failure, a merge or a question.**
- **Re-read the source before reporting state.** A PR, check or workflow run read earlier may be out
  of date by the time it is reported.
- **Wait by ending the turn**, not by polling. Subagent reports and the orchestrator's one
  `send_later` check-in wake the session (about 60 minutes while a part is building, in review or
  the top is in CI, about 4 hours once everything waits on Mitchell's walk and merge); no PR does. `AGENTS.md`, *Waiting on PR checks*.

Work too big for one PR outside a milestone uses `stacked-prs.md` too.
