"use client";
import { useId } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { cn } from "@/lib/cn";

// Anchored, small: never pushes page content down (design-system.md). Controlled
// via open/onOpenChange; the caller renders `trigger` (a plain Button) and owns
// its onClick, so fireEvent.click drives it (ADR-012 invariant 3). `contentClassName`
// lets a caller widen the default `w-80` when its content genuinely needs it
// (e.g. the History popover's entries + preview controls, #16/#17).
export function Popover({
  open,
  onOpenChange,
  trigger,
  align = "end",
  contentClassName,
  collisionPadding,
  anchor,
  onCloseAutoFocus,
  label,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  align?: "start" | "center" | "end";
  contentClassName?: string;
  // How close to the viewport edge Radix may place the content before it
  // flips or shifts. Optional and defaulted to `undefined` on purpose: passing
  // it through unset leaves Radix on its own default, so every caller that
  // does not ask for it renders exactly as before.
  collisionPadding?: number;
  /**
   * Somewhere else to hang the content from, while the trigger is not on
   * screen. The phone's trip header hides History's own button and opens it
   * from its overflow menu, so the panel is anchored to that menu instead of
   * to a `display: none` box at (0, 0). Absent, the trigger is the anchor.
   */
  anchor?: React.ReactNode;
  /**
   * Where focus goes when the content closes. Radix returns it to the
   * trigger; a caller whose trigger is off screen (see `anchor`) calls
   * `event.preventDefault()` and focuses what it opened from instead.
   */
  onCloseAutoFocus?: (event: Event) => void;
  /**
   * The open panel's accessible name, when its trigger's name is not the
   * right one. Absent, the panel is named BY its trigger (see below).
   */
  label?: string;
  children: React.ReactNode;
}) {
  // **Every popover is a named dialog.** Radix gives the content
  // `role="dialog"` and no name, and an unnamed dialog fails axe
  // `aria-dialog-name` — the desktop Notebooks menu did, and so did every
  // other caller of this primitive. The trigger already says what the panel
  // is ("Notebooks", "History", "Filters · 2"), so by default the content is
  // labelled by it; Radix's `Slot` puts the id on the caller's own button.
  // `aria-labelledby` resolves the trigger's `aria-label` too, and still works
  // while the trigger is hidden behind an `anchor`.
  const triggerId = useId();
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild id={triggerId}>
        {trigger}
      </RadixPopover.Trigger>
      {anchor !== undefined && <RadixPopover.Anchor asChild>{anchor}</RadixPopover.Anchor>}
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          sideOffset={6}
          collisionPadding={collisionPadding}
          onCloseAutoFocus={onCloseAutoFocus}
          aria-label={label}
          aria-labelledby={label === undefined ? triggerId : undefined}
          className={cn(
            "overlay-layer w-80 rounded-lg border border-hairline bg-surface p-3 shadow-overlay",
            contentClassName,
          )}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
