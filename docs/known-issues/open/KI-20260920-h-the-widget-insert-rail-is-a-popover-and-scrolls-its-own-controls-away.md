### KI-2026-09-20-h — the Widgets insert rail is a popover, and until now it scrolled its own search and filters out of sight

- **Severity:** the scroll half was a usability defect and is fixed (below). What
  remains is a structural gap between the build's insert surface and the
  design's, plus the row treatment — cosmetic, but it is the panel a person
  looks at every time they add anything to a page.
- **Area:** `apps/web/src/components/pages/WidgetInsert.tsx` (the desktop
  Popover), `apps/web/src/components/pages/WidgetPicker.tsx` (the header and the
  rows). Design: `.design-sync/handoff/design/Trip Planner Redesign.dc.html:3956-4000`;
  SPEC §19 and §26.

- **How it was found:** Mitchell, 2026-09-20, pointing at a screenshot of the
  design's rail: *"Are we talking about same thing? Its this container i want
  styled."* It was not — `KI-2026-09-20-g` had been filed against the widget
  *block* card instead. **"The widget container" means this panel.**

- **What the design draws** (`:3956`): a **320px sticky column**, `top: 22px`,
  `max-height: calc(100vh - 120px)`, `background: var(--color-surface)`,
  `border: 1px solid var(--color-hairline)`, `border-radius: 12px`,
  `overflow: hidden` — a flex column of two parts:

  - a **header**, `flex: 0 0 auto`, `padding: 14px 14px 12px`, `border-bottom: 1px
    solid var(--color-hairline)`: the title "Widgets", the search, a **4-up icon
    radiogroup** (All / Inline / Block / List, each an 26×18px glyph over a
    10.5px label), and a **count line** — `{n} widgets · click to drop one at
    the cursor, or drag it in.`
  - a **body**, `flex: 1; min-height: 0; overflow-y: auto`, `padding: 12px`,
    `gap: 8px`: one **bordered card** per widget — `border-radius: 10px;
    padding: 10px 11px`, hover `border-color: var(--color-brand); background:
    var(--color-paper)` — carrying a `∷` drag handle, the title, a mono
    `--color-moss` shape chip, a mono `--color-brand-pressed` "takes" line, and
    the preview sentence.

- **Fixed 2026-09-20 — the header is a header.** The build had the whole panel
  under one `max-h-96 overflow-y-auto`, so **the search field and the four
  filter chips scrolled away with the list**: narrowing a list you were already
  reading meant scrolling back up to the control that narrows it. The picker is
  now the design's two-part column — a `shrink-0` header with a hairline under
  it, and the list as the only scrolling region — and the popover is a bounded
  `flex max-h-96 flex-col overflow-hidden` instead of the scroller.

  It also **gained the design's count line**, which the build had nowhere: the
  desktop carried a fixed hint with no count and the phone sheet carried
  nothing. Held by a red-first test in `WidgetPicker.test.tsx` that asserts the
  line against `rows().length` and re-asserts it after a search — seen failing
  by making the count read the whole catalogue instead of the filtered list
  (`2 widgets` expected, `22 widgets` rendered).

  **The design's sentence ends "It lands not set up." and that clause was
  deliberately dropped.** ADR-039 decision 2 makes an unbound widget show
  everything — the widest true answer — which is the same correction
  `takesLine` already carries ("ready as soon as it lands"). The design predates
  that decision; importing its words would reintroduce a lie the build fixed
  once already.

