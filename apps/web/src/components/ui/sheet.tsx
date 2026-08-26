"use client";
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "./button";
import { Heading } from "./heading";

// A side-anchored Dialog (design-system.md surface vocabulary): roomy forms that
// keep spatial context. State-controlled — no SheetTrigger, so fireEvent.click
// on a plain caller button opens it (ADR-012 invariant 3).
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  side?: "right";
  children: React.ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="overlay-layer fixed inset-0 bg-ink/40" />
        <RadixDialog.Content className="overlay-layer fixed inset-y-0 right-0 flex w-full max-w-measure flex-col gap-3 bg-surface p-5 shadow-overlay">
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
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
