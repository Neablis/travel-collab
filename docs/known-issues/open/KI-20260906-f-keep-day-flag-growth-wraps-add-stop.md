### KI-2026-09-06-f — the Keep-day pennant grows when clicked, which bumps "Add stop" onto a second line

- **Severity:** cosmetic, transient. Nothing is lost or mis-shown; the row reflows for the length of the celebration animation and returns.
- **Area:** `apps/web/src/components/trip/KeepDayFlag.tsx:119-164` (the button and its `celebrating` label); `apps/web/src/components/lenses/TimelineLens.tsx:729` (the `flex flex-wrap items-center gap-2` day-head row the two controls share).
- **The report:** Mitchell, 2026-09-06 preview, on a 412px Android phone: *"add stop goes briefly to the second line when the flag button is clicked"*.
- **Mechanism, and it is exact.** The pennant is a fixed 30px circle (`style={{ height: "30px", minWidth: "30px", paddingInline: "7px" }}`). While `celebrating`, it renders an ADDITIONAL in-flow `<span …>Kept</span>` inside itself, so the button's own width grows by that label. The day head is `flex-wrap` and, at 412px, has no slack left: the growth pushes the total past the line and `Add stop` — the next sibling — wraps. When the celebration ends the label unmounts and it wraps back.
- **Why it is filed rather than fixed:** three fixes exist and each trades something that needs to be seen on a real screen to judge.
  1. **Take the label out of flow** (`absolute` on the label, `relative` on the button). The pennant stays 30px and nothing reflows — but the label then renders over whatever is beside it, which at this width is the `Add stop` button.
  2. **Reserve the width permanently** so the button never changes size. No reflow and no overlap, but every un-kept pennant is then as wide as its celebrating state, which changes the resting design on every day head.
  3. **Keep the growth and stop the row wrapping** — e.g. group the pennant and `Add stop` as one `shrink-0` unit. The `<div className="flex-1" />` spacer earlier in the row would absorb the growth *if the row had slack*; at 412px it does not, so this only changes which pair wraps.
- **A detail worth carrying into whichever is chosen:** the component's own comment says the design "parks this permanently in the DOM at `max-width: 0`" and that this was rejected because it "would be read out, so every un-kept day would announce 'Kept'". That reason no longer binds on its own — the label already carries `aria-hidden`, so a permanently parked copy would not be announced. Option 2 is therefore closer to the design than the comment implies.
- **Cross-reference:** `docs/design-feedback/2026-09-06-preview-ui-feedback.md` finding 14.
- **First noted:** 2026-09-06.
