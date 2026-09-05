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

/**
 * Cancel / title / Save hung in the sheet's own header — design handoff
 * SPEC §13.6: *"the sheet carries its own Cancel / title / Save header,
 * because mobile has no top bar to hang actions on"*, and `DS-UPSTREAM.md`
 * U6(d), which asks for it as a variant of this component rather than as a
 * mobile one.
 *
 * Optional, and that is the point: absent it the header is the desktop's
 * title + ✕, unchanged. Present, the ✕ goes — Cancel and a close button are
 * the same act rendered twice in a 390px row, which is RULES.md rule 4
 * ("avoid showing the same information twice"), and the design's phone sheet
 * carries only Cancel. Escape survives either way; it belongs to Radix's
 * Root, never to the ✕.
 */
export type SheetActions = {
  onCancel?: () => void;
  /**
   * Required, unlike the rest. Opting into this header ALWAYS renders a Save,
   * and there is no form-submit fallback behind it — so an optional `onSave`
   * let a caller ship an enabled button that silently does nothing. Cancel is
   * optional because it has a real default: `RadixDialog.Close` dismisses the
   * sheet whether or not the caller wants to hear about it. (Copilot, PR #143.)
   */
  onSave: () => void;
  cancelLabel?: string;
  saveLabel?: string;
  saveDisabled?: boolean;
};

// A side-anchored Dialog (design-system.md surface vocabulary): roomy forms that
// keep spatial context. State-controlled — no SheetTrigger, so fireEvent.click
// on a plain caller button opens it (ADR-012 invariant 3).
export function Sheet({
  open,
  onOpenChange,
  title,
  size = "rail",
  actions,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  side?: "right";
  size?: SheetSize;
  actions?: SheetActions;
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
            {/* Either header is a sibling of the scrollport below, never a
                child of it: §13.6 moves Save up here precisely so it stops
                sitting under an `overflow-y-auto` fold on a phone. */}
            {actions ? (
              // `items-center`, not the `items-start` the desktop row uses:
              // two 44px controls set this row's height, and a title pinned to
              // their top edge reads as a bug.
              <div className="flex items-center justify-between gap-3">
                <RadixDialog.Close asChild>
                  {/* Still a real `Dialog.Close` — Radix composes its own
                      dismiss with this `onClick`, so Cancel inherits every
                      close semantic the ✕ had instead of reimplementing one. */}
                  <Button variant="ghost" size="touch" className="px-0" onClick={actions.onCancel}>
                    {actions.cancelLabel ?? "Cancel"}
                  </Button>
                </RadixDialog.Close>
                <RadixDialog.Title asChild>
                  {/* `min-w-0` because `truncate`'s overflow does nothing to a
                      flex item that refuses to shrink below its content. */}
                  <Heading level={3} className="min-w-0 truncate">
                    {title}
                  </Heading>
                </RadixDialog.Title>
                {/* Deliberately NOT inside a `Dialog.Close`: a save can fail or
                    fail validation, and a header that dismisses itself before
                    the caller has answered throws the error away with the
                    sheet. Closing on success is the caller's call. */}
                <Button
                  variant="ghost"
                  size="touch"
                  className="px-0 font-semibold text-brand hover:text-brand-hover"
                  onClick={actions.onSave}
                  disabled={actions.saveDisabled}
                >
                  {actions.saveLabel ?? "Save"}
                </Button>
              </div>
            ) : (
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
            )}
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
            <div data-testid="sheet-scrollport" className="-mx-1 flex-1 overflow-y-auto px-1">
              {children}
            </div>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
