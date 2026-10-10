"use client";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";
import { cn } from "@/lib/cn";

// **The trip header's Ask, above 768px only, since Mitchell's 2026-10-10
// preview pass.** On a phone the one-row header was "way too crowded", and Ask
// moved into the bottom tab bar (`PhoneTabBar`'s Ask item, fed by
// `usePhoneAskEntry` from the board and both notebook screens). Same position
// on every in-trip screen still holds — it is the bar's, which never moves —
// and the scope reasoning below still holds: the bar's item opens the surface's
// own assistant, so it inherits that surface's scope exactly as the pill did.
// The notebook screens no longer render this pill at all.
//
// What follows is the pill's history, kept because the reasons still apply.
//
// SPEC §23's phone entry point to the assistant: *"An `Ask` pill, last item in
// the top row, on all four in-trip screens — Plan, Map, the Notebook index and
// an open Notebook page. Same pill, same label, same position, so it never
// moves as you change tabs."*
//
// It is ONE component precisely because "same pill, same position" is the
// design's claim. Before this, the phone had three different entry points in
// three different places — a full-width `◎ Assistant` button at the end of the
// plan column (TripBoardScreen), a `◎ Assistant` button in the page action row
// beside "Edit page" (PageScreen), and nothing at all on the Notebook index.
// Three call sites each writing their own header button is how that happened,
// and is what a shared component is here to stop happening again.
//
// **Why a pill and not a fourth tab** is §23's load-bearing decision, and it is
// about scope rather than chrome: a tab is a destination, and a destination has
// to invent its own scope — it would open on "the whole trip" and lose the day
// or the page you were reading. The pill inherits the surface's scope instead.
// The scope itself is derived by `phoneAskContext.ts`, not here; this component
// only opens the thing.
//
// **The trip header's entry point at EVERY width since M39 D3**
// (KI-2026-09-24-j; Mitchell, 2026-10-09). Above 768px the board's way in was
// `AssistantBubble`, `position: fixed` bottom-right — over the right-hand
// column's stop costs, which SPEC §13.5 forbids ("nothing floats over data").
// One pill in the header's own flow cannot cover anything, and it is the same
// control in the same place on a phone, a tablet and a desktop.
//
// **The notebook page still hides it at `md`** (`className="md:hidden"`),
// where `AssistantBubble` stays its desktop launcher. When a caller does hide
// it by width, it is with a CSS breakpoint and never `useIsPhone()`: that hook
// starts `false` on the server and corrects in an effect, so a JS-gated pill
// mounts for one paint at every width — the first-paint problem
// `AssistantBubble.tsx:38` and `PhoneTabBar.tsx:202` both solve the same way.
//
// The accessible name is the visible label. `AssistantBubble` deliberately
// names itself "Assistant" to match the panel it opens, but it is icon-only —
// this pill has visible text, and an `aria-label` that disagreed with it would
// break WCAG 2.5.3 (label in name) and leave voice-control users saying "click
// Ask" at a control not called Ask. `aria-expanded` is what says which of the
// two states it is in, exactly as on the bubble.
export function AskPill({ open, onOpen, className }: { open: boolean; onOpen: () => void; className?: string }) {
  return (
    <Button
      variant="ghost"
      // `size="md"`, the box of the Add stop button it sits beside. It was
      // `touch`, which keeps 44px even under a mouse, and stood 8px taller than
      // Add stop on the desktop header (Mitchell: "Ask is larger than add stop
      // in height and looks weird"). The 44px floor under a finger is not lost:
      // the base button class carries `min-h-11` for a coarse pointer and only
      // `fine:` releases it, so a tablet still gets SPEC §13.1's target.
      size="md"
      // Not a variant: `primary` is a filled brand button and `secondary` is
      // surface-on-border, and the design's pill is neither — it is the same
      // brand-tint-behind-brand-ink treatment the active tab pill uses
      // (`--color-brand-tint` + `--color-brand-pressed`, SPEC §22), which is
      // what makes the two read as the same family. Tokens, so the colour wall
      // is satisfied without a fourth variant that has one caller.
      className={cn(
        "shrink-0 gap-1.5 rounded-full bg-brand-tint font-semibold text-brand-pressed hover:bg-brand-tint hover:text-brand-pressed",
        className,
      )}
      aria-expanded={open}
      // See `AssistantBubble`'s note: same name, two breakpoints, and jsdom
      // applies neither.
      data-testid="ask-pill"
      onClick={onOpen}
    >
      {/* Tile-less: the pill is already a brand-tint surface, and a second
          filled tile inside it would be a mark on a mark. `size={20}` is the
          proportion, not a drawn box — it yields the design's 2.5px strokes at
          11px tall (`dc.html:257`). */}
      <BrandMark size={20} tile={false} />
      Ask
    </Button>
  );
}