- **BUILT 2026-09-20 — the rail is a rail.** Mitchell settled the decision that
  used to be item 1 here, and settled it for §26:

  > The rail should be open in edit mode, and the preview shrinks — that's not
  > breaking the rule of "what you see is what you get" in the preview, it's
  > just shrinking the container a little bit and having it render in a smaller
  > container.

  Which is §26's own sentence: *"The column is not reserved while reading: the
  page runs full width until edit mode opens it."* The popover was solving a
  problem §26 solves better — it held the measure still by hiding the list
  behind a click, and paid for it by making the widgets a thing you open rather
  than a thing you have. **The 2026-09-04 popover instruction is superseded and
  should not be restored from `WidgetInsert.tsx`'s git history.**

  What landed:

  - **`WidgetInsert`'s desktop branch is the rail's content.** No trigger, no
    popover, no `open` state; `PageScreen`'s existing
    `aside.sticky.top-29.w-80` already had §26's two states and now fills the
    rail one with the catalogue instead of a button. No `autoFocus` — the rail
    opens with Edit mode, and taking the caret out of the document then is the
    opposite of what the author asked for. The phone keeps its sheet and its
    trigger (§19).
  - **`.tc-widget-rail`** (`globals.css`) bounds the column at
    `calc(100vh - 120px)` with `min-height: 0`, so the LIST scrolls and the page
    does not. Only the rail state gets it; `WidgetSettings` is a short form and
    should size to its content.
  - **The four-up icon kind control**, `role="radiogroup"` over four
    `role="radio"` buttons, replacing four wrapping pills. Labels are the
    design's short ones (All / Inline / Block / List) and the plain-English
    sentence Mitchell asked for on 2026-09-04 moved into each one's `title`
    ("A value that sits inside your sentence"). The glyphs are inline geometry
    with token classes for every fill — the split `MacroView` already makes.
  - **The rows are cards**: `∷` handle, title, a mono `--color-moss` shape chip
    reading `inline` / `a block` / `a list`, a mono `--color-brand-pressed`
    "takes" line, and the preview sentence.
  - **The header is pinned** and carries the design's count line.
  - **The filter survives the column's own state swap.** §26 unmounts the
    picker when a widget is selected, so a filter owned inside it came back as
    All after every insert — working through one kind meant re-picking that
    kind each time (Mitchell, 2026-09-20: *"make sure it remembers the last tab
    in the widget filter was open when you are actively editing"*). The query
    and kind are now a `WidgetFilter` held by `PageScreen`, which spans both
    column states. The picker is controlled only when both props are supplied;
    the phone sheet passes neither and keeps its own, which is right there — a
    sheet is dismissed rather than swapped, and one reopened from scratch should
    look it.

- **THE BROWSER WALK FOUND ONE REAL DEFECT, AND IT IS FIXED** (2026-09-20,
  walked on the PR #198 preview at 1280x900). Worth recording in full because
  of where it came from: the selected kind cell paints `bg-brand-tint`, and the
  glyph's faded cells painted `bg-brand-tint` too — same token, so the muted
  half of each picture vanished into the ground behind it. Measured computed
  values: ground `#e9e7dd`, fade cells `#e9e7dd`. **Selected, Inline showed one
  pill and List showed a vertical `⋮` that reads as a kebab menu.** Both were
  legible unselected, and illegible in the one state they exist to confirm.

  **The design has the same collision.** `Trip Planner Redesign.dc.html:9665-9667`
  sets the glyph's `fade` and the button's `bg` to `var(--color-brand-tint)`
  together, so its own gallery renders it this way; this was a faithful
  transcription, not a slip. The build deviates on purpose:
  `--color-border-strong` is the neutral that reads against a tint ground in
  every theme, and is the step up from `--color-hairline` the unselected state
  already implies.

  **Held by a test that is not a class assertion.** The rule is now a pure
  function, `glyphCellFill`, asserted against `KIND_CELL_ON_GROUND` — so the
  invariant ("a selected cell's ground and its faded cells are never the same
  token") lives somewhere the test-quality wall permits. Seen red by restoring
  the shipped value: `expected 'bg-brand-tint' not to be 'bg-brand-tint'`.

  **The general lesson, which is the reason this paragraph is long:** every
  other layer passed. Unit tests, lint, typecheck, both walls, the e2e walk and
  CI were all green while two of four icons were unreadable. A paint is only
  visible in a browser, and `toHaveClass` is banned outside
  `src/components/ui` — so on this surface, **a walk is not a formality, it is
  the only instrument.**

- **What is left, and all of it is cosmetic:**

  1. **The "takes" line uses this repo's input labels, not the design's.** The
     design carries a second vocabulary keyed by input TYPE (`a stretch of
     days`, `someone on the trip`); `filters.ts`'s `LABEL_OF` is where this repo
     says what a dimension is called and is what every bind control already
     shows. So a row reads `takes day + tags` where the design reads `takes a
     day + tags`. **Two maps would be two surfaces disagreeing about one
     dimension, which is what `LABEL_OF`'s own comment exists to prevent** — so
     the fix, if one is wanted, is richer labels in `LABEL_OF`, never a map in
     the component.
  2. **`cost` declares six filter dimensions**, so its line reads `takes day +
     city + tags + kind + who + dates` and wraps in a 320px column. Pre-existing
     (the old `narrow it by:` line had the same problem) but more visible now
     that the line has a colour. A cap with `+N more` is the obvious fix and is
     a product call about what a person scans for.
  3. **The shape chip is a `Badge`, so it is a pill**; the design draws a 4px
     rounded rect. `design-system.md` says render through the primitives, so
     this stays until somebody decides the primitive is wrong.
  4. **The panel's radius is the Card's**, and the 8px-vs-10px question is
     `KI-2026-09-20-g`'s item 2 — same scale gap, same answer needed once.
  5. **The count line wraps with an orphan.** `21 widgets · click to drop one at
     the cursor, or drag it in.` breaks in the 320px column leaving `in.` alone
     on line 2. The copy is the design's; shortening it is a wording call.
  6. **`ItineraryDayBlock`'s caption padding is `px-3` (12px) where
     `NotebookBlock.dc.html:19` says 13px.** One pixel, and 13 is not on the
     spacing scale.
  7. **The takes-line may not be distinct enough.** It is
     `--color-brand-pressed`, which under the default `ledger` look computes to
     `#1a2720` — a near-black dark green that at 11px reads as ink rather than
     as a highlighted line. The design intends it to stand out. A product call.

- **What the walk did NOT cover**, so nobody reads it as broader than it was:
  the phone surface (only 1280px and 1100px were walked), drag-and-drop
  insertion (rows were clicked, never dragged), the search box and its empty
  state, reload persistence after an insert, and **filter persistence across the
  rail↔settings swap** — that landed after the walked commit and has unit
  coverage only.

- **Do not read `KI-2026-09-20-g` as this entry.** That one is the widget *block*
  card — the box a rendered widget draws itself in on the page. Different
  container, different owner, also open.
