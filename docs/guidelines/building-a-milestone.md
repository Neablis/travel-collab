# Building a milestone

This is how a milestone goes from "next milestone" to a closed gate in one session. It was first
written from M40 (PR 375 → PR 378) and rewritten after M41 (PR 391 → PR 399), whose retro is at the
end of `docs/milestones/M41-planning-without-friction.md`. M41 taught three things: CodeRabbit's
hourly limit set the pace of a stack, full local suites wasted hours that CI was already spending,
and a design settled only after Mitchell played with the preview cost a second build.

So the process now has three properties:

- **The orchestrating session stays lean.** It holds the decisions, the tasks, PR state and the
  conversation with Mitchell. It never writes or reads source code; subagents carry every build,
  fix, review and gate-close step, each with a written brief.
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

The **`part-reviewer` subagent** reviews every push. It is read-only: it reports ranked findings
with a failure scenario and a fix, and the implementer works them on the part's own branch.
CodeRabbit is optional. It is asked once, on the riskiest or largest part, because this repo gets no
automatic CodeRabbit reviews and about one an hour, and that limit must not pace the work. Every
finding is fixed, or answered on its thread and resolved (`working-a-review.md`).

A part is **ready to merge** when CI is green on its head and its findings are fixed or answered.
Mitchell merges it, and dispatches `migrate-production` after one that adds a migration.

## 4. Close the gate — `close-a-milestone`

Part 0's tracker records every part, review, CI run, merge and migration as it happens. Mitchell
walks each part's preview, with the mouse and keyboard-only, and his comments are fixed on that
part's branch. Each gate box is ticked only with evidence; CI on the merged parts is the e2e
evidence. Then part 0 gets the retro, `pnpm milestone close <M>` (dry run, then `--confirm`), the
STATUS update, and the plan's deletion (`docs/plans/README.md`). Part 0 is marked ready before its
CI is relied on, and Mitchell merges it.

## Standing rules

- **Merges are Mitchell's** unless he says otherwise. `migrate-production` is always his.
- **Never run the live eval without asking him first.** `pnpm --filter web eval` costs money. The
  grader's own tests are free.
- **Speak to Mitchell on a finding, a failure, a merge or a question.** Preview builds, CodeRabbit
  skip notices and summary edits, and echoes of our own replies are read silently.
- **Re-read the source before reporting state.** A PR, check or workflow run read earlier may be out
  of date by the time it is reported.
- **Wait by ending the turn**, with PR subscriptions and scheduled reminders, not by polling.

Work too big for one PR outside a milestone still uses `stacked-prs.md`.
