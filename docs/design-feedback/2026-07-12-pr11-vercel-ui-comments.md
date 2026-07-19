# PR #11 UI/UX feedback — Vercel live comments (2026-07-12)

Source: Mitchell left 15 comments via the Vercel preview toolbar on
[PR #11](https://github.com/Neablis/travel-collab/pull/11)
(`travel-collab-git-m5-design-foundations-neablis-projects.vercel.app`,
branch `m5-design-foundations`), all on the trip board page
(`/trips/eeb41ba3-fd52-463e-9ad5-dc417a106a5d`, trip "Italy"). Pulled via
the Vercel MCP's `list_toolbar_threads` — exact CSS selectors and React
component trees below are straight from each thread's `context`, not
guessed.

**This is a raw capture for another model's holistic pass — not analyzed,
triaged, or fixed here.** Ordered oldest → newest (the order they were
likely left in). Each entry: comment text verbatim, the DOM selector +
component tree Vercel captured, and the component/file that selector maps
to in this codebase.

The trip data (budget `5.00 USD` vs. trip total `1,111,111.00 USD`, two
overlapping activities) is intentionally contrived to trigger the
conflict banner and over-budget states while leaving comments — not real
content.

---

## 1. History entry row — width / no pagination

> "Put a max length to history, we will someday need to paginate anyways, and have a next/prev button. Also this is too wide to be useful"

- Selector: `body > div.mx-auto > main > aside > aside.rounded-lg > div.p-3 > ol.m-0 > li.flex > button.inline-flex`
- Component tree: inside `<aside title="History">` → `HistoryPanel`'s
  `<ol reversed>` → a `<li data-testid="history-entry">` → its ghost
  `Button` (likely the revert/preview action).
- Maps to: `apps/web/src/components/board/HistoryPanel.tsx`.

## 2. "Clear dates" button — size / rare-operation prominence

> "Clear DATE not DATES, also do we need a giant button? couldnt we just have a clear button in the calendar picker? its gonna be a rare operation"

- Selector: `body > div.mx-auto > main > span.flex > button.inline-flex`
- Component tree: inside the `TripDateControl` (`startDate="2026-07-12"`)
  → `<span className="flex items-end gap-2">` → the Clear button.
- Maps to: `apps/web/src/components/lenses/TripDateControl.tsx`.

## 3. Date format in the Daily lens table

> "More human readable date please"

- Selection text quoted: `2026-07-12`
- Selector: `... > table.w-full > tbody > tr.border-b > td.px-2:nth-of-type(2) > span.font-mono`, inside `<tr data-testid="daily-overview-row-...">`.
- Maps to: `apps/web/src/components/lenses/DailyOverviewLens.tsx` — the
  **Date column's `DataText`**, not the History panel (my earlier manual
  transcription guessed wrong; this is the corrected location).

## 4. Itinerary lens day-subtotal rows too wide

> "These are all too wide to. Look into screen width breakpoints with a full page container and logical max sizes."

- Selector: `... > div[data-testid="itinerary-lens"] > section[data-testid="itinerary-day-..."] > div.mt-1.5`
- Component tree: inside `ItineraryLens`'s per-day `<section>` → the day
  subtotal row (`div.mt-1.5.flex.justify-between`).
- Maps to: `apps/web/src/components/lenses/ItineraryLens.tsx`. Given the
  selector, "these" most likely means the day-subtotal / section rows
  specifically, not the whole page — narrower than my original guess.

## 5. Location search results list — unreadable

> "The search ui looks awful, and unreadible. No seperation between sections, font overlaps"

- Selector: `... > form.grid > div.grid > ul.m-0.list-none > li:nth-of-type(3)`
- Component tree: inside the backlog column's `ActivityEditor` form →
  the location search results `<ul>` → 3rd result `<li>`.
- Maps to: `apps/web/src/components/board/LocationInput.tsx`'s search
  results dropdown.

## 6. Location search field — Enter key submits form instead of searching

> "Pressing enter when typing here should search, not try to submit the form"

- Selector: `input.h-9` with `aria-label="Place name"`,
  `value="Golden Gate Bridge"` at capture time.
- Maps to: `apps/web/src/components/board/LocationInput.tsx`'s place-name
  `Input`. **Behavioral** note (event handling), not purely visual.

## 7. Activity cost field — no label

> "No lable on budget, not clear what this is"

- Selector: `input.h-9` with `aria-label="cost (USD)"`,
  `type="number" step="0.01" min="0"`.
