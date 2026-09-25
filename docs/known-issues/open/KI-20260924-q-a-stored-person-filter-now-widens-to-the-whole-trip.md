### KI-2026-09-24-q — a widget stored with a `person` filter now shows the whole-trip value, and says nothing

- **Severity:** correctness (a filter that stops filtering, silently) — narrow in practice: see *Reach*.
- **Milestone:** M14, carried rather than gating. Filed from the PR #222 self-review.
- **Area:** `packages/pages/src/insert.ts` (`isRetired`), `packages/pages/src/select.ts` (`narrow`), `packages/pages/src/macros/primitives/single.ts` (`COST_FILTERS`, `COUNT_FILTERS`), `packages/pages/src/macros/primitives/rows.ts` (`stop.rows`).
- **Symptom / What happens:** Mitchell retired `person` on 2026-09-24 (*"person is removed for now"*, M14 decision 5). `cost`, `count` and `stop.rows` no longer declare it, so their params schemas `.strip()` a stored `person` on read and `insert.ts` treats it as retired junk on write. A widget stored as `cost{person: …}` therefore renders the trip-wide cost where it used to render "needs a person field". `narrow`'s own docstring calls "ignore the filter and show everything" the worst of the three answers — and that is now what such a widget does, with no sign on the page or in its settings.
- **Reach:** only the assistant could have stored one. The chrome row, the phone bind sheet and the insert step never offered a `person` control (`bindableInputs` filtered it out, and since this entry the `WidgetInput` member is gone), so no hand-made widget carries it.
- **Why not fixed here:** the alternatives were a settings-panel line ("a filter this widget used is no longer supported") or refusing the stored value. The line only reaches someone who selects that one widget in Editing — Reading, where the wrong number is read, still shows nothing — and it is UI written for a dimension that is coming back. Refusing it is the pre-retirement behaviour, and it would have to be undone the day `person` returns. When M13 `add-stop-who` / M19 link 3 re-declares `person` on these widgets, `isRetired` stops matching and the stored values narrow again with no migration; this entry closes then.
- **Kept on purpose:** `narrow`'s `unbound("person")` branch, `UnboundNeeds`' `"person"` and `MacroView`'s `case "person"`. `WidgetFilterValues` is mapped from the contract's `FilterDimension`, which still has `person`, so the type system does not show that branch unreachable, and refusing is still the right answer for any caller that passes one.
- **First noted:** 2026-09-24, PR #222 self-review, finding 2.
- **Re-verified 2026-09-25 (overnight sweep):** still true. `person` is absent
  from `COST_FILTERS`/`COUNT_FILTERS` (`single.ts:29`, `:85`) and from every
  rows widget's filters (`rows.ts:44,100,154,302`); `isRetired` still clears it
  on write (`insert.ts:57-61`); the kept branches are still there
  (`select.ts:147` `unbound("person")`, `MacroView.tsx:213` `case "person"`),
  and `person` has not been re-declared on any widget.
