### KI-2026-09-06-c — RESOLVED 2026-09-06 — the widget chrome is a hover/focus popover

**Resolved by Mitchell's decision, same day:** *"I dont care about always visible, people editing the one they are focusing on. Reveal on hover/focus"*. That is the second option this entry listed, and it dissolves the conflict below rather than working around it — the controls stay mounted and in the accessibility tree, so ADR-037's day-1/day-3/day-9 notebook keeps working (hover or tab reaches any widget's bindings), while nothing is drawn over the page until you are actually on a widget. The panel is `absolute`, so it can no longer reflow anything either.

The original entry follows, unchanged, because the reasoning is what made the choice cheap.

---

### (original) the widget chrome cannot become a popover without hiding the bindings a multi-day notebook exists to show

- **Severity:** design conflict, not a defect. The current behaviour works; it is the requested behaviour that has no unblocked implementation.
- **Area:** `apps/web/src/components/pages/editor/WidgetChrome.tsx:133-165` (the `inline` split and the block shape's chrome row); `apps/web/src/components/pages/editor/MacroNodeView.tsx:47-67` (renders the chrome for every widget while `editing`).
- **The request:** Mitchell, 2026-09-06 preview, on a `day.rows` widget: *"The widget option select is still inline and not hovering over or blocking the existing elements."*
- **Symptom today:** a block widget's bind controls occupy a real row under the widget, so they displace the paragraph after it. This is deliberate — the row used to be inline for every shape until Mitchell's own earlier report, *"the dropdown is also overtop the widget block"*, moved it into the flow. The request is to reverse that, properly this time.
- **Why the obvious implementation is wrong, with evidence:** floating the row is one line (`absolute left-0 top-full z-20` on a `relative` `NodeViewWrapper`, plus `bg-surface` so it is readable over text). But `MacroNodeView` renders chrome for **every** widget in editing mode, so floating it alone hangs a panel over the text after each one and overlaps them wherever two block widgets sit close. A popover open on every widget at once is not a popover. Gating it to the selected widget was built and **fails `PageScreen.test.tsx:379`, "lets two widgets on one page point at different days"** — the test that encodes ADR-037 open question 1, settled by Mitchell on 2026-09-03: *"i should be able to have a notebook that shows day 1, day 3 and day 9, if we lock all widgets to one selection, its not possible"*. Selected-only does not lock the bindings, but it does mean that notebook can no longer show where its three widgets point without clicking each one — which is the scenario the decision exists to protect.
- **What would actually resolve it:** collision-aware popovers (each widget's panel positioned so it covers neither its own output nor another widget's chrome) — a real positioning layer, not a class change; or a hover/focus-revealed panel, which trades the always-visible bindings for the same reason; or accepting the current in-flow row and closing the request. All three are decisions, not implementations.
- **Cross-reference:** `docs/design-feedback/2026-09-06-preview-ui-feedback.md` finding 5, which carries the captured selector and component tree.
- **First noted:** 2026-09-06, after building the selected-only version and reverting it on this evidence.
