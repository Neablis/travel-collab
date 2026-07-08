# Building the parts

How to build inside each boundary. The module map and invariants in `AGENTS.md`
govern; this is the practice.

## packages/contracts — the shared language

- Every cross-boundary type is a Zod schema here: commands, events, DTOs,
  `Conflict`. Types are always `z.infer<>` — never hand-written duplicates.
- Events are named past-tense (`TripCreated`, `ActivityMoved`); commands
  imperative (`CreateTrip`, `MoveActivity`). Every event schema has a
  `version` literal from day one.
- Changing anything here follows the protocol in `connecting-the-parts.md`.

## packages/domain — the pure core

- Two function shapes per aggregate, both pure:
  - `decide(state, command, context) → Event[] | Rejection` — validates and
    emits. `context` carries actor, now (time is ALWAYS passed in), and the
    `AccessPolicy` verdict. No I/O, no clock reads, no randomness (IDs are
    passed in or deterministic).
  - `evolve(state, event) → state` — folds an event into state. Total: must
    handle every event version (via upcasters) and never throw on replay.
- **Upcasters:** when an event schema changes, bump its `version`, keep the
  old schema, and write `upcast(vN) → vN+1`. Replay always upcasts to latest
  before `evolve`. Never mutate stored events.
- **Conflict engine:** pure functions `detect(planState) → Conflict[]`. Rules
  are individually testable, registered in a list, and know nothing about
  storage or UI. Add property-based tests (fast-check) for every rule: random
  plans in, invariants out (e.g. "overlap detection is symmetric").
- **Projection functions** live here too: `project(events) → readModel` —
  pure, so the golden rebuild test can run without a database.
- If a domain function wants I/O, the design is wrong — restructure so the
  server fetches and passes data in.

## apps/web/src/server — the imperative shell

- **The command pipeline** is one code path every write uses, in order:
  1. authenticate (Auth.js session → actor)
  2. authorize (`AccessPolicy.check(actor, command, tripId)`)
  3. load the stream, fold to current state (upcasting as needed)
  4. `decide(...)` → events or typed rejection
  5. append with optimistic concurrency (expected seq; unique-violation →
     typed `ConcurrencyConflict` result, not an exception leak)
  6. update projections in the same transaction
  7. run the conflict engine on the new state; persist the Conflict set
  8. respond with the contract-typed result
  No endpoint may shortcut a step. New write = new command through this pipe.
- **CRUD modules** (Identity, Access & Membership, later Community metadata):
  ordinary Drizzle tables with `created_at/updated_at/updated_by` audit
  columns. Keep them in separate folders per module; no cross-module imports —
  reference by ID.
- **AccessPolicy** is an interface in one place. Phase 1 ships exactly one
  implementation: `actorIsSoleMember`. Do not add roles early.
- Migrations via drizzle-kit, committed with the change that needs them.

## apps/web (UI)

- UI code imports `@tc/contracts` and the typed API client — never
  `@tc/domain`, never `src/server` internals (lint-enforced, CI-verified).
- Build features against MSW mocks derived from contract schemas first; wire
  to the real server after. This keeps UI work unblocked and contract-honest.
- Conflicts render as dismissible, resolvable surfaces (banner/badge with
  suggested resolutions) — never blocking modals (Invariant 3).
- Views are projections' consumers: board, calendar, timeline, lenses are all
  different renderings of the same read models. If a view needs data no
  projection has, that's a projection change (server work), not a client-side
  join cascade.

## Adding a feature end-to-end (the golden path)

1. Read `TODO.md` → current milestone file; confirm the feature is in scope.
2. Contracts: add/extend command + event + DTO schemas; changelog entry.
3. Domain: `decide`/`evolve` + unit tests; conflict rules if relevant.
4. Server: wire through the command pipeline; integration test with real
   Postgres; projection update + rebuild test still green.
5. UI: MSW mock → component → wire to real endpoint; extend milestone e2e.
6. Run the full check suite; update docs if interfaces or behavior changed.
