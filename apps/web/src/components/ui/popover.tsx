"use client";
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
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  align?: "start" | "center" | "end";
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          sideOffset={6}
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
