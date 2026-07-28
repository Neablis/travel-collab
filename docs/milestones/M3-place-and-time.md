# M3 — Place & time

**Goal:** turn the board's ordinal days into real calendar dates and add the
first three "place & time" lenses over the same projection — **map**
(MapLibre), **timeline**, **calendar** — plus **date-anchored activities**
whose constraints become soft conflicts when the trip's dates move ("drag the
vacation"). First milestone to build breadth on the M2 substrate: every new
behavior flows through the one command pipeline and is undo/revert-correct via
the existing compensating-events machinery (ADR-005).

Design record: `docs/specs/2026-07-09-M3-place-and-time-design.md` ·
Mechanism decisions: `docs/architecture/ADR-006` (conflict evaluation context),
`docs/architecture/ADR-007` (maps & geocoding commodity) ·
Plan: `docs/plans/2026-07-09-M3-place-and-time.md` (archived)


> **Later decision (2026-07-28):** the **anchor UI shipped by this milestone is
> retired in M8**, with the contract, conflict rules, and tests kept dormant
> (`docs/known-issues.md`, D-1). This gate passed on rules that fire correctly;
> it never established that a user could see or use them, and `publicHoliday`
> shipped as a control backed by a permissive stub that could never conflict.
> The gate below is left as it was written.


## Scope

- **Dates become real (no new events).** `SetTripStartDate` /
  `TripStartDateSet` already exist; M3 makes the domain *read* them.
  `deriveDayDates(startDate, dayCount)` pins day 1 to `startDate` and derives
  each day's date as `startDate + ordinal`. The projection exposes
  `TripDetail.days[].date`. Clearing the date returns days to ordinals and
  makes anchors dormant. "Drag the vacation" = one `SetTripStartDate`; all days
  re-derive and the conflict engine re-runs.
- **Anchors.** Activities gain `anchors: Anchor[]` — a 4-kind discriminated
  union (`dayOfWeek`, `dateRange`, `timeOfDay`, `publicHoliday`). The first
  three evaluate live to `warn` conflicts; `publicHoliday` ships in the shape
  but is **inert** in M3 (a permissive stub). Anchors ride on the existing
  activity commands/events, so they are undo/revert-correct for free.
- **Conflict evaluation context (ADR-006).** `detectConflicts(state, ctx)`
  gains an injected `ctx` = { holiday oracle, timezone } so the pure engine
  evaluates external/temporal facts without I/O. M3 injects a permissive
  holiday stub and a hard-coded `America/Los_Angeles`, both plumbed to reserve
  the seam.
- **Three lenses** over the same `TripDetail`: **map** (MapLibre GL JS +
  OpenFreeMap tiles), **timeline**, **calendar** (with the start-date shift
  control). Built against contract-derived MSW mocks first, then wired.
- **Geocoding (ADR-007).** A server-internal `Geocoder` port + `LocationIQ`
  adapter + `GET /api/geocode`; the activity location input resolves a place
  name to coordinates before the normal command is issued. The domain never
  geocodes.

## Design decisions recorded at planning (2026-07-09)

| Decision | Rationale |
|---|---|
| Day↔date derived-not-stored; rigid day-1 pin; cleared → dormant | No new events (reuses `TripStartDateSet`); undo/revert of a shift is free; noted reversible |
| Anchors as a 4-kind union; `publicHoliday` inert via a permissive stub | The shape is cheap and forward-useful; live holiday eval drags in a dataset + boundary before it's needed |
| Conflict engine gains an injected `ctx` (ADR-006) | Keeps the pure core pure — the "time is passed in" precedent; a one-line swap wires real holiday data later |
| Anchors ride on the existing activity events | `ActivityUpdated` is already a full-field snapshot `diffTripStates` emits — anchors become diffable/undoable with no new event type |
| Derived per-day date exposed on `TripDetail`, not recomputed in the UI | Keeps derivation server-side; the three lenses stay dumb readers |
| Geocoding = server-internal `Geocoder` port + pre-command enrichment (ADR-007) | Domain purity intact; vendor swappable behind the port; store normalized results only |
| Vendors: OpenFreeMap tiles + LocationIQ geocoding | Free tier, keyless tiles, geocoding terms permit storing results (MapTiler/Mapbox forbid persistence) |
| Geography rule stays crude; geocoding resolve-on-submit | Travel-time needs routing + the deferred cross-zone work; autocomplete is polish |

## Exit gate — all must be true

- [ ] **Demo on the deployed Vercel URL:** set a start date → days acquire
      calendar dates across all three lenses; add an activity whose typed place
      name geocodes to a map pin; add a `dayOfWeek` / `dateRange` / `timeOfDay`
      anchor; **drag the vacation** (shift the start date) → a now-violated
      anchor raises a `warn` conflict; shift back → it clears; clear the date →
      anchors go dormant; **undo** the shift → dates *and* conflicts revert.
      (Pending: requires `LOCATIONIQ_API_KEY` + Vercel env wiring — human step,
      see retro.)
