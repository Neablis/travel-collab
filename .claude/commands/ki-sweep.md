---
description: Clear independent known issues in parallel using ki-fixer subagents in isolated worktrees, respecting milestone and contracts constraints.
argument-hint: "[KI numbers, e.g. 6 20 29 — omit to auto-select all safely parallelizable ones]"
---

# KI sweep

Clear the independent known-issue backlog with parallel `ki-fixer` subagents.

Requested KIs (empty means auto-select): **$ARGUMENTS**

## Step 1 — Read the ground truth

Read `AGENTS.md` and every entry in `docs/known-issues/open/` (that directory
is the list — there is deliberately no index file). Note each open entry's
**Area** field — that is the file scope you will use to decide what can run in
parallel.

Then check what the current milestone is:

- `docs/STATUS.md` — where the work actually is
- `TODO.md` — the first unchecked item is the current milestone
- `docs/milestones/README.md` — the gate table

## Step 2 — Triage into four buckets

Never skip this. A naive fan-out over every open KI is wrong here, and the
reasons are structural rather than stylistic.

**Bucket A — blocked by milestone discipline. Do not touch.**
Grep the milestone files for `KI-` references:

```
grep -rn "KI-" docs/milestones/
```

A KI that a *future, not-yet-started* milestone claims to close is that
milestone's scope, not backlog cleanup. As of 2026-08-24, `M9-ai-planning-partner.md`
claims KI-11 and KI-15, and M9 is blocked on M10's Wave-2 gate — which puts the
whole AI cluster (KI-9, 10, 11, 12, 15, 22, 23, 24) out of bounds. Re-derive
this from the files rather than trusting that list; it will drift.

**Bucket B — must be serialized: anything touching `packages/contracts/src`.**
AGENTS.md invariant #5 is the hard exception to all narrowing. These need a full
`pnpm check`, they collide with each other, and they must not run beside a
parallel batch. Do them one at a time, after the batch lands.

**Bucket C — unbounded scope.** An entry whose Area is vague ("`apps/web/src`
(various)") will conflict with everything else in flight. Solo, last, never in
a batch.

**Bucket D — parallelizable.** Everything left whose Area lists concrete,
*mutually disjoint* files. Prove disjointness by comparing the Area fields
pairwise before dispatching; state the comparison in your plan.

Also drop anything that is not repo code at all — a KI about a container image
or external infrastructure cannot be fixed by a worktree agent.

## Step 3 — Show the plan and get approval

Before dispatching anything, show:

- Each bucket with its KIs and the one-line reason for that placement.
- For bucket D, the file scopes side by side, demonstrating no overlap.
- How many agents you are about to launch.

Wait for a go-ahead. Do not dispatch on your own judgment — a wrong bucket
assignment costs a conflicted branch and a wasted CI cycle.

## Step 4 — Dispatch

Launch bucket D concurrently — **all Agent calls in a single message** — using:

- `subagent_type: "ki-fixer"`
- `isolation: "worktree"` so they cannot collide on disk
- one KI per agent, named explicitly

Give every agent these constraints in its prompt:

> Fix exactly this one KI. If you notice a second problem, report it — do not
> fix it. Do not touch any file outside this entry's Area without saying so.
>
> Run ONLY the narrow check subset for your change, per the
> `minimal-check-subset` skill. Do NOT run the full `pnpm check` — several
> agents are running concurrently and the full suite would put every one of
> them under exactly the parallel load that KI-13 documents.
>
> Reproduce the bug and quote the real failing output before fixing anything.
> If you cannot reproduce it, stop and report that — "not reproducible" is a
> legitimate outcome, and KI-13 was closed exactly that way.

## Step 5 — Watch for contention, not just failures

KI-13's entire history is component tests timing out under parallel load, and a
batch of concurrent agents is that reproduction condition.

If agents report a **different random subset** of failures each run, that is
resource contention, not bugs. Stop, check `ps aux` sorted by CPU for an
external consumer, and tell the user — do not silently retry.

## Step 6 — Land the work

Ask whether the user wants **one PR per KI** (independent review and revert) or
**all of them on one branch** (a single review and a single CI cycle). Default
to one per KI. The two answers have different mechanics — 6a and 6b below.

For either answer, first confirm each agent resolved its entry properly:
`git mv docs/known-issues/open/KI-0XX-….md docs/known-issues/resolved/`, ` — RESOLVED`
appended to the heading inside that file, and the proof line present, per the
`ki-fixer` definition. If it did not, do it.

### 6a — One PR per KI (default)

In the main session, one KI at a time:

1. Run the **full `pnpm check`** once — serially, never concurrently.
2. Open a PR using `.github/PULL_REQUEST_TEMPLATE.md`. Fill in **Verification
   actually performed** honestly, including what was *not* run and why.
3. Wait on checks in the correct order — straight after a push, `--watch` can
   return in a second with the *previous* commit's green results:

```
gh run list --commit "$(git rev-parse HEAD)" --limit 1
gh pr checks <n> --watch --fail-fast
```

### 6b — One integration branch (the "all on one branch" answer)

Do **not** merge the sweep's branches into `main` one at a time. Cut one
integration branch off `main` and merge the sweep into it, then land that once:

```
git switch main && git pull
git switch -c claude/ki-sweep-<date>-integration
for b in <sweep branches>; do git merge --no-ff "$b" || break; done   # resolve here, once
pnpm check                                                            # one full run
gh pr create --draft ...                                              # one PR, one CI cycle
```

O(N) instead of O(N²): on the 2026-08-29 sweep, landing four branches serially
cost **10 conflict resolutions (4+3+2+1) and 4 extra CI cycles**, because every
merge to `main` invalidated every remaining branch's resolution.

**Since 2026-08-30 this is a cost optimisation, not a conflict remedy.**
`docs/known-issues/` is one file per entry (KI-95), so filing is a new file and
resolving is a `git mv` plus an edit inside the moved file — parallel branches no
longer collide there at all. What 6b still buys is **one review and one CI cycle
instead of N**, which matters against the 2,000-minute GitHub Free-plan budget
`AGENTS.md` and `docs/guidelines/ci-cost-and-capacity.md` flag. Choose it when
the sweep's fixes are small and independently reviewable in one pass; choose 6a
when any single fix deserves its own review or its own revert boundary.

## Step 7 — Prove nothing was stranded

**This step exists because it has already gone wrong.** A sweep on 2026-08-24
produced three good fixes — KI-6, KI-29, KI-31 — on local branches
(`ki-6-listpages-race`, `ki-29-double-overlap`, `ki-31-orphan-guard`), and none
were ever pushed. All three entries stayed in `docs/known-issues/open/` while
the work sat finished on disk. A fix nobody can see is not a fix.

Before reporting, verify every branch this sweep created:

```
git for-each-ref --format='%(refname:short)' refs/heads
gh pr list --state open --json headRefName --jq '.[].headRefName'
```

For each sweep branch confirm it is pushed **and** has an open or merged PR:

```
git log --oneline origin/main..<branch>
git ls-remote --exit-code origin refs/heads/<branch> >/dev/null && echo pushed || echo "NOT PUSHED"
```

Any branch with commits, no remote ref, or no PR is stranded. Say so
explicitly and loudly — do not let it disappear into the summary.

## Step 8 — Report

- Which KIs closed, and how each was proven.
- Which could not be reproduced, and what that implies for the entry.
- Anything found and deliberately left, so it gets filed rather than lost.
- What remains in buckets A, B and C, and what would unblock each.
