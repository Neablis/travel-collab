# Building a milestone

This is how a milestone goes from "next milestone" to a closed gate in one session. It was first
written from M40 (PR 375 → PR 378) and rewritten after M41 (PR 391 → PR 399), whose retro is at the
end of `docs/milestones/M41-planning-without-friction.md`. M41 taught three things: CodeRabbit's
hourly limit set the pace of a stack, full local suites wasted hours that CI was already spending,
and a design settled only after Mitchell played with the preview cost a second build.

So the process now has three properties:

- **The orchestrating session stays lean.** It holds the decisions, the tasks, PR state and the
  conversation with Mitchell. It never writes or reads source code; subagents carry every build,
  fix, review and gate-close step, each with a written brief. A session costs about *calls ×
  context*, so it is also woken as rarely as possible and hands follow-ups to new agents (see
  *Spend*, below).
- **Each part is its own PR on `main`**, merged when it is ready. Only part 0, the prose-only gate
  PR, waits for the end.
- **CI on the PR is the verdict.** Locally a part runs the checks that touch its diff and nothing
  more.

The `build-a-milestone` skill is the orchestrator. It loads one sub-skill per stage, so each stage's
detail is read only when it is needed. This file says what each stage is for; the skills say how.

## 1. Plan — `plan-a-milestone`

Find the milestone (`pnpm state`, `docs/STATUS.md`, the milestone file) and say so if the files
that record it disagree. Put each open decision to Mitchell in plain language, with a
recommendation and the code it touches. **For a UI-heavy part, show him the interaction model**
before it is built: a few lines on how it is driven, such as the palette's *Action › Type ›
Target*. Then name the session, open part 0, and split the work into parts.

- **Part 0** is prose only: the answered decisions, any ADR, the plan in `docs/plans/`, and the
  gate tracker in its PR body. It lives on the session's branch, opens as a draft, is marked ready
  at the gate, and merges last.
- **Parts 1…N** each target `main`, one theme each, under about 80 reviewable files, on branches
  named `claude/m<N>-part<K>-<slug>`: the hooks' part-only rules key on that name. A part that
  depends on another waits for it to merge to `main`; nothing is based on part 0 or on another part.
- **The sidebar tasks** are one per part, stepped through build → test seen red → scoped checks →
  push (opened ready) → review → fixes → CI green → merged, plus one for the decisions and one for
  the gate close. They are how Mitchell follows along, so they move when the part moves.

## 2. Build each part — `build-a-part`

A `phase-implementer` subagent builds one part: a test seen to fail first (CLAUDE.md rule 3), the
code, a fixed scoped local-check recipe, a check of its own diff, a push, and the PR opened **ready
for review, never draft**. A draft runs no CI, and a push while a PR is draft cancels its
ready-for-review run.

Parts with no dependency between them are built in parallel, each in its own worktree. The full
lint, test and e2e suites are never run locally: CI runs them on every push to a ready PR (CLAUDE.md
rule 1). When CI goes red, `ci-triage` finds the cause and the part gets a fix, not a re-run.

## 3. Review each part — `review-a-part`

A new **`part-reviewer` subagent** reviews every push. It is read-only: it writes ranked findings
with a failure scenario and a fix to a file, which the orchestrator posts on the PR and hands to a
new implementer, who works them on the part's own branch.
The riskiest or largest part gets one extra, fresh `part-reviewer` pass on its whole diff before it
is called ready. That pass replaced CodeRabbit, which Mitchell removed on 2026-10-13: we do our own
reviews. Every finding is fixed, or answered on its thread and resolved (`working-a-review.md`).

A part is **ready to merge** when CI is green on its head and its findings are fixed or answered.
Mitchell merges it, and dispatches `migrate-production` after one that adds a migration.

## 4. Close the gate — `close-a-milestone`

Part 0's tracker records every part, review, CI run, merge and migration as it happens. Mitchell
walks each part's preview, with the mouse and keyboard-only, and his comments are fixed on that
part's branch. Each gate box is ticked only with evidence; CI on the merged parts is the e2e
evidence. The close runs in a fresh session, which the orchestrator starts itself once the parts
are merged (*Hand-off*, below). Part 0 gets the retro (`writing-a-retro.md`, with its spend block), `pnpm milestone close
<M>` (dry run, then `--confirm`), the STATUS update, and the plan's deletion
(`docs/plans/README.md`). Part 0 is marked ready before its
CI is relied on, and Mitchell merges it.

## Hand-off

A session that has grown large hands the rest to a fresh one, and the orchestrator starts that
session itself (Mitchell, 2026-10-13: M45's four hand-offs each waited on him to start them).

**When.** Plan one hand-off, for the close. Make at most one more mid-build, and only when the
orchestrator's context is past about 250k *and* roughly 100 or more of its calls are still to come.
Below that, a new session's re-orientation costs more than the context it saves (M45's retro, *The
whole milestone's cost*).

**How**, in this order:

1. **Run `session-metrics`** on this session's transcript and put its block in the handoff text.
   The transcript goes with the container, and M45's spend block covered one session in five
   because only the last one ran it (`writing-a-retro.md`).
2. **Write the handoff** with `/next-prompt`.
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
| The orchestrator woken 190 times by GitHub events on part PRs | It watches only part 0. `notification-unsubscribe-nudge.mjs` says so on any other wake; the implementer's `Closed:` line names the PR to drop. |
| Follow-ups sent to builders 250k–480k deep, often after their cache expired | `closed-agent-guard.mjs` denies the message; `implementer-brief-check.mjs` makes the new agent's brief complete. |
| Logs and full reviews read into the orchestrator | `orchestrator-lean-reads.mjs` denies job logs; `reviewer-report-check.mjs` keeps the review in a file. |

Every milestone's retro carries a `## Spend` block from `pnpm session-metrics --milestone`, and
the gate close refuses without it. The targets are in `writing-a-retro.md`.

## Standing rules

- **Merges are Mitchell's** unless he says otherwise. `migrate-production` is always his.
- **Never run the live eval without asking him first.** `pnpm --filter web eval` costs money. The
  grader's own tests are free.
- **Speak to Mitchell on a finding, a failure, a merge or a question.**
- **Re-read the source before reporting state.** A PR, check or workflow run read earlier may be out
  of date by the time it is reported.
- **Wait by ending the turn**, not by polling. Subagent reports, part 0's PR and scheduled
  reminders wake the session; part PRs do not.

Work too big for one PR outside a milestone still uses `stacked-prs.md`.
