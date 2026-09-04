"use client";
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { Heading } from "./heading";

/**
 * `rail` is the ordinary side sheet. `full` fills the window. `bottom` rises
 * from the bottom edge and stops short of the top.
 *
 * `full` exists for one moment: somebody's first trip. Mitchell, 2026-09-01 —
 * *"The 'New trip' side bar should be a full screen experience when you have no
 * trips"*. A 640px rail slid in over a page that is otherwise an empty state
 * reads as an aside from something, and on a first run there is no something.
 * It stays a size on THIS component rather than a second component: the
 * wizard, its focus trap, its Escape key and its title are all identical, and
 * two sheets would be two of everything.
 *
 * `bottom` is the phone's sheet, added for the Notebook (design handoff
 * SPEC §19): the insert flow and the widget bind sheet both open from content
 * the reader is looking at, and a rail sliding in from the right on a 390px
 * screen is a full-screen takeover that merely animates sideways. It stops
 * short of the top (`top-24`) for the reason §19 gives — leaving the page
 * visible behind it is what makes it a sheet rather than a second screen. Same
 * component for the same reason `full` is: one focus trap, one Escape key.
 */
export type SheetSize = "rail" | "full" | "bottom";

// A side-anchored Dialog (design-system.md surface vocabulary): roomy forms that
// keep spatial context. State-controlled — no SheetTrigger, so fireEvent.click
// on a plain caller button opens it (ADR-012 invariant 3).
export function Sheet({
  open,
  onOpenChange,
  title,
  size = "rail",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  side?: "right";
  size?: SheetSize;
  children: React.ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="overlay-layer fixed inset-0 bg-ink/40" />
        <RadixDialog.Content
          className={cn(
            "overlay-layer fixed flex w-full flex-col bg-surface p-5 shadow-overlay",
            // `max-w-measure` is what makes the rail a rail; dropping it for
            // `inset-x-0` is what makes `full` full. `bottom` anchors to the
            // other edge entirely, so it opts out of `inset-y-0` as well —
            // `top-24` is the ~92px §19 asks for, on the spacing scale rather
            // than as an arbitrary value the design wall would reject.
            size === "bottom"
              ? "inset-x-0 bottom-0 top-24 rounded-t-lg"
              : size === "rail"
                ? "inset-y-0 right-0 max-w-measure"
                : "inset-y-0 right-0 inset-x-0",
          )}
        >
          {/* One inner column, so `full`'s readable cap is applied ONCE rather
              than on the title row and the scrollport separately — the second
              of those would have had to fight the `-mx-1` the scrollport needs
              for its focus rings (below), and `mx-auto` would have won. A
              four-step form stretched across a 1728px window is not what "full
              screen" was asking for; the width is the stage, not the form. */}
          <div className={cn("flex min-h-0 flex-1 flex-col gap-3", size === "full" && "mx-auto w-full max-w-content")}>
            <div className="flex items-start justify-between gap-3">
              <RadixDialog.Title asChild>
                <Heading level={3}>{title}</Heading>
              </RadixDialog.Title>
              <RadixDialog.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Close">
                  <X className="size-4" aria-hidden />
                </Button>
              </RadixDialog.Close>
            </div>
            {/* `-mx-1 px-1`, not a bare `overflow-y-auto`: setting overflow on
                one axis forces the other to a non-visible value, so this
                scrollport was clipping its children's focus outlines at its own
                left edge. Input draws its focus ring at `outline-offset-1`, i.e.
                1px OUTSIDE the control, and a `w-full` field sits flush here —
                so focusing one showed a ring with its left edge sliced off
                (Mitchell, preview feedback on PR #55, reported twice: the budget
                input in Trip settings and the place-name input in Add a stop).
                The padding gives the outline room to draw; the equal negative
                margin cancels it, so nothing moves. */}
            <div className="-mx-1 flex-1 overflow-y-auto px-1">{children}</div>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
