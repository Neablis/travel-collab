"use client";
import { Button } from "@/components/ui/button";

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
// **`md:hidden`, not `useIsPhone()`.** `useIsPhone` starts `false` on the
// server and on the first client paint and corrects in an effect, so a
// JS-gated pill mounts for one paint at every width — the same first-paint
// problem `AssistantBubble.tsx:38` and `PhoneTabBar.tsx:202` both solve with a
// CSS breakpoint. 768px is the line every other phone rule in this app draws.
//
// The accessible name is the visible label. `AssistantBubble` deliberately
// names itself "Assistant" to match the panel it opens, but it is icon-only —
// this pill has visible text, and an `aria-label` that disagreed with it would
// break WCAG 2.5.3 (label in name) and leave voice-control users saying "click
// Ask" at a control not called Ask. `aria-expanded` is what says which of the
// two states it is in, exactly as on the bubble.
export function AskPill({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  return (
    <Button
      variant="ghost"
      // `size="touch"` is SPEC §13.1's 44px floor from the design system rather
      // than a hand-written `min-h-11`. The design draws this pill's label at
      // 13px; `touch` carries `md`'s `text-base` on purpose, and that is the
      // rule §13.1 states for exactly this case — "chips grow by `min-height`,
      // never by font size". The box takes the 44px, the type scale stays
      // shared with desktop.
      size="touch"
      // Not a variant: `primary` is a filled brand button and `secondary` is
      // surface-on-border, and the design's pill is neither — it is the same
      // brand-tint-behind-brand-ink treatment the active tab pill uses
      // (`--color-brand-tint` + `--color-brand-pressed`, SPEC §22), which is
      // what makes the two read as the same family. Tokens, so the colour wall
      // is satisfied without a fourth variant that has one caller.
      className="shrink-0 gap-1.5 rounded-full bg-brand-tint font-semibold text-brand-pressed hover:bg-brand-tint hover:text-brand-pressed md:hidden"
      aria-expanded={open}
      onClick={onOpen}
    >
      <span aria-hidden>◎</span>
      Ask
    </Button>
  );
}
