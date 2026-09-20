### KI-2026-09-20-g — the widget container is built four times over, and no two of them agree with each other or with the design

- **Severity:** cosmetic, and one of the four was visibly wrong (fixed — see
  *Already done* below). The remaining three are drift rather than defect: the
  boxes differ from the design and from each other in ways a person notices as
  "these two widgets look like different products" rather than as breakage.
- **Area:** `apps/web/src/components/pages/MacroView.tsx:259`,
  `apps/web/src/components/pages/blocks/ItineraryTripBlock.tsx:52`,
  `apps/web/src/components/pages/blocks/CityDetailBlock.tsx:28`,
  `apps/web/src/components/pages/blocks/ItineraryDayBlock.tsx:27`.

- **Symptom / What happens:** a widget that renders as a block sits in a
  bordered card, and there are **four hand-rolled copies of that card** in the
  build:

  | container | class string today |
  |---|---|
  | `MacroView.tsx:259` — the `rows` table (`cost.rows`, `day.rows`, `city.rows`, `stop.rows`) | `tc-widget-table my-1 overflow-hidden rounded-md border border-hairline bg-surface` |
  | `ItineraryTripBlock.tsx:52` | `block overflow-hidden rounded-md border border-hairline` — **no `bg-surface`** |
  | `CityDetailBlock.tsx:28` | `block overflow-hidden rounded-md border border-hairline` — **no `bg-surface`** |
  | `ItineraryDayBlock.tsx:27` | was `block rounded-md border border-hairline bg-surface p-3` — **fixed 2026-09-20** |

  The design states one container three separate times and says the same thing
  each time — `.design-sync/handoff/design/NotebookBlock.dc.html:17`, and the
  desktop Notebook's own itinerary and costs blocks at
  `.design-sync/handoff/design/Trip Planner Redesign.dc.html:3778` and `:3808`:

  > `border: 1px solid var(--color-hairline); border-radius: 10px; overflow: hidden;`
  > over `var(--color-surface)`

  with **no padding on the container** — every row carries its own `10–11px
  14px` and a full-bleed `border-bottom`. The phone Notebook (`:699`) is the
  same container at 12px.

- **How it was found:** Mitchell, 2026-09-20: *"we already did most of the
  design pass, but the Widget container restyling was missed."*

- **THIS IS NOT M14'S, AND THAT IS THE POINT OF FILING IT.**
  `docs/milestones/M26-design-parity.md`'s *Deliberately not here* parks the
  widget **framework** in M14 — the ghost rendering, the four states,
  `NotebookBlock`'s declared columns, the repeat's dashed rail,
  `WidgetSettings`' missing *Wording* / *Remove* — and that is still the right
  call. **The box those render inside is a separate thing, it already exists,
  and nothing in M26 or M14 owns it.** A reader who sees "widget" and "M14" in
  one sentence will park this too, which is how it got missed once already.

  `.design-sync/handoff/specs/notebook-widget-framework.md` says why it should
  be one box: *"A widget author picks a shape and supplies content. They never
  supply spacing, borders, ghost glyphs or empty-state copy."* Four copies is
  how three of them came to disagree.

- **Already done, 2026-09-20, and deliberately only this one.**
  `ItineraryDayBlock` was the one live container still built as a padded box:
  `p-3`, rows inset 12px, so its `border-b` separators were stubs that stopped
  short of both edges and its header was a line of text with a stub rule under
  it rather than the design's caption band. It is now `overflow-hidden` with
  full-bleed rows and a `bg-paper` header strip — identical furniture to its two
  siblings.

- **What is left, smallest first, none of it blocked:**

  1. **`bg-surface` on `ItineraryTripBlock` and `CityDetailBlock`.** Today every
     one of their rows carries a `CITY_TINT`, so the missing ground is **not
     visible on any current screen** — do not report it as a live defect and do
     not claim a fix "makes something render". It matters the day either of
     them gains an untinted row, which would then render on the page's paper
     instead of on the card.
  2. **The radius is 8px and the design says 10px**, in all four.
     `--radius-md` is 8px and `--radius-lg` is 12px, so **10px is not on the
     scale.** This needs either a named token — `--radius-a-bubble`
     (`globals.css:145`) is the precedent, and the two re-skin themes at
     `globals.css:260` and `:335` would each owe it a value — or Mitchell's
     ruling that `rounded-lg` is close enough. **A question, not a ticket; do
     not invent an arbitrary value, which is what the colour wall exists to
     refuse.**
  3. **Row padding is `px-3` (12px) against the design's 14px**, everywhere.
  4. **One container, not four:** a `.tc-widget-card` beside the
     `.tc-widget-table` that already exists. **This is the one item with a real
     chance of colliding with M14's rendering layer** — M14 owns the four
     states, and `NotebookBlock.dc.html:80-81` makes the container's *edge* one of
     them (`1px dashed var(--color-border-strong)` for `ghost` and `stale`). So
     sequence the extraction after M14, or agree the class with it first.

- **`CostsTableBlock.tsx` is a fifth container and is UNREACHABLE.** Nothing in
  `packages/pages` emits `kind: "costs-table"` — grep it; the live cost table is
  `cost.rows` through `MacroView`'s `rows` path. Do not "fix" it and do not count
  it in the four. It is worth one line here because it shows what dead code
  does: it is the only block carrying a total, and its total has **no
  `bg-moss`**, against the framework spec's *"a total is part of the block …
  same strip, same weight, `--color-moss` ground, in every block that has
  one"* — a rule `MacroView`'s live table does honour. Removing the component
  and the `CostsTablePayload` member is a better answer than restyling it, and
  is its own job.

- **No test layer can hold any of this, and that is not an excuse to skip one
  where there is one.** The test-quality wall rejects `toHaveClass` outside
  `src/components/ui` (`scripts/check-lint-wall.mjs:460`), and every item above
  changes a paint and nothing else — there is no role, label or value standing
  in for it. The honest coverage is the browser: the preview, or a Playwright
  walk asserting geometry rather than classes. **Do not write a unit test that
  renders the component and asserts its text**; M26 alone shipped seven tests that asserted
  nothing (`docs/STATUS.md`), and one more here would be the eighth.
