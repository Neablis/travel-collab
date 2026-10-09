"use client";
import { Button } from "@/components/ui/button";

// SPEC §9's BUBBLE presentation: the assistant at rest.
//
// *"Assistant shouldnt be at the top, it should be on the bottom right on
// desktop, floating till open, and always available in both editing and reading
// mode"* — Mitchell, on the notebook preview, where the assistant was a button
// in the page header beside "Edit page" and existed only while editing.
//
// **A 92×44 bar reading `Ask`, since SPEC §28.** It was a 56px brand circle
// carrying the wordmark's own glyph, and §28 records why that was wrong:
//
// > A square brand tile carrying the wordmark's own glyph read as a logo, not a
// > control — users did not know it was interactive. It is now a 92×44 bar
// > reading "Ask", **nothing else**. A drag-handle-plus-mark-plus-word version
// > was tried and rejected as three marks competing in one small control.
//
// So the mark is gone from this control rather than resized. "Nothing else" is
// the instruction, and it is the reason `BrandMark` is not imported here even
// though every other assistant surface now draws one.
//
// **The notebook page's launcher, and only the notebook's, since M39 D3.**
// The trip board mounted it too, and there it sat over the right-hand day
// column's stop costs (KI-2026-09-24-j) — SPEC §13.5's "nothing floats over
// data". The board's way in is the header's `AskPill` at every width now. A
// page has no costs to cover, and Mitchell asked for this corner there by
// name (below), so it stays; the `bottom` offset that cleared the board's
// unscheduled rack went with the board.
//
// The corner is the load-bearing part: §9 says expanding and collapsing keep it
// planted "so the panel grows out of the bubble rather than jumping across the
// screen", which is why `.assistant-float` pins the same corner with the same
// pad.
//
// **Not on a phone.** SPEC §13.5 is explicit — "Nothing floats over data. No
// floating action button." The notebook's phone entry point stays a control in
// the page header, and the caller decides which to mount.
//
// `max-md:hidden` is the second half of that, and it is not redundant with the
// caller's check: `useIsPhone` starts `false` (there is no viewport on the
// server) and corrects in an effect, so on a phone this mounts for one paint
// before the effect removes it — a floating action button over the document,
// briefly, which is the thing §13.5 forbids (CodeRabbit, PR 139). The class
// makes the rule true at first paint rather than one tick later, and `max-md`
// is the same 768px line `useIsPhone` draws, so the two cannot disagree.
//
// Dragging is the half of §9 not built. The bubble can be "dragged anywhere"
// there; nothing here forecloses that, and where the panel OPENS is what was
// actually reported.
export function AssistantBubble({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  return (
    <Button
      variant="primary"
      // 92×44 — §28's numbers, spelled on the spacing scale rather than as
      // arbitrary values: `h-11` is 44px and `w-23` is 92px at the default 4px
      // step. (`w-[92px]` is the same pixels and the colour wall rejects it,
      // correctly: an arbitrary value is how a one-off number escapes the
      // scale.) `p-0` clears the size variant's padding so the label centres in
      // the fixed box.
      // `.assistant-bubble` is §9's 16px pad from the safe area's corner.
      className="assistant-bubble fixed z-30 h-11 w-23 rounded-full p-0 text-base font-semibold shadow-overlay transition-transform hover:scale-105 max-md:hidden"
      aria-expanded={open}
      // Both this and `AskPill` are named "Ask" now — §28 labels the desktop
      // launcher and §23 labels the phone pill, and they are the same control
      // at two breakpoints, so the agreement is correct and not a collision to
      // rename away. It is invisible in a browser, where `max-md:hidden` and
      // `md:hidden` mean only one is ever in the tree; it is NOT invisible in
      // jsdom, which applies no breakpoints, so a component test asking for
      // "the button called Ask" finds two. The testid says which surface a
      // test means, without either control's accessible name disagreeing with
      // the word printed on it (WCAG 2.5.3, the rule `AskPill` records).
      data-testid="assistant-launcher"
      onClick={onOpen}
    >
      Ask
    </Button>
  );
}
