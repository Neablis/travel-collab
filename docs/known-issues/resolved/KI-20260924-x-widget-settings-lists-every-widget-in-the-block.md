### KI-2026-09-24-x — the settings panel lists every widget in the selected widget's block, numbered, instead of only the one selected — RESOLVED

- **Severity:** cosmetic / UX (confusing, not wrong). A fast follow to PR #221, filed at Mitchell's request.
- **Milestone:** M14, carried rather than gating.
- **Area:** `apps/web/src/components/pages/editor/WidgetSettings.tsx` (`numbered`, one entry per `block.entries`), `apps/web/src/components/pages/editor/blockWidgets.ts` (`selectedBlock`), `apps/web/src/components/pages/editor/widgetMarkPlugin.ts` (the 1, 2, 3 marks on inline widgets).
- **Symptom / What happens:**
  - Select one inline widget in a sentence that holds several ("We land on Day 1 in Tokyo and by Day 9 we are in Kyoto").
  - The side panel shows settings for EVERY widget in that paragraph, numbered 1, 2, 3…, and the widgets in the text carry matching number marks.
  - To change the one you clicked, you have to match its number to the right entry in the panel.
- **Wanted (Mitchell, 2026-09-24 on PR #221):** *"Just have 1 selected at a time."* The panel shows only the selected widget's settings, and the number marks go.
- **Why not fixed here:** #221 is the last part of a large stack; this is a panel redesign across the desktop column and the phone bind sheet (both mount `WidgetSettings`), so it follows as its own change.
- **Kept on purpose:** each widget in a sentence is still bound independently (ADR-037 open question 1 as Mitchell settled it: day 1, day 3 and day 9 in one notebook). Showing one at a time changes the panel, not that rule.
- **First noted:** 2026-09-24, Mitchell's review of PR #221.
- **Resolved:** 2026-09-25, overnight KI sweep. The editor already knew which
  inline widget was selected: clicking or inserting one leaves a ProseMirror
  `NodeSelection` on its `macro` atom. `selectedBlock` read that selection and
  then widened it to every widget in the parent textblock, and the panel
  rendered one numbered entry per widget. `selectedBlock`,
  `widgetsInBlockAt` and `widgetMarks` are replaced by
  `selectedWidget(state)`, which returns the one selected widget (`pos`,
  `name`, `params`). `WidgetSettings` renders one entry for it, labelled by its
  title alone. Both the desktop column and the phone bind sheet mount that
  component, so both changed. `widgetMarkPlugin.ts` is deleted: a grep found
  no reader other than `MacroNodeView`'s handle number, which is removed too.
  Every write still addresses one position (`rebindWidget`,
  `rescopeWidgetAt`, `removeWidget`), so ADR-037's rule that each widget is
  bound on its own stands.

  **Reproduction, before and after.** The new `WidgetSettings.test.tsx` cases
  (`one widget at a time`) were run against the unfixed code, selecting the
  second of the two `city` widgets in the gate sentence:
  `AssertionError: expected [ '1 · The cities', '2 · The cities' ] to deeply
  equal [ 'The cities' ]` (4 failed). After the fix they pass. Each was also
  seen red for its own reason: an aggregate `rebindWidget` that writes every
  widget in the block → `expected [ {}, {}, {} ] to deeply equal [ {}, {
  dates: … }, {} ]` (both `rebinds the … widget of the sentence on its own`
  cases); `removeWidget` moving the selection to a sibling again →
  `expected <div …(2)>…(3)</div> to be null` (panel still up) and, in
  `blockWidgets.test.ts`, `expected { pos: 45, name: 'city', …(1) } to be
  null`. The e2e walk *"two widgets in ONE sentence read two different days,
  and each rebinds on its own"* asserted `1 · The cities` / `▸1`. It now
  asserts one entry and a bare `▸`, binds the selected second widget to Day
  9, clicks the first widget, and binds it to Day 1.

  **Checks run** (narrow subset; `apps/web` only, no contracts file touched):
  `pnpm --filter web typecheck` clean; `eslint --max-warnings 0` on the seven
  touched source/spec files clean; `vitest run -c vitest.unit.config.ts
  src/components/pages/` (30 files, 311 tests) green; `check-docstring-wall`,
  `check-lint-wall` and `surface-size --check` OK;
  `pnpm --filter web test:e2e:ci-like e2e/m14-notebook-widgets.spec.ts`
  29/29 passed, no retries. Pass the spec without `--`: with `--`, Playwright
  receives `playwright test -- <spec>` and runs the whole suite (177 tests),
  which is how the first attempt ran.
- **Decision (2026-09-25 overnight sweep):** taken on Mitchell's own words on
  #221 (*"Just have 1 selected at a time."*) although the entry is
  M14-carried. The panel shows the selected widget only, and the in-text
  numbers are gone. Removing the selected widget now lets the selection fall
  into the text, so the panel closes even when the sentence still holds
  another widget. The old behaviour moved the selection to the first
  sibling, which made sense for a list of the whole sentence. With one entry
  it would put a panel straight back up, often under the same title ("The
  cities" twice), and read as if Remove had not worked. Rejected: keeping the
  selection move (see above); keeping the block list but highlighting the
  selected entry (the owner asked for one, not a highlighted many); keeping
  the handle numbers for orientation (they cross-reference a list that no
  longer exists). `.design-sync/handoff/SPEC.md` §26 still describes the
  numbered entries. It is a design-sync build input, not prose, so it was
  left for the next design sync.
