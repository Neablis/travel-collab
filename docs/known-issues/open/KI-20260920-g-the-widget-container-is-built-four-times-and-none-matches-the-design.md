### KI-2026-09-20-g — the widget container is built four times over, and no two of them agree with each other or with the design

- **Severity:** cosmetic, and one of the four was visibly wrong (fixed — see
  *Already done* below). The remaining three are drift rather than defect: the
  boxes differ from the design and from each other in ways a person notices as
  "these two widgets look like different products" rather than as breakage.
- **Milestone:** **M14, carried (assigned 2026-09-24, KI pass)** — owned by M14 (the notebook/widget builder), not a gate box. Listed in `docs/milestones/M14-rich-layer.md` § *Parked 2026-09-24*.
- **Area:** `apps/web/src/components/pages/MacroView.tsx:309`,
  `apps/web/src/components/pages/blocks/ItineraryTripBlock.tsx:52`,
  `apps/web/src/components/pages/blocks/CityDetailBlock.tsx:28`,
  `apps/web/src/components/pages/blocks/ItineraryDayBlock.tsx:27`.

- **Symptom / What happens:** a widget that renders as a block sits in a
  bordered card, and there are **four hand-rolled copies of that card** in the
  build:

  | container | class string today |
  |---|---|
  | `MacroView.tsx:309` — the `rows` table (`cost.rows`, `day.rows`, `city.rows`, `stop.rows`) | `tc-widget-table my-1 overflow-hidden rounded-md border border-hairline bg-surface` |
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

- **How it was found:** a wrong turn worth recording, because the words are
  genuinely ambiguous and the next reader will take the same one. Mitchell,
  2026-09-20: *"the Widget container restyling was missed"* — and he meant the
  **insert rail**, the 320px Widgets panel (`KI-2026-09-20-h`), not the card a
  rendered widget sits in. This entry is what the wrong reading turned up on the
  way. It is real, and it is nobody's, so it is filed rather than dropped — but
  it is **not** what was asked for, and it was not the priority.

  **"The widget container" means the rail.** If an entry, a milestone line or a
  gate box says it without saying which, that is the one it means.

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
  2. ~~**The radius is 8px and the design says 10px**, in all four.
     `--radius-md` is 8px and `--radius-lg` is 12px, so **10px is not on the
     scale.** This needs either a named token — `--radius-a-bubble`
     (`globals.css:145`) is the precedent, and the two re-skin themes at
     `globals.css:260` and `:335` would each owe it a value — or Mitchell's
     ruling that `rounded-lg` is close enough.~~ **Restated 2026-09-25:** the
     only look is Ledger (`layout.tsx` hard-sets it; the other two re-skins were
     deleted in 57922bd), and Ledger squares `--radius-md` to `0px`
     (`globals.css:288`), so these cards render **square**, not 8px, against the
     design's 10px. A 10px token now exists — `--radius-a-card: 10px`
     (`globals.css:180`, "a proposal card, a Playbook-day card", added in
     57922bd) — which Ledger does not override. Whether a widget card takes it or
     stays squared with the rest of Ledger is still the ruling this item wants. **A question, not a ticket; do
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
  `src/components/ui` (`apps/web/eslint.config.mjs:608`), and every item above
  changes a paint and nothing else — there is no role, label or value standing
  in for it. The honest coverage is the browser: the preview, or a Playwright
  walk asserting geometry rather than classes. **Do not write a unit test that
  renders the component and asserts its text**; M26 alone shipped seven tests that asserted
  nothing (`docs/STATUS.md`), and one more here would be the eighth.
- **Re-verified 2026-09-25 (overnight sweep):** still true, and wider than the
  title. The four cited containers are unchanged (`MacroView.tsx:309`,
  `ItineraryTripBlock.tsx:52` and `CityDetailBlock.tsx:28` still without
  `bg-surface`, `ItineraryDayBlock.tsx:27`; rows still `px-3`), no
  `.tc-widget-card` exists, and `CostsTableBlock` is still unreachable (the only
  `"costs-table"` hits are `registry-types.ts:69` and `BlockView.tsx:53`).
  M14's later widgets added **three more hand-rolled copies**, all live
  (emitted by `weather.ts:262`, `countryFacts.ts:87`, `spendByDay.ts:228`):
  `WeatherBlock.tsx:133` and `CountryFactsBlock.tsx:38`
  (`overflow-hidden rounded-md border border-hairline bg-surface`), and
  `SpendByDayBlock.tsx:55` (`rounded-md border border-hairline bg-surface p-3`
  — a padded box, the shape `ItineraryDayBlock` was fixed away from). So seven
  live copies, not four. Item 2 restated in place (Ledger renders them at 0px;
  `--radius-a-card` is now a 10px token); line refs corrected (`MacroView` 259→309,
  the `toHaveClass` ban is `apps/web/eslint.config.mjs:608`, not
  `check-lint-wall.mjs:460`).
