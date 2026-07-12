"use client";
import * as RadixPopover from "@radix-ui/react-popover";

// Anchored, small: never pushes page content down (design-system.md). Controlled
// via open/onOpenChange; the caller renders `trigger` (a plain Button) and owns
// its onClick, so fireEvent.click drives it (ADR-012 invariant 3).
export function Popover({
  open,
  onOpenChange,
  trigger,
  align = "end",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  align?: "start" | "center" | "end";
  children: React.ReactNode;
}) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          sideOffset={6}
          className="z-50 w-80 rounded-lg border border-hairline bg-surface p-3 shadow-overlay"
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
