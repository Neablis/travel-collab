# M43 — A trip's notebooks keep up with their templates

**Status:** **Scoped 2026-10-31 with Mitchell**: decisions 2 to 5 are answered below, each as
recommended; the ADR-037 amendment of that date records decision 4. Plan:
`docs/plans/2026-10-31-M43-notebooks-keep-up.md` (four parts). Proposed 2026-10-06; moved last
2026-10-12, after M49, by Mitchell (nothing it fixes is hurting today). Minted from `docs/candidates.md` (see
`docs/milestones/README.md`, *2026-10-06 — proposed: M37 to M47*).
**Shrunk 2026-10-17, by Mitchell, to what is not built.** Seed back-fill and reset were built
before this milestone was scoped (see *Already built* below), so they leave the scope and the gate.

## Already built (not this milestone's work)

The reset / add-missing PR of 2026-09-27 (ADR-036's two amendments of that date) shipped both
halves of Mitchell's *"reset a trips default notebooks back to there seed and add any new seeds"*:

- **Add missing default notebooks**: an owner-only button (`NotebookScreen.tsx`), the
  `pages/defaults` route and `addMissingDefaultPages` (`pageCommands.ts`). Seed identity is
  `pages.seed_key` with the partial unique index `pages_seed_key_unique` (migration `0032`).
- **Reset to default**, with Undo: `ResetToDefault.tsx` behind the notebook's menu, the
  `reset` and `restore` routes, `resetPageToDefault` (one `EditPage`, the page id kept).
- Covered by `defaultNotebooks.int.test.ts`, both routes' int tests, `ResetToDefault.test.tsx`
  and `e2e/notebook-reset.spec.ts`.

The back-fill is a button, not automatic on the next notebook list. **That is the decision**
(Mitchell, 2026-10-17: the UI way works): a read still appends no events (`pages.ts`).

## Why this exists

The open notebook entries date from #170's preview (2026-09-13):

- **The Overview is identified by a string inside a JSON document** (`PageContext.kind`), and the
  delete refusal reads it in application code. *"let's make sure the overview notebook is special
  cased in db"*. Today `seed_key = 'overview'` sits beside it, so there are two sources of truth,
  and a second Overview is refused only as a side effect of `pages_seed_key_unique`.
- **The `open` widget is a two-column table, and the design is not a table**. *"it looks nothing
  like the designs"*. Mitchell also asked for a type filter and a date filter on it.

Candidates absorbed (each deleted by this gate):
- *The Overview notebook's identity moves from `context.kind` into the database* (2026-09-13)
- *The seeded Overview is titled `Overview — <trip name>`* (2026-09-13)
- *`open` ("What needs you") is built as a two-column table and the design is not a table*
  (2026-09-13)
- *`open` takes filters: which kind of open item, and over which days* (2026-09-13)

## Decisions (answered 2026-10-31 by Mitchell, each as recommended)

1. ~~*Add missing seeds* is automatic; *Reset to template* is a confirmed action.~~ **Answered
   by what was built** (2026-10-17): add-missing is an owner's button, and reset is a confirmed,
   undoable action in the notebook's menu.
2. **`pages.kind` is a column, and the context field leaves.** (Or `seed_key = 'overview'` is the
   identity, and only `PageContext.kind` leaves: one fewer migration.) *Recommended:* a column with a
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

**Answers, 2026-10-31 (Mitchell):**

- **2: a `pages.kind` column.** Migration `0070` adds it, backfilled from `context->>'kind'`
  (one winner per trip, the way `0032` chose its `seed_key`), with a partial unique index on
  `(trip_id) WHERE kind = 'overview'`. `PageContext.kind` is retired in
  `docs/contracts/CHANGELOG.md`. The survey found a hole this closes: both page-create routes
  (`/api/trips/:id/pages`, `/api/v1/trips/:id/pages`) accept `context.kind = 'overview'` from an
  editor and would create a second, undeletable Overview. After part 1 a person can never set a
  page's kind; only seeding does.
- **3: derive when the stored title is a default.** At read time an Overview whose stored title
  is `Overview` (or a legacy seed title) is shown as `Overview — <trip name>`; any other stored
  title is the user's rename and is shown as stored. Reset writes `Overview` back, so it derives
  again. No migration and no flag: the event log cannot tell a reset from a rename.
- **4: follow the design.** `open` renders its own row shape `{ label, sub, right, tone, act }`
  where `act` is a declared `LinkTarget` the renderer turns into a link (ADR-037 amendment,
  2026-10-31). Parked ideas are **one** grouped row (`N ideas are parked`, the first two titles,
  *Place them*), as the design draws it, not a row per idea.
- **5: three classes, and `open` follows the notebook's date scope.** The class filter offers
  conflict, empty day and parked. The Days filter is the existing `dates` dimension; an explicit
  Days filter wins, otherwise the notebook's date scope applies (`followsDateScope`). Parked
  ideas carry no date, so only the class filter hides them.

## Scope

- The Overview's identity in the database, and the contracts change retiring `PageContext.kind`.
- The derived Overview title.
- The `open` widget redesigned to `{ label, sub, right, tone, act }` with both filters, in the
  desktop panel and the phone sheet.

## Out of scope

- Public notebook templates (an SEO leftover, and a contract change of its own).
- Seed back-fill and reset: built, above. Making the back-fill automatic: decided against.

## Exit gate

Amended 2026-10-17 (shrunk to the leftovers): the back-fill box and the reset box are removed,
since both were built before this milestone was scoped; the [walk] loses its seeds half.

- [ ] **Decisions 2–5 are answered and recorded here**, and the ADR-037 amendment is written.
- [ ] **Two Overviews on one trip is a constraint violation** whatever their `seed_key`, and an
      integration test sees the insert refused, and no application code reads `context.kind`.
- [ ] **`open` renders the design's rows**, with a sentence label, a sub-line, an action and a
      tone, and it filters by class and by dates. Its tests were seen red against the table.
- [ ] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`.**
- [ ] **[walk]** On the PR preview, *What needs you* is walked against the design, with both
      filters, and a renamed trip's Overview title follows it.
- [ ] A retro is appended at gate close.
