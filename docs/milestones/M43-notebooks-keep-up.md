# M43 — A trip's notebooks keep up with their templates

**Status:** **Proposed 2026-10-06, placed after M42. Not scoped yet**: the decisions below are
recommendations and none has been answered. Minted from `docs/candidates.md` (see
`docs/milestones/README.md`, *2026-10-06 — proposed: M37 to M47*).

## Why this exists

Every open notebook entry dates from #170's preview (2026-09-13) or from reading the M29/M30
Overview (2026-09-27), and all of them concern the seeded notebooks.

- A trip gets its default notebooks once, lazily, so **a trip made before M30 never gets the new
  Overview or any seed added since**. Mitchell: *"we might want a way to reset a trips default
  notebooks back to there seed and add any new seeds that didnt exist when the trip was made."*
- **The Overview is identified by a string inside a JSON document** (`PageContext.kind`), and the
  delete refusal reads it in application code. *"let's make sure the overview notebook is special
  cased in db"*.
- **The `open` widget is a two-column table, and the design is not a table**. *"it looks nothing
  like the designs"*. Mitchell also asked for a type filter and a date filter on it.

Candidates absorbed (each deleted by this gate):
- *Reset a trip's default notebooks to their seed, and add any seed the trip is missing*
  (2026-09-27)
- *The Overview notebook's identity moves from `context.kind` into the database* (2026-09-13)
- *The seeded Overview is titled `Overview — <trip name>`* (2026-09-13)
- *`open` ("What needs you") is built as a two-column table and the design is not a table*
  (2026-09-13)
- *`open` takes filters: which kind of open item, and over which days* (2026-09-13)

## Decisions it needs (recommendations; none answered)

1. ***Add missing seeds* is automatic; *Reset to template* is a confirmed action.**
   *Recommended:* missing seeds are added the next time notebooks are listed (`onConflictDoNothing`
   on `pages_system_seed_unique`). Reset lives in each seeded notebook's menu, is owner-only, and
   is one edit session (ADR-036), so it can be undone.
2. **`pages.kind` is a column, and the context field leaves.** *Recommended:* a column with a
   partial unique index on `(trip_id) WHERE kind = 'overview'`. The guard becomes a predicate, and
   `PageContext.kind` is retired in the contracts changelog. Keeping it as a mirror would mean two
   sources of truth.
3. **The Overview's title is derived at read time**, as `Overview — <trip name>`, so a rename
   follows the trip. Existing rows keep their stored title as an override only if the user has
   renamed them.
4. **`open` gets its own row shape.** It stops being a `repeat`. ADR-037 decision 3 (no HTML
   crosses the seam) stands, so `act` is a declared navigation target the renderer turns into a
   link, not a control the widget emits. This is an ADR-037 amendment.
5. **The type filter offers the three row classes** (conflict, empty day, parked), not the six
   labels. `Conflict.kind` is an open string, so a closed six-value control would make any kind the
   domain adds later unreachable by the filter. The date filter is the existing `dates` dimension.

## Scope

- Seed back-fill and reset.
- The `pages.kind` migration and the contracts change.
- The derived Overview title.
- The `open` widget redesigned to `{ label, sub, right, tone, act }` with both filters, in the
  desktop panel and the phone sheet.

## Out of scope

- Public notebook templates (an SEO leftover, and a contract change of its own).

## Exit gate

- [ ] **Decisions 1–5 are answered and recorded here**, and the ADR-037 amendment is written.
- [ ] **A trip made before M30 gains the missing seeds on its next notebook list**, which an
      integration test against real Postgres shows with a trip seeded the old way.
- [ ] **Reset restores a seeded notebook's template and can be undone.**
- [ ] **Two Overviews on one trip is a constraint violation**, and an integration test sees the
      insert refused.
- [ ] **`open` renders the design's rows**, with a sentence label, a sub-line, an action and a
      tone, and it filters by class and by dates. Its tests were seen red against the table.
- [ ] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`.**
- [ ] **[walk]** An old production-shaped trip on the PR preview gains its seeds, and *What needs
      you* is walked against the design.
- [ ] A retro is appended at gate close.
