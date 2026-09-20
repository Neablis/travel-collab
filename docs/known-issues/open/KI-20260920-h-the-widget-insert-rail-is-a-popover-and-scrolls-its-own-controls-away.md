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

- **What is left, and the first item is a decision, not a ticket:**

  1. **Popover or rail — SPEC §26 and the build disagree, and the build is
     acting on the older instruction.** It is a Radix Popover because Mitchell
     asked for one on 2026-09-04: *"The widgets should be more of a popover side
     bar so they dont interrupt the document flow when open."* **SPEC §26 is
     eight days later and supersedes it**: the right column *is* the rail, and
     it has two states — the rail when nothing is selected, the selected
     widget's settings when something is — with the measure changing once on
     entering edit mode, a tradeoff §26 says was chosen deliberately over an
     empty 320px gutter. `WidgetInsert.tsx`'s own header comment still states
     the popover as a requirement. **Somebody has to say which stands**; until
     then the panel's outer geometry cannot be finished, because the two answers
     want different boxes. Everything below is true either way.
  2. **The rows are `Button variant="secondary"`, not cards.** The design's row
     is a bordered card with a `∷` handle, a mono moss shape chip and a mono
     brand-pressed "takes" line; the build stacks secondary buttons at `gap-1`.
     A button reads as a control, and twenty-two of them read as a toolbar.
     **This is the most visible item left** and is the one to do next.
  3. **The kind filter is four pill buttons, not the design's 4-up icon
     radiogroup**, and its labels differ on purpose — "In a sentence / A section
     / A line each" against the design's "Inline / Block / List". **Keep the
     build's words.** Mitchell, 2026-09-04: *"thats not how people think of
     these widgets, they should have better names so people understand when they
     are used."* The icons are worth taking; the vocabulary is not.
  4. **The panel is not sticky and has no `max-height: calc(100vh - 120px)`** —
     both fall out of item 1.

- **Do not read `KI-2026-09-20-g` as this entry.** That one is the widget *block*
  card — the box a rendered widget draws itself in on the page. Different
  container, different owner, also open.
