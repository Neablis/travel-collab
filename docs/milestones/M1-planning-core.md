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

- [x] Demo on the deployed Vercel URL: create a trip, add days, add activities
      (with times and a manual-coordinate location), drag between backlog and
      days, see an overlap conflict appear and clear, set a start date and see
      day columns re-label.
- [x] Golden test: dropping **both** projection tables (`trip_summaries`,
      `trip_details`) and rebuilding from the event log reproduces identical
      state, conflicts included.
- [x] Property-based tests (fast-check) green for both conflict rules.
- [x] Conflicts are data: an integration test proves a write that produces
      conflicts still succeeds (no blocking error path).
- [x] Every new write goes through the one command pipeline; projection writes
      exist only in `src/server/projections.ts`.
- [x] All M0 gates still green: M0 e2e smoke, lint wall, optimistic-concurrency
      test.
- [x] `docs/contracts/CHANGELOG.md` has entries for every M1 schema plus the
      M0 backfill entry.
- [x] Retro note appended to this file.

## Retro (2026-07-09)

Shipped the full board: days, backlog, activities (time window + manual-coordinate
location + notes), drag-to-plan via `pragmatic-drag-and-drop`, both soft-conflict
rules persisted through command-pipeline step 7, the `trip_details` projection
with a golden rebuild test, and one new Playwright script — all merged in
[#4](https://github.com/Neablis/travel-collab/pull/4) and demoed live on
production (`https://travel-collab-three.vercel.app`), including a
manual-coordinate geography conflict.

**What changed vs. the plan:**
- **`packages/domain/test/trip.test.ts` needed a type-narrowing guard.**
  `TripEvent` grew from a single schema into a discriminated union in Task 1;
  the pre-existing M0 test asserted on a bare `TripEvent` without narrowing on
  `.type`, which no longer typechecked once the union grew. Added an `if
  (!decision.ok) throw` / type guard rather than changing the test's intent.
- **Dependency version pins.** `@vitejs/plugin-react`'s latest major (6.x) is
  ESM-only and fails to load under this project's vitest 2 / vite 5 setup;
  pinned to `^4.7.0` instead. Also declined msw's postinstall build script in
  `pnpm-workspace.yaml` (`allowBuilds.msw: false`) — only `msw/node` is used
  (no browser Service Worker needed), so there was nothing for it to build.
- **Executed in an isolated worktree/branch** (`m1-planning-core`), same
  pattern M0 used, via `superpowers:using-git-worktrees` +
  `superpowers:executing-plans`.
- **A merge from `main` (Vercel Web Analytics, #3) silently broke
  `pnpm-lock.yaml`** with no textual conflict markers —
  `ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY` on a peer-dep-resolved `next` entry.
  Fixed by regenerating via `pnpm install --no-frozen-lockfile` and
  reverifying the full suite + `next build` before re-pushing. Worth knowing:
  pnpm lockfile merges can be silently broken even when git reports a clean
  merge — always re-run `--frozen-lockfile` after merging `main` into a
  long-lived branch.
- **The M1 migration (`trip_details`) was never applied to Vercel/Neon**,
  causing 500s on the preview deployment until diagnosed via the Vercel CLI
  (runtime logs pinpointed `relation "trip_details" does not exist`) and
  fixed by hand. Full detail and the resulting M2 action items are in the
  "Ops follow-ups for M2" section below — this is the most important thing
  for M2 to read first.

**What held up:** the command pipeline, conflict-as-data invariant, projection
rebuild, and lint wall all worked exactly as designed for a second milestone
in a row — every deviation this milestone was tooling/environment friction
(dependency versions, lockfile merges, missing deploy automation), not the
architecture.

## Explicitly out of scope

Real date-range semantics (shift/shrink, re-derive — M3), geocoding (M3),
anchors (M3), calendar/timeline/map views (M3), costs (M4), history UI and
undo (M2), persistent conflict dismissal (needs a command — with M2 history
work), trip rename/delete, styling beyond functional defaults, realtime,
invitations.

## Ops follow-ups for M2 (found 2026-07-08 debugging the M1 preview deploy)

The M1 migration (`trip_details`) was never applied to Vercel/Neon — CI only
ran `db:migrate` against its own ephemeral Postgres service, and ADR-004's
"explicit CI/deploy step" was never actually wired up anywhere outside CI.
`POST /api/trips` 500'd on the preview deployment (`relation "trip_details"
does not exist`) until it was applied by hand via the Vercel CLI + a
manually-pasted Neon connection string. Mitchell's call: fix properly as part
of M2 planning rather than patch reactively mid-gate. Concretely, M2's plan
should include, early (infra tasks first, same pattern as M1's Task 0):

1. **Separate preview and production databases.** Vercel's `DATABASE_URL` is
   currently the *same value* for both the Production and Preview
   environments (not the Neon dev/branch database ADR-004 originally called
   for) — every preview deployment reads and writes production's live data,
   and any migration applied to unblock a preview lands on production too.
2. **Automate the production migration step.** No deploy hook or CI step
   runs `drizzle-kit migrate` against the real (Vercel/Neon) database on
   merge to `main` — it's still a manual, easy-to-forget action. Add a
   GitHub Actions step gated to `push: main`, after CI passes, using a
   `DATABASE_URL` secret. (Once dbs are split, consider also wiring a Vercel
   preview build-step migration against the isolated preview branch — safe
   only once previews are disposable.)
3. **DB reset/reseed helper tooling**, for testing against Preview/Neon
   without hand-written `psql`/CLI one-liners each time (this session reset
   `trip_details`/`trip_summaries`/`events` manually more than once). Treat
   as scaffolding — remove or fold into a proper seed/fixture story once the
   product nears release, per ADR-004's "DB resets are cheap" framing.
