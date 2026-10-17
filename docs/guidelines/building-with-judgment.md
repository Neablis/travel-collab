# Building with judgment

`building-a-milestone.md` is the mechanics: subagents, PR stacks, CI, reviews.
This is the judgment layer — the decisions a feature build makes well or
badly before the process ever matters. Written from the RAG stack and the
trip-guests builds (Oct 2026), where the process was followed and the results
still depended on judgment calls like these.

## Prove the mechanism before building the serving

Eval before serving. The RAG stack ran Gate 1 — offline recall@5 on real
queries — before any retrieval code touched the plan turn. The thesis ("we can
retrieve useful days") was proven true or false with no serving infra at
stake. If the offline eval had failed, only the eval code would have been
wasted, not the serving path.

Rule: nothing serves an unproven mechanism. A demo or a mock is not proof;
proof is the real input going through the real mechanism.

## Gates have teeth, or they aren't gates

Every phase boundary gets an explicit, measurable, written-down pass/fail bar.
RAG Gate 1: macro recall@5 ≥ 0.7. RAG Gate 2: quality parity plus ≥25% output
token reduction. "Roughly okay" is not a verdict.

When a gate fails, stop and diagnose. Don't build on the shaky foundation,
and don't lower the bar to make it pass. Gate 1's first run scored 0.607 —
the answer was root-cause work (the Japan trip was invisible to the eval's
privacy filter; a duplicate trip name broke label resolution), not a softer
bar. Gate 2 scored −5.1% token reduction against the +25% bar — the answer
was an honest FAIL plus a targeted optimization attempt, not a redefined
goal.

## Evals must reflect reality, so use real data

Fixtures lie. Gate 1's labels were first written against a fixture Japan trip
whose day content differed from the real trip — the eval measured a fiction.
The fix was running the eval against production data: the real playbooks,
the real 14-day Japan trip.

When an eval must reflect reality: production data, with the test fixtures
excluded explicitly (RAG's eval excludes the test trips by name pattern, and
the exclusion itself is a tested red-first rule). If the data can't be real,
say so in the runbook and treat the gate as weaker.

## Honest failure, root-caused

A failing number is the start of an investigation, not a verdict to negotiate.
The Gate 1 sequence — 0.607 → diagnose privacy-filter and label-resolution
bugs → fix the causes → re-run → 0.740 — is the whole discipline: fix the
cause, re-run, report the real score. Never massage inputs to hit the bar,
never drop the hard queries, never reframe the metric.

## Small, stacked, independently mergeable PRs

One logical unit per PR: RAG went infra → embed → eval → serving → gate2.
Each merged on its own, in order, with its own review. No big-bang PRs. The
stack is visible in the PR list, and any part can be held, reviewed, or
reverted without dragging the rest.

Eval code and serving code have different lifetimes, so they go in separate
PRs; don't weld them together. The Gate 1 recall eval (PR 461) was its own PR
for that reason, and it merged on 2026-10-17 on Mitchell's call so that it
can be re-run from `main` rather than from a branch. A paid eval on `main` is
still run only when Mitchell asks (`AGENTS.md`); CI runs only its free half.

## Fix forward; production blockers get immediate PRs

When something breaks after merge, fix it as a new PR — never rewrite
history, never force-push main. The invalid `vercel.json` `_comment` that
blocked the RAG deploy became an urgent fix PR (#462) opened the same
morning, marked deploy-blocking, merged the same day.

Same rule for CI: red on the PR is a bug, not background noise. Diagnose,
fix, push, re-verify. Don't hand-wave a check green.

## Mitchell merges

The builder never merges. Mitchell reviews and merges every PR. This is not
politeness — it keeps him in control of what ships, and it forces the work to
be reviewable: small diffs, clear bodies, review findings addressed. If a PR
isn't mergeable by him on a quick read, the PR is the problem, not the
schedule.

## Subagent briefs carry the decision, not the project

Each delegated task states: the task, the desired outcome, the non-obvious
constraints, and what "done" means. Subagents inherit the project context, so
briefs stay focused — no re-explaining the feature. But every judgment call
the brief can't settle belongs in it: which approach to prefer, what to try
first, what must not be done (no paid evals, no merging, no force-push).

## Name the decision-maker and act

When Mitchell says "whatever you think is best," that's delegation, not a
question. Make the call, name the default, keep the gates visible. When he
gives a crisp yes, act on it — don't re-confirm. When he sets a rule
("`service-ai-library` is owned by everyone," "never run the live eval without
asking"), it becomes a standing invariant: write it down, encode it in code
and tests, and don't re-ask.

## When to stop

The hardest judgment call is the stop. Gate discipline defines it in advance:
Gate 2's token bar failed, and the next step was an optimization attempt with
its own bar, not infinite tuning. A gate that fails twice on the same thesis
means the thesis is wrong — report it plainly and propose what the evidence
supports instead. Stopping with a clear "this didn't work, here's why" is a
successful build.
