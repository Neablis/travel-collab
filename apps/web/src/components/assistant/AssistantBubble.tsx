"use client";
import { Button } from "@/components/ui/button";

// SPEC §9's BUBBLE presentation: the assistant at rest.
//
// *"Assistant shouldnt be at the top, it should be on the bottom right on
// desktop, floating till open, and always available in both editing and reading
// mode"* — Mitchell, on the notebook preview, where the assistant was a button
// in the page header beside "Edit page" and existed only while editing.
//
// A 56px brand circle, `position: fixed` in the bottom-right corner with §9's
// 16px pad. The corner is the load-bearing part: §9 says expanding and
// collapsing keep it planted "so the panel grows out of the bubble rather than
// jumping across the screen", which is why `.assistant-float` pins the same
// corner with the same pad.
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
      // `size-14` is 56px. `p-0` clears the size variant's padding so the mark
      // centres in a circle rather than in a pill.
      className="fixed right-4 bottom-4 z-30 size-14 rounded-full p-0 text-lg shadow-overlay transition-transform hover:scale-105 max-md:hidden"
      aria-expanded={open}
      // Same name as the panel it opens, on purpose: they are one control in
      // two states, and `aria-expanded` is what says which. Different roles, so
      // "the Assistant button" and "the Assistant region" stay unambiguous.
      aria-label="Assistant"
      onClick={onOpen}
    >
      <span aria-hidden>◎</span>
    </Button>
  );
}
