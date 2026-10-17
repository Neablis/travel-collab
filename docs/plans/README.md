# Implementation plans: staged here while the work is in flight, then history

Execution plans are **write-once scaffolding**: they exist to drive one build, and they stop
being true the moment the code lands. So a plan is checked out **only while its work is in
flight**, and is deleted when that work closes. Once (2026-08) they were all archived at
once: keeping every old plan checked out cost ~131,000 tokens of search noise, 69% of the
documentation corpus then, and every agent orienting itself paid it. Deleted plans are all
still in git history; nothing is lost.

## What is here, and when it goes

- **A milestone's plan** (named for its milestone, e.g. `…-M46-…`) is deleted in the gate-close
  commit that appends the retro (`close-a-milestone`, `TODO.md`'s standing tasks). A plan here
  for a milestone whose gate has closed is the defect to look for; `pnpm milestones` says which
  are closed. The closed ones still checked out were removed on 2026-10-17.
- **A plan for work beside the milestones** (a pass, a refactor, a role) names its own end in
  its header, such as a test that has to run or an ADR that has to be written first. Delete it
  when that happens, after promoting anything durable out of it.
- **`2026-08-23-test-suite-overhaul.md` and `test-overhaul/`** stay until task 7.5's ADR is
  written (`TODO.md`, *Deferred work, still live*); the rejected levers in them are the durable
  half.

`ls docs/plans` is the list. It is not restated here, because a copy drifts.

## Where the durable half goes

| You want | Read |
|---|---|
| Why a decision was made | `docs/architecture/` (ADRs) |
| What a milestone set out to do, and its retro | `docs/milestones/` |
| The design behind a milestone | `docs/specs/` |
| What is known-broken | `docs/known-issues/` (one file per entry; `open/` is the list) |
| Where the work is right now | `docs/STATUS.md` |
| How to build, connect and validate | `docs/guidelines/` |

If a plan contained reasoning that outlived its build, that reasoning belongs in an ADR or a
known-issue entry, not here. (KI-10's rejected-approach comparison was inlined into its entry,
now `docs/known-issues/open/KI-010-…`, for exactly this reason when the plans were archived.)

## Retrieving a deleted plan

List them:

```bash
git log --diff-filter=D --name-only --format='%h %ad' --date=short -- docs/plans docs/superpowers/plans
```

Read one without checking it out:

```bash
git show <sha>^:docs/plans/2026-07-20-M7-solo-delight.md
```

Restore one into the working tree if you genuinely need it:

```bash
git checkout <sha>^ -- docs/plans/2026-07-20-M7-solo-delight.md
```

## Writing a new plan

Still do it: a plan for multi-step work is worth the effort (`plan-a-milestone` writes a
milestone's). Treat `docs/plans/` as a **staging area**: the plan lives here while the work is in
flight and is removed when it closes. Anything you would regret losing gets promoted to an ADR, a
milestone note or a known issue *before* the plan goes.
