### KI-2026-09-24-d — the page write check closes the door but not the room: pre-fix rows stay wrapped, and a stored bad widget now blocks autosave (`repeat` nodes going unchecked: fixed)

- **Severity:** correctness, residual. Nothing here is new damage — each item is
  what KI-2026-09-05-g's fix (2026-09-24) deliberately did not reach.
- **Milestone:** **M14, carried (assigned 2026-09-24, KI pass)** — the notebook
  write path is M14's surface. Not a gate box.
- **Area:** `apps/web/src/server/pageCommands.ts` (`executePageCommand`, the
  `missingGenesis` backfill), `apps/web/src/server/pages.ts`
  (`checkPageDocForWrite`), `packages/pages/src/writeCheck.ts`
  (`findWidgetError`), the `pages` table and its page events.
- **Symptom / What happens:**
  1. **Rows written before the fix may be wrapped.** Each of the three parses
     the old write path ran wrapped an unknown node once more, and the parsed
     form was stored — in the `pages` row and in the event log. Those rows and
     events are not repaired. A stored `{type:"unknown",raw:…}` round-trips as
     is and converges only when a client re-sends the original node.
  2. **A backfilled genesis event is serialized but not migrated**, so it keeps
     the old row's own `v`.
  3. ~~**`repeat` nodes are not checked.** They carry `attrs.name` and
     `attrs.params` like a widget, but `findWidgetError` (like the `walkForError`
     it was lifted from) judges only `type:"macro"`. Nothing writes a `repeat`
     yet.~~ **Fixed 2026-09-24 (M14 T13), with the first `repeat` writer.**
     `findWidgetError` judges a repeat's attrs through `insertRepeat` — the
     door the picker uses — so a name that is not a rows widget, a filter its
     widget does not take, or a table's `columns` is refused, and the template's
     widgets are walked like any others. Proof (`packages/pages/src/repeat.test.ts`,
     "findWidgetError inside a repeat"): with the repeat branch disabled, four
     cases fail with `TypeError: .toMatch() expects to receive a string, but got
     object` — the check returned `null`, i.e. passed the bad repeat.
  4. **A page that already holds a widget the server now refuses** (unknown
     name, bad params, a filter the widget does not take) gets a 400 on every
     autosave until the user removes that widget, which the editor shows as
     "not saved". Likewise during a rolling deploy, a newer client inserting a
     widget name the older server does not know is refused rather than stored
     wrapped. The UI inserts through `insertWidget`, which applies the same
     rules — **but the assistant's compose path did not** (review of PR #218,
     2026-09-24): its old `walkForError` ran only `def.params.safeParse`, which
     strips unknown keys, and `validateComposedPage` then stored the ORIGINAL
     params. So an assistant-composed page can hold a filter its widget does not
     select by (e.g. `city.rows {kind:"booked"}`), and every autosave of that
     page is now refused. Exposure is narrow while `ai-live` is off in
     production (the simulated model composes from fixed shapes), but nobody
     has counted; the scan in *Why not fixed* should count these rows first,
     and the fix may be to STRIP a filter a widget ignores on write rather than
     refuse the save.
- **2026-09-24 (M14 T14), what the pages rebuild does with items 1 and 2.** It
  does not make either worse. `rebuildProjections` replays page events through
  the one writer, which stores `serializePageDoc` output, so a node already stored
  wrapped comes back wrapped exactly once. The golden page case asserts this on a
  pre-fix row. A backfilled genesis now also REWRITES the row it describes with
  the event's document, so a row that had no `v` gains `v: 1` at backfill. Its
  timestamps are kept. Neither item is repaired: the one-off scan below is still
  owed. Item 4's "every autosave" is now "the edit session's one write". The
  refusal is the same, and it is met when the author leaves Editing.
- **Why not fixed here:** KI-2026-09-05-g's fix was scoped to the write path.
  (1) and (2) are a data repair (a one-off scan of `pages` + page events for
  `type:"unknown"` nesting and stale `v`, run through `ci.yml`'s production
  dispatch pattern like `backfill-countries-production`); (4) wants that same
  scan to count affected rows in production before anyone decides whether the
  editor needs a "this widget can no longer be saved" affordance; (3) was a
  two-line extension of `findWidgetError` best made alongside the first
  `repeat` writer, and was (M14 T13).
- **Cross-reference:** `resolved/KI-20260905-g-page-write-path-bypasses-the-ast-safety-rules.md`
  (the fix and its proof), ADR-037/038/039, KI-2026-09-22-c (read before
  touching page history).
- **First noted:** 2026-09-24, by the fixer of KI-2026-09-05-g.
- **Re-verified 2026-09-25 (overnight sweep):** items 1, 2 and 4 still hold.
  No repair scan exists — nothing under `apps/web/scripts/` or
  `.github/workflows/` touches `pages` (the precedent job is now its own
  workflow, `.github/workflows/backfill-countries-production.yml`, not a
  `ci.yml` job); the lazy genesis is still `missingGenesis`
  (`pageCommands.ts:112`); `findWidgetError` still refuses rather than strips a
  filter a widget ignores (`packages/pages/src/writeCheck.ts:33-43`, via
  `insertWidget`). Item 3's fix is present (`writeCheck.ts:51-58`,
  `repeat.test.ts:367`).
