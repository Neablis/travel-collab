# Kickoff — map rail focus tracking

Handoff brief for the agent implementing this feature. Written to be readable
with zero context from the session that produced the plan.

## Where everything lives

**Repo:** `https://github.com/Neablis/travel-collab`
**Branch:** `claude/trip-map-focus-tracking-0f3e75` (pushed; based on `main`)

Two ways in. Either is fine.

**A — the existing worktree** (nothing to set up; the branch is already checked
out here, and git will refuse to check it out in a second worktree while it is):

```
/Users/mitchelldemarco/Claude/Projects/travel-collab/.claude/worktrees/trip-map-focus-tracking-0f3e75
```

**B — a fresh checkout** anywhere else:

```bash
git clone https://github.com/Neablis/travel-collab.git
cd travel-collab && git checkout claude/trip-map-focus-tracking-0f3e75 && pnpm install
```

All commands in the plan run from `apps/web/`.

### Documents

| What | Path |
| ---- | ---- |
| **The plan you execute** — 6 tasks, 30 steps, TDD, real code in every step | `docs/plans/2026-08-16-map-rail-focus-tracking.md` |
| **The design spec** — root-cause analysis, tuning guide, definition of done | `docs/specs/2026-08-16-map-rail-focus-tracking-design.md` |
| Repo operating manual — invariants, boundaries, definition of done | `AGENTS.md` |
| Where the project's work currently stands | `docs/STATUS.md` |

Read the plan first, then the spec. The plan assumes the spec.

### Code

Everything is under `apps/web/`. Nothing outside it changes.

| File | Task | Change |
| ---- | ---- | ------ |
| `src/components/lenses/mapRailTuning.ts` | 1 | **create** — feel constants + live console override |
| `src/components/lenses/mapRailTuning.test.ts` | 1 | **create** |
| `src/components/lenses/mapRailFocus.ts` | 2 | **create** — pure selection math |
| `src/components/lenses/mapRailFocus.test.ts` | 2 | **create** |
| `vitest.setup.ts` | 3, 4 | modify — swap the IntersectionObserver fixture for a triggerable ResizeObserver |
| `src/components/lenses/MapRail.tsx` | 4 | modify — the main rewrite |
| `src/components/lenses/MapRail.test.tsx` | 4 | modify — rewrite the `scroll-driven focus` block only |
| `e2e/helpers.ts` | 5 | modify — add an API fixture builder |
| `e2e/m10-map-rail.spec.ts` | 5 | **create** — the real-browser gate |
| `src/components/lenses/MapLens.tsx` | — | **do not touch** |

Context you may want to read but will not change: `mapRailData.ts` (the `MapDay`
type the rail renders), `MapFocusCard.tsx`, `MapLegend.tsx`, and
`src/components/trip/context/FocusProvider.tsx` (owns the `focusedDay` state
`MapRail` drives).

### Commands

```bash
pnpm test         # unit (vitest.unit.config.ts)
pnpm lint
pnpm typecheck
pnpm test:e2e     # playwright
pnpm db:reseed    # seeds the 14-day Japan fixture used for live tuning
```

## What you're fixing

`MapRail.tsx` decides which day the map lens focuses as the user scrolls the
rail. It is broken: mid-scroll, focus stays pinned on Day 1. Two prior attempts
fixed it against a green test suite and it stayed broken.

There are four distinct defects — three root causes plus a design flaw — all
diagnosed and verified in the spec. **Don't re-diagnose.** The analysis is done,
and the corrected selection math was checked numerically before it was written
into the plan.

## Things that will mislead you if you don't know them up front

- **The existing tests lie.** Every scroll test in `MapRail.test.tsx` hand-feeds
  a fresh `boundingClientRect` immediately before each scroll event — something
  a real browser never does. The suite is green *because* it encodes the bug as
  correct behaviour. That is why this shipped broken twice. A green unit suite is
  not evidence here; the Playwright spec in Task 5 is the real gate.

- **Do not add a library.** `react-intersection-observer`, scrollspy libraries
  and `@tanstack/react-virtual` were each evaluated and rejected with reasons in
  the spec's Non-goals. The replacement math is about 30 lines.

- **Do not touch `MapLens.tsx`.** Its `fitBounds({ animate: false })` is a
  standing decision by the repo owner, not an oversight.

- **The rail must stay pixel-identical.** No visual change is in scope.

- **Task 6 Step 2 is genuinely unverified.** The design uses a `position: sticky`
  track and reasons it should pin correctly, but nobody has run it. Check it in a
  real browser and apply the documented fallback if it misbehaves. Do not assume
  it works because the plan says it should.

- **`scrollPxPerDay: 240` is arithmetic, not judgement.** Task 6 settles it by
  feel against the seeded Japan fixture. Commit whatever you actually land on,
  not the derived number.

- **If someone challenges the sweeping focus line** — it is the one part of the
  design that revises an earlier decision by the repo owner — the numbers are in
  the spec's *Defect 4* and are reproducible: a fixed centre line reaches 10 of
  14 days and jumps `0→3` and `10→13`.

## How to work

Use the `superpowers:subagent-driven-development` skill to execute the plan
task-by-task. Commit after each task, as the plan specifies.

Report honestly. If a step fails, say so with the output. If you skip something,
say which and why. Finish the whole plan — if part of it turns out blocked,
complete everything else and state plainly what you left out.

When all six tasks are done, walk the plan's *Definition of done* and confirm
each line by observation rather than inference — especially "all 14 days of the
fixture are reachable by scrolling", which is invisible unless specifically
looked for.
