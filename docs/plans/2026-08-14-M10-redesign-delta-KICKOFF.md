# Kickoff — M10 Wave 2, Phases 3–9

Handoff brief for the agent executing the rest of M10's Wave 2. Written to be
readable with zero context from the session that produced it.

**You are not writing a plan. The plan exists and is detailed.** Your job is to
execute it, one phase file at a time, starting at Phase 3.

## Where everything lives

**Repo:** `https://github.com/Neablis/travel-collab`
**Branch:** `claude/next-milestone-planning-uodfu6` — based on `main`, and
currently **identical** to it (`5961029`). Nothing has been built on it yet.

```bash
git clone https://github.com/Neablis/travel-collab.git
cd travel-collab
git checkout claude/next-milestone-planning-uodfu6
pnpm install
```

Branch from `main`, not from PR #23's branch (`claude/m10-trip-planner-visual-7bbacf`) —
that one is merged and its diff against `main` is now empty.

All commands run from the **repo root** unless a task says otherwise.

### Documents

| What | Path |
| ---- | ---- |
| **The plan index** — global constraints, file map, phase order. **Read first.** | `docs/plans/2026-08-14-M10-redesign-delta.md` |
| **The phase files you execute** — 7 remaining, 18 tasks | `docs/plans/M10-delta/phase-{3..9}-*.md` |
| Where the project's work stands | `docs/STATUS.md` |
| The milestone, its Wave-2 exit gate, and the PR-split decision | `docs/milestones/M10-visual-craft.md` |
| The review that reopened the gate | `docs/design-feedback/2026-08-14-M10-redesign-external-review.md` |
| Repo operating manual — invariants, boundaries, definition of done | `AGENTS.md` |
| Known breakage — read KI-13 and KI-21 before you trust a red test run | `docs/known-issues.md` |

Read the index first, then **only** your current phase file. The index says
explicitly: do not read all phase files at once — each is self-contained.

## What you're doing

M10 is the "make it beautiful" pass. Its Wave-1 gate closed 2026-08-10, then
**reopened 2026-08-14** after an external design review found the design handoff
had advanced two generations since Wave 1 was built, and that Wave 1's own
assistant rail had shipped three blocking defects.

Wave 2 closes that delta in ten phases. **Phases 0, 1 and 2 are done and merged
to `main`** (PR #23, merged 2026-08-17 as a deliberate partial delta — it had
grown to 79 commits / 161 files). **Phases 3–9 are yours.**

| Phase | File | Tasks | Gate |
|---|---|---|---|
| 3 | `phase-3-rack.md` | 3 | Unscheduled rack ships |
| 4 | `phase-4-budget.md` | 2 | Cost and budget surfaced |
| 5 | `phase-5-overlaps.md` | 2 | Overlap warnings ship |
| 6 | `phase-6-growth.md` | 1 | Add-a-day and empty states ship |
| 7 | `phase-7-forms.md` | 2 | Add-stop and new-trip rebuilt |
| 8 | `phase-8-polish.md` | 7 | Accents, chips, badges, home, calendar |
| 9 | `phase-9-gate.md` | 1 | Full DoD, docs, plan removal |

