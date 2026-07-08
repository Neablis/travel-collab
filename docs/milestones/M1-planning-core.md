# M1 — Planning core

**Goal:** turn the walking skeleton into an actual planning tool. A trip becomes
a board: a backlog of activity ideas plus day columns, with drag-to-plan and
the first soft-conflict rules surfacing problems as data, never as errors.
Everything flows through the same command pipeline M0 proved.

## Scope

- **Days**: added/removed explicitly; stable `dayId`s ordered within the trip,
  ordinal ("Day 1..N") derived from position. Removing a day returns its
  activities to the backlog.
- **Display-only start date** (decided 2026-07-08): an optional trip start
  date labels day columns with derived dates ("Day 3 — Oct 14"). The domain
  and conflict engine never read it; there is no shift/shrink behavior. Full
  date semantics (re-derive + anchor conflicts) stay in M3.
- **Activities**: title, optional time window (local `HH:mm`, no dates or
  zones yet), optional location (free-text name + optional manual lat/lng —
  decided 2026-07-08: no geocoding service until M3), free-text notes.
  Add / update / move (backlog ↔ day, with position) / remove.
- **Backlog**: activities without a day; planning = dragging them onto days.
- **Conflict engine** (pure, in `packages/domain`), first two rules:
  1. *time-window overlap* — two timed activities on the same day overlap;
  2. *impossible geography* — two located activities on the same day are
     further apart than the infeasibility threshold (haversine).
  Conflicts are persisted with the trip-detail projection, rendered as badges
  and a dismissible banner. Dismissal is client-local in M1 (no dismissal
  command yet). Both rules are property-tested (fast-check).
- **Command pipeline step 7** lands: after append + projection update, run the
  conflict engine on the new state and persist the conflict set in the same
  transaction (per `docs/guidelines/building-the-parts.md`).
- **Trip-detail projection**: `trip_details` table (one JSONB doc per trip:
  days, backlog, activities, members, conflicts), rebuildable from the log
  like every projection; the golden test covers it.
- **API**: `GET /api/trips/[tripId]` returns the `TripDetail` doc;
  `POST /api/trips/[tripId]/commands` accepts the `TripCommand` contract union
  and dispatches through the one pipeline.
- **UI**: `/trips/[tripId]` day-column board (backlog + day columns),
  drag via `pragmatic-drag-and-drop` (decided 2026-07-08), activity editor,
  conflict display. Built against contract-derived MSW mocks with component
  tests, then wired to the real API.
- **E2E**: one new Playwright script — create trip → add days → add activities
  → drag to a day → overlap conflict appears → move away → conflict clears.
  M0's smoke stays green untouched.

## Design decisions recorded at planning (2026-07-08)

| Decision | Rationale |
|---|---|
| Ordinals + display-only start date | Closes the dogfooding gap ("what date is Day 3?") for one command/event, while deferring all shrink/shift/re-derive machinery — and its immutable-event stakes — to M3 |
| Manual lat/lng, no geocoder | Free-tier safe, keeps the geography rule pure; a real geocoder arrives with the map in M3 |
| `pragmatic-drag-and-drop` | Mitchell's pick; battle-tested (Jira/Trello), framework-agnostic, native-DnD based |
| Stable `dayId` + derived ordinal | Events must never reference renumberable ordinals; removal would corrupt replay meaning |
| `ActivityUpdated` snapshots the full field set | Replay never merges patches; evolve stays trivially total |
| Single `/commands` endpoint | One route validated by the `TripCommand` union beats 7 hand-rolled routes drifting from contracts |

## Exit gate — all must be true

- [ ] Demo on the deployed Vercel URL: create a trip, add days, add activities
      (with times and a manual-coordinate location), drag between backlog and
      days, see an overlap conflict appear and clear, set a start date and see
      day columns re-label.
- [ ] Golden test: dropping **both** projection tables (`trip_summaries`,
      `trip_details`) and rebuilding from the event log reproduces identical
      state, conflicts included.
- [ ] Property-based tests (fast-check) green for both conflict rules.
- [ ] Conflicts are data: an integration test proves a write that produces
      conflicts still succeeds (no blocking error path).
- [ ] Every new write goes through the one command pipeline; projection writes
      exist only in `src/server/projections.ts`.
- [ ] All M0 gates still green: M0 e2e smoke, lint wall, optimistic-concurrency
      test.
- [ ] `docs/contracts/CHANGELOG.md` has entries for every M1 schema plus the
      M0 backfill entry.
- [ ] Retro note appended to this file.

## Explicitly out of scope

Real date-range semantics (shift/shrink, re-derive — M3), geocoding (M3),
anchors (M3), calendar/timeline/map views (M3), costs (M4), history UI and
undo (M2), persistent conflict dismissal (needs a command — with M2 history
work), trip rename/delete, styling beyond functional defaults, realtime,
invitations.