- [x] **Property tests (fast-check) green:** `deriveDayDates` shift-`+N`-then-`−N`
      is identity on derived dates (length preserved); anchor evaluation for the
      three live kinds; `diffTripStates` round-trip still holds with anchors
      present (undo/revert reproduces state exactly).
- [x] **Golden rebuild:** dropping projections and rebuilding from a log with
      start-date shifts and anchored activities reproduces identical state —
      conflicts included.
- [x] **Purity/lint wall green:** `detectConflicts(state, ctx)` and
      `deriveDayDates` do no I/O and read no wall clock; geocoding lives only in
      `apps/web/src/server`; UI imports only `@tc/contracts` + the typed client
      (never `@tc/domain`); MapLibre/geocode fetches only from client
      components or server routes as designed.
- [x] **All M0/M1/M2 e2e scripts still green; a new M3 happy-path e2e script
      added and green.**
- [x] `docs/contracts/CHANGELOG.md` has an entry for the `Anchor` union +
      `activities[].anchors`, `TripDetail.days[].date`, and `Location.countryCode`.
- [x] Retro note appended to this file.

## Explicitly out of scope

`publicHoliday` live evaluation (inert stub; `date-holidays` wired later);
per-activity IANA timezones and cross-zone / travel-time math (the M1 geography
distance heuristic stays); arbitrary-day pinning / end-date-driven date ranges;
geocoding autocomplete/typeahead; external calendar sync (M11); costs (M4);
realtime (M8); trip rename/delete; styling beyond functional defaults.

## Retro (2026-07-10)

Implemented via subagent-driven development: Task 1 (contracts) landed first
and gated three parallel workstreams (Domain D1-D3, Server-geocoding S1, UI
U1-U5), then four integration tasks (I1-I4) ran sequentially. All 14 plan
tasks completed with a clean task-scoped review; the full local gate
(typecheck, lint, 119 unit tests, 16 integration tests, 4 e2e specs) is green.

**What we learned:**
- Parallel subagents sharing one working tree can race on `git add`/`git
  commit` even when their file sets are fully disjoint — the race is on git's
  index/refs, not the files themselves. One early parallel dispatch (D1, S1,
  U1 sharing this worktree) hit exactly this: a `git reset --soft` performed
  by one agent to fix its own accidental over-broad commit silently dropped
  a sibling agent's already-committed work from the branch tip (the changes
  survived in the working tree, uncommitted, and were recovered). From D2
  onward, every parallel implementer ran in its own isolated `git worktree`
  and merged back sequentially — no further incidents.
- The "red window" the plan called out between Task 1 and Task D2 was real
  and, once found, wider than the plan anticipated: a `pnpm typecheck`-invisible
  runtime assertion in `commands.int.test.ts` (an integration test requiring a
  live Postgres) also needed the same mechanical `date: null` fix D2 applied
  to typecheck-visible literals elsewhere. Integration tests don't run in a
  typecheck pass, so this only surfaced when the local gate's integration
  suite ran directly, ahead of Task I1.
- LocationIQ's port and geocode-stubbing conventions didn't exist yet in the
  e2e harness (`apps/web/e2e/helpers.ts`) — Task I3 introduced the first
  `page.route` interception pattern in this codebase. Future geocoding-touching
  e2e specs should reuse it rather than re-deriving it.

**Changed from the plan:**
- Nothing structural. Two small deviations, both disclosed and reviewed
  clean: `packages/domain/src/trip/detail.ts` needed `anchors: a.anchors`
  added to `tripDetailFromState`'s activity mapping (Task D2 — the brief's
  file list omitted this one-line consequence of `ActivityView.anchors` being
  required, not optional); Task I3's undo-sequencing in the e2e script waits
  for each `Undo`'s POST response before firing the next click, which
  surfaced a genuine (if minor) product gap noted below.

**Debt parked for M4:**
- `UndoRedoControls` has no in-flight guard — nothing disables Undo/Redo
  while a prior undo/redo request is still in flight, so rapid double-clicks
  can race two commands against the same `expectedSeq`. Currently masked by
  UI latency in practice; the M3 e2e script had to add an explicit wait to
  avoid hitting it.
- Two near-duplicate "start date" controls now exist (`TripBoardScreen`'s own
  `StartDateControl` and `CalendarLens`'s `TripDateControl`) with slightly
  different copy ("Clear" vs "Clear dates"). Both are mutually exclusive by
  mount (only one lens renders at a time) so there's no functional bug, but
  it's worth consolidating into one component before M4 adds more lenses.
- `LOCATIONIQ_API_KEY` + Vercel env wiring (plan Step I4.2) and the deployed-URL
  gate demo (plan Step I4.5) are deliberately left for Mitchell — no Vercel
  credential access from this session, per the run's human-in-the-loop
  instructions.