**Dependencies.** Phase 3 first — Phases 6 and 7 both depend on it, so it
unblocks the most follow-on work. Phase 6 also depends on Phase 8's gap
threshold for one bullet (skip that bullet if 8 hasn't landed). Phases 4, 5 and
8 are independent of each other and of 3. Phase 9 is last.

### Start here: Phase 3 — the unscheduled rack

Replace the full-width Backlog strip above the day columns with the design's
sticky bottom "Unscheduled" drawer. Collapsed by default, present in all four
views, live count.

This is a **real feature on a real store**, not a shell. `trip.backlog` already
exists (`packages/contracts/src/detail.ts:35`) and
`MoveActivity(activityId, toDayId, position)` already moves both ways —
`toDayId: null` means the backlog. Only *provenance* ("Was on Day X", who parked
a stop) is unmodelled, and that goes behind one `<Preview id="rack-provenance">`.

| File | Task | Change |
| ---- | ---- | ------ |
| `apps/web/src/lib/time.ts` | 3.1 | **create** — `toMinutes`/`toTimeString`, moved verbatim from `TimelineLens.tsx:55-67` |
| `apps/web/src/components/trip/unscheduledRack.ts` + `.test.ts` | 3.1 | **create** — `fitIntoDay` |
| `apps/web/src/components/lenses/TimelineLens.tsx` | 3.1 | modify — import move only |
| `apps/web/src/components/trip/UnscheduledRack.tsx` + `.test.tsx` | 3.2, 3.3 | **create** — the drawer |
| `apps/web/src/components/board/TripBoardScreen.tsx` | 3.2, 3.3 | modify — mount the rack, wire `onAssign`/`onUnschedule` |
| `apps/web/src/lib/preview-registry.ts` | 3.2 | modify — register `rack-provenance` |
| `apps/web/src/app/globals.css` | 3.2 | modify — named classes for the rack |
| `apps/web/src/components/board/Board.tsx` | 3.3 | modify — rack drop branch; **delete** the Backlog `<Column>` at `114-127` |
| `apps/web/src/components/board/Column.tsx` | 3.3 | modify — remove the `isOver` drag highlight at `103` |
| `apps/web/src/components/board/board.test.tsx` | 3.3 | modify — **see trap #2 below before starting this** |

Every line reference in the phase file was checked against the tree on
2026-08-22 and is accurate.

## Things that will mislead you if you don't know them up front

**1. The phase files' `- [ ]` step markers are never ticked — not even for
finished phases.** `phase-0-blockers.md`, `phase-1-structure.md` and
`phase-2-map.md` look untouched. They are **done and merged**. Do not redo them.
Throughout Wave 2, verify phase completion **by looking at the code**, never by
the checkbox. `docs/STATUS.md`'s "In flight" section reconstructs what each
completed phase actually shipped, commit by commit — trust that over any
checkbox.

**2. Task 3.3 Step 1 tells you to reuse a drag-test mechanism that does not
exist.** The phase file says *"`board.test.tsx` already drives
pragmatic-drag-and-drop in tests — read how it simulates a drag before writing
`dropOnRack` / `startDrag` and reuse that mechanism. Do not invent a new one."*

That is **wrong**, verified 2026-08-22: `board.test.tsx` is 199 lines and
contains **zero** drag simulation. Its only `drop`-shaped references are CSS
assertions about a column's drop list. Repo-wide, the only drag simulation is
`dragCardTo` in `apps/web/e2e/helpers.ts` — **Playwright, against a real
browser**. There is no jsdom drag harness anywhere, almost certainly because
pragmatic-drag-and-drop depends on native HTML5 drag events that jsdom does not
meaningfully implement (`dragCardTo`'s own comments explain how delicate the
recognition window is even in real Chromium).

So the plan forbids inventing a mechanism, and the mechanism it points you at
isn't there. **This is exactly the case `AGENTS.md` covers: "Pause before a
plan-deviating design decision, not just after."** Stop and ask which way to go
— a jsdom harness, moving Task 3.3's coverage to Playwright, or something else.
Do not quietly build a drag harness and carry on.

**3. The design handoff bundle is not on disk.** The plan names
`~/Downloads/design_handoff_update/current/Trip Planner Redesign.dc.html`
(2,623 lines) as the source of truth. It does not exist in a fresh checkout or
container — I searched the filesystem. Phase 3 inlines every design value it
needs, so it is fully executable without the bundle; the same is claimed for
every task. **Phase 8 (polish) and Phase 9's before/after screenshots are the
likely places this bites.** The index's rule stands: *"If a task seems to
require a value it does not give you, stop and ask rather than inventing one."*

**4. A red unit run is probably not real — KI-13.** The `apps/web` jsdom suite
fails with a *different random subset* each run under resource pressure, with
generic `Test timed out in 5000ms` messages that look like genuine assertion
failures. Three independent causes are documented (cold install, an external
CPU-heavy process, parallel load). Before believing a failure: re-run the named
files alone, and check `ps aux` sorted by CPU for an external consumer.
`AGENTS.md`'s error-loop rule is explicit — **if a suite fails differently each
run, stop before a third attempt** and check for an environmental cause.

**5. Phase 3 is a drag feature, and the drag e2e is known-flaky — KI-21.**
`m1-board.spec.ts` and `m4-money-and-lenses.spec.ts` fail intermittently inside
`dragCardTo`, on a *different assertion each time*, confirmed unrelated to any
branch's code by two independent methods. You will likely hit this while
verifying Phase 3 and it will look like you broke drag-and-drop. Re-run once on
a quiet machine before treating it as a regression.

**6. Two files the index lists as "new" already exist.** `apps/web/src/lib/geo.ts`
(Phase 2) and `apps/web/src/lib/cost.ts` (Phase 1 Task 1.4) are already in the
tree. Of the index's shared-module moves, only **`lib/time.ts` is still
outstanding** — that is Phase 3 Task 3.1 Step 1. Read `cost.ts` before Phase 4;
it already encodes the trip-level-currency rule and the "never re-sum
`tripCostTotal`/`budgetRemaining`" decision.

**7. Arbitrary Tailwind values fail the build.** `scripts/check-color-wall.mjs`
rejects any line matching ``className={?["'`][^"'`]*\[`` — so `z-[60]`,
`w-[208px]` and `bg-[#fff]` are all build failures, and Phase 3 needs a 208px
card width. Use an inline `style` prop plus
`// eslint-disable-next-line no-restricted-syntax` with a comment saying why no
token fits (precedent: `TimelineLens.tsx:172`, `DayChips.tsx:120`), or a named
class in `globals.css` for anything needing a media query (precedent:
`.assistant-rail-scrim`, `.trip-board-content`). Tailwind's JIT cannot see
interpolated class names — any mapping must be a static `Record`.

**8. The `<Preview>` registry is enforced in both directions.**
`preview-registry.test.ts` fails the build if a `<Preview id>` has no registry
entry *or* if an entry is never used. Add the entry in the **same commit** as
the usage. The file uses double quotes and a `{ milestone, wiredUpBy }` shape;
the plan's snippet shows single quotes — match the file, not the snippet.

**9. No UI module may import `@tc/domain`** — CI enforces it via
`scripts/check-lint-wall.mjs`. If you need domain logic in the UI, either it is
already exposed on `TripDetail`, or you write a small local copy with a comment
explaining why (precedent: `lib/geo.ts`).

**10. The presentational-only rule.** No new `packages/` or `apps/web/src/server`
diff beyond Wave 1's already-approved `conflicts.ts` exception. If a task appears
to need one, **stop and ask**.

## Commands

```bash
pnpm typecheck                  # all packages
pnpm lint                       # eslint + lint wall + color wall
pnpm --filter web test          # unit (vitest.unit.config.ts)
pnpm --filter web test:int      # integration — needs real Postgres. Gate only, not per task.
pnpm --filter web test:e2e      # playwright
pnpm --filter web db:reseed     # seeds the fixture trip
```

A single unit file:

```bash
pnpm --filter web vitest run -c vitest.unit.config.ts src/components/trip/unscheduledRack.test.ts
```

Note `pnpm lint` **already runs** `check-color-wall.mjs`, so Phase 3's gate
command runs it twice. Harmless, not a mistake to fix.

**Baseline verified clean on this branch, 2026-08-22**, on a fresh
`pnpm install --frozen-lockfile`:

- `pnpm typecheck` — green, all 5 packages.
- `pnpm lint` — green; both lint walls pass, color wall clean (261 files
  scanned, 0 pending re-skin).
- `pnpm --filter web test` — **89 files / 501 tests, all passing**, 59.4s
  (`environment 86.4s`, normal range per KI-13 — the pathological runs that
  issue describes show 400–1400s).

So anything red after you start is yours, not inherited — but still read trap
#4 before believing it. `test:int` (needs Postgres) and `test:e2e` were **not**
run for this baseline.

## How to work

The plan index asks for `superpowers:subagent-driven-development` or
`superpowers:executing-plans`. Execute **one phase file at a time, in order**.

Per task: write the failing tests first (the phase files supply real test code —
use it), confirm they fail, implement, re-run, then `pnpm typecheck`,
`pnpm lint`, `pnpm --filter web test` green before the task counts as done.
**Commit at the end of every task**, Conventional Commits style — the phase
files give you the exact commit messages.

Report honestly. If a step fails, say so with the output. If you skip something,
say which and why. Finish the whole plan — if part of it turns out blocked,
complete everything else and state plainly what you left out.

Two `AGENTS.md` amendments adopted from the map-rail retro apply directly here,
and both are in play in Phase 3:

- **Recognize an error loop and stop, don't retry through it** (traps #4, #5).
- **Pause before a plan-deviating design decision, not just after** (trap #2).

## Definition of done for Wave 2

Phase 9 closes the gate. Its checklist lives in `docs/milestones/M10-visual-craft.md`
under "Wave 2 exit gate" — the load-bearing items:

- A **narrow-viewport Playwright project** (1100×800 alongside 1280×720) plus a
  spec that fails without Phase 0's fix. This is a gate *condition*, not a
  nice-to-have: it closes KI-19, the structural blindness that let Wave 1 pass
  11/11 while the trip page was inert below 1180px.
- Every surface in the handoff either built or behind a registered `<Preview>` —
  no third state.
- `dayAccents` gives Tokyo / Kyoto / Osaka three distinct families, and an
  unknown city renders an explicit neutral (KI-18).
- No new `packages/` or `src/server` diff beyond the approved exception.
- Full suite — typecheck, lint, unit, int, e2e — green against a **production
  build** (`pnpm build && pnpm start`), **twice**. Dev-mode Turbopack's
  cold-compile delay on first navigation is easy to mistake for a real failure.
- Retro appended to the milestone file; `TODO.md`, `README.md` and
  `docs/STATUS.md` flipped in the **same** gate-close commit; the phase plans
  deleted per `docs/plans/README.md`'s staging-area rule.

M9 does not start until that gate passes.
