"use client";
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "./button";
import { Heading } from "./heading";

export function Dialog({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: React.ReactNode }) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="overlay-layer fixed inset-0 bg-ink/40" />
        {/* A height cap and a scrolling body, which `Sheet` already had and
            this did not.

            A centred `top-1/2 -translate-y-1/2` box with no height cap does not
            merely spill off the bottom of a short viewport — it spills off the
            TOP as well, and the part above the top edge cannot be scrolled to,
            because the content is `fixed`. Whatever is at the start of the
            dialog is then unreachable by mouse, by keyboard and by an e2e
            click, with nothing on screen to say so.

            Found the way these things are found: `SavedDaysDialog` lists a
            person's whole library with no pagination, and at 19 saved days
            `m11-saved-days.spec.ts` began hanging on a click of the FIRST row's
            "Add to trip" — an actionability wait that never resolves, which
            reads exactly like a timeout. Every dialog in the app had it; the
            library is just the first list here long enough to reach it. */}
        <RadixDialog.Content
          className="overlay-layer fixed top-1/2 left-1/2 flex w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-surface p-5 shadow-overlay"
          // A viewport-relative cap is not a design constant and has no token; `max-h-[85vh]` in className is what the color wall forbids, so this takes the same inline-style escape hatch Board/Sparkline use for computed geometry
          style={{ maxHeight: "85vh" }}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <RadixDialog.Title asChild>
              <Heading level={3}>{title}</Heading>
            </RadixDialog.Title>
            <RadixDialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" aria-hidden />
              </Button>
            </RadixDialog.Close>
          </div>
          {/* `-mx-1 px-1`, not a bare `overflow-y-auto`, for the reason
              `Sheet` records at length: overflow on one axis forces the other
              to a non-visible value, and a `w-full` control's focus ring draws
              1px OUTSIDE itself, so a bare scrollport slices the ring's left
              edge off. The padding gives it room; the equal negative margin
              cancels it, so nothing moves. */}
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  return <div className="mt-4 flex justify-end gap-2">{children}</div>;
}
