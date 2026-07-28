# Implementation plans live in git history, not in the working tree

Execution plans are **write-once scaffolding**: they exist to drive one
milestone's build, and they stop being true the moment the code lands. Keeping
them checked out cost ~131,000 tokens of search noise — 69% of this repo's
entire documentation corpus, for 45 files' worth of value — and every agent
orienting itself paid it.

They are all still in history. Nothing was lost.

## What replaced them

The durable half of a plan was always somewhere else:

| You want | Read |
|---|---|
| Why a decision was made | `docs/architecture/` (ADRs) |
| What a milestone set out to do, and its retro | `docs/milestones/` |
| The design behind a milestone | `docs/specs/` |
| What is known-broken | `docs/known-issues.md` |
| Where the work is right now | `docs/STATUS.md` |
| How to build/connect/validate | `docs/guidelines/` |

If a plan contained reasoning that outlived its milestone, that reasoning
belongs in an ADR or a known-issue entry — not here. (KI-10's rejected-approach
comparison was inlined into `docs/known-issues.md` for exactly this reason when
the plans were archived.)

## Retrieving an archived plan

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

Still do it — `superpowers:writing-plans` is unchanged, and a plan for
multi-step work is worth the effort. Just treat `docs/plans/` as a **staging
area**: the plan lives here while the milestone is in flight, and at gate close
it is removed in the same commit that appends the retro. Anything you would
regret losing gets promoted to an ADR, a milestone note, or a known issue
*before* the plan goes.