- Component tree: inside the backlog column's `ActivityEditor` form
  (`e3 tripCurrency="USD"` wrapper), i.e. **the per-activity cost
  `MoneyInput` inside the editor** — not the top-level trip budget field.
  (Corrected from my earlier manual capture, which conflated this with
  comment #12's trip-level budget/currency row.)
- Maps to: `apps/web/src/components/board/MoneyInput.tsx` as used inside
  `ActivityEditor.tsx`.

## 8. Anchor concept unclear to users

> "Its not obvious what an anchor is, that model doesnt make sense to a normal user, work on a better ui to show its a date locked to specific logic"

- Selector: `select#anchor-kind`, `aria-label="anchor kind"`,
  `value="dayOfWeek"`.
- Maps to: `apps/web/src/components/board/AnchorEditor.tsx`.

## 9. Activity editor ("create event") UI — overflow

> "The create event ui looks really bad, looks over overflow elements"

- Selector: `div.rounded-md.border.border-hairline` — the whole editor
  `Card` container in the backlog column.
- Maps to: `apps/web/src/components/board/ActivityEditor.tsx`'s outer
  `Card`. "looks over overflow elements" is ambiguous as written — could
  mean the form overflows its container, or an incomplete sentence. Read
  verbatim; don't guess further without a fresh screenshot.

## 10. Board horizontal scroll — no affordance, brainstorm for 7+ day trips

> "When this scrolls of the screen, theres no hint you need to scroll right, we probably dont even want to have to scroll right. Lets brainstorm the best way to show trips 7+ days long but still easily drag and drop between days"

- Selector: Day 5 column's `<ul className="m-0 min-h-12 list-none rounded-sm p-1">`, `data-testid="day-column"`, `title="Day 5 — Jul 16"`.
- Maps to: `apps/web/src/components/board/Board.tsx` / `Column.tsx`'s
  `flex ... overflow-x-auto` layout. Explicitly framed as a
  **brainstorm**, not a bug report — an IA/UX question about board
  layout at scale (6+ days visible in the trip used for testing), likely
  needing a design discussion before any fix.

## 11. Lens switcher doesn't read as tabs

> "Theres no clear ux indicator there are tabs"

- Selector: `div[role="tablist"][aria-label="Trip view"] > button:nth-of-type(4)` — the **4th tab** (Board=1, Map=2, Timeline=3, **Calendar=4**), `variant="ghost"`, `aria-selected={false}`.
- Maps to: `apps/web/src/components/board/TripBoardScreen.tsx`'s lens
  switcher. Note: Track B's re-skin (M5 plan Task B1) deliberately kept
  this as plain `role="tab"` ghost buttons instead of Radix `Tabs`
  styling, because `fireEvent.click` doesn't trigger Radix's
  `TabsTrigger` (pointer-event-only handler) and swapping would've
  silently broken `TripBoardScreen.test.tsx`. This comment may be
  flagging exactly that visual tradeoff — the current styling doesn't
  read as a tab strip even though the semantics (`role="tab"`) are
  correct.

## 12. Currency/budget row — unclear purpose + IA placement question

> "Theres no indicator this is setting the budget, and it doesnt make sense to have a budget be so top level, its a set once,  and evaluate from time to time, such as in the trip tab"

- Selector: `label.text-sm.font-medium.text-slate`, `htmlFor="trip-currency"` — the **currency `<label>`** itself.
- Component tree: inside the top-level `currency="USD"` trip-money row
  (`div.flex.items-center.gap-1.5`).
- Maps to: `apps/web/src/components/board/TripMoneySettings.tsx`. Two
  distinct points bundled: (a) the currency label doesn't read as
  "you're setting the trip's budget here" (label text is literally just
  lowercase "currency" — pre-existing copy, already flagged separately in
  the M5 PR description as out-of-scope-for-re-skin), and (b) an IA
  suggestion to move budget-setting out of the always-visible header into
  the "Trip" lens tab, since it's set-once/occasionally-revisited.

## 13. History panel should be a popover, not a page push-down

> "History shouldnt push everything down, it should be a pop over element, more integretated into the global UI so its consistant in its placement and follows you throughout the trip"

- Selector: `aside > button.inline-flex`, `aria-label="History"`,
  `variant="ghost"` — the History toggle button itself.
- Maps to: `apps/web/src/components/board/HistoryPanel.tsx`'s trigger.
  Currently renders inline and pushes board content down when opened;
  suggestion is an overlay/popover pattern, consistently anchored
  regardless of scroll position.

## 14. No visual separation between trip chrome and board content

> "theres no clear seperation between this, and the actual trip, it all blends together"

- Selector: `nav > a`, `href="/"` — the "← Your trips" back link itself.
- Maps to: `apps/web/src/app/trips/[tripId]/page.tsx` /
  `TripBoardScreen.tsx`'s header nav. Likely referring to the board
  header (date/currency/budget/undo-redo/history) not being visually
  distinct from the board/lens content below — everything sits on the
  same `bg-paper` background with no card/section boundary.

## 15. Two bars misaligned

> "These two bars are not aligned"

- Selector: `div.flex.items-center.gap-1.5` — the currency/budget row's
  flex container.
- Maps to: `apps/web/src/components/board/TripMoneySettings.tsx`. "Two
  bars" most likely refers to the start-date row vs. the currency/budget
  row not sharing a baseline/height — both are top-level rows in the
  same header area, but the selector only pins the currency row's
  container. Worth a fresh screenshot to confirm exactly which two
  elements are being compared before acting.

---

## Notes for the next pass

- All 15 selectors/component trees above are ground-truth from Vercel's
  toolbar (`list_toolbar_threads` via the Vercel MCP), not inferred —
  safe to use directly to jump to the right file/component.
- Comments 10, 12, 13 aren't bug reports — they're IA/interaction-model
  questions ("brainstorm...", "doesnt make sense to have a budget be so
  top level...", "should be a pop over element..."). These likely need a
  design discussion before implementation, not a direct fix.
- Comment 11 (lens switcher tab affordance) connects to a known,
  documented tradeoff from the M5 re-skin (Track B kept plain
  `role="tab"` buttons over Radix `Tabs` for test-compatibility reasons)
  — worth reading that context before deciding how to address it, since
  a naive "make it look more like tabs" fix could reintroduce the
  `fireEvent.click` incompatibility if it reaches for Radix again.
- Comment 12's "no indicator this is setting the budget" partially
  overlaps with a pre-existing, already-flagged issue: the `currency`
  field's label renders lowercase and doesn't read as "trip budget"
  (see the M5 PR #11 description's "Findings for Mitchell" section) —
  that's pre-M5 copy, not something the re-skin touched.
