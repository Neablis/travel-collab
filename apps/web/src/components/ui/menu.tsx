"use client";
import { createContext, useContext } from "react";
import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

type MenuState = { open: boolean; onOpenChange: (open: boolean) => void };

const MenuStateContext = createContext<MenuState | null>(null);

/**
 * A dropdown of actions. Controlled, like every overlay here: the caller owns
 * `open`, and `MenuTrigger` toggles it on a plain click (ADR-012 invariant 3).
 */
export function Menu({ open, onOpenChange, children }: MenuState & { children: React.ReactNode }) {
  return (
    <MenuStateContext.Provider value={{ open, onOpenChange }}>
      <RadixMenu.Root open={open} onOpenChange={onOpenChange}>
        {children}
      </RadixMenu.Root>
    </MenuStateContext.Provider>
  );
}

/**
 * Wraps the caller's button. Use a `Button`: it already carries the phone's
 * 44px floor, so the trigger needs nothing of its own for `min-h-11`.
 */
export function MenuTrigger({ children }: { children: React.ReactElement }) {
  const state = useContext(MenuStateContext);
  if (state === null) throw new Error("MenuTrigger must be inside a Menu");
  return (
    <RadixMenu.Trigger
      asChild
      // Radix opens on pointerdown, which a synthetic click never sends, so a
      // test's fireEvent.click would silently open nothing (ADR-012 invariant
      // 3). Cancelling it here hands the pointer to onClick instead — and
      // Radix itself cancels this same event when it opens, so focus behaves
      // as it would have. Keyboard opening (Enter, Space, ArrowDown) stays
      // Radix's, and it cancels those keys so no second, native click follows.
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => state.onOpenChange(!state.open)}
    >
      {children}
    </RadixMenu.Trigger>
  );
}

/**
 * The menu's panel, portalled and anchored to the trigger. `align="end"` by
 * default because the trigger is a row's trailing `⋯`.
 */
export function MenuContent({
  className,
  align = "end",
  sideOffset = 6,
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof RadixMenu.Content>) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "overlay-layer min-w-48 rounded-lg border border-hairline bg-surface p-1 shadow-overlay",
          className,
        )}
        {...props}
      />
    </RadixMenu.Portal>
  );
}

const menuItemVariants = cva(
  // `min-h-11 md:min-h-0`: SPEC §13.1's phone floor, released at the same
  // 768px line `Button`'s base uses.
  "flex min-h-11 w-full cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 md:min-h-0",
  {
    variants: {
      variant: {
        default: "text-ink data-[highlighted]:bg-moss",
        destructive: "text-danger-ink data-[highlighted]:bg-danger-tint",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

/**
 * One action. `onSelect` runs it and the menu closes; `variant="destructive"`
 * marks one that removes something (and should open a confirm, not act).
 */
export function MenuItem({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof RadixMenu.Item> & VariantProps<typeof menuItemVariants>) {
  return <RadixMenu.Item className={cn(menuItemVariants({ variant }), className)} {...props} />;
}

/** A hairline between groups of items. */
export function MenuSeparator({ className, ...props }: React.ComponentProps<typeof RadixMenu.Separator>) {
  return <RadixMenu.Separator className={cn("my-1 h-px bg-hairline", className)} {...props} />;
}

/** A non-interactive heading over a group of items. */
export function MenuLabel({ className, ...props }: React.ComponentProps<typeof RadixMenu.Label>) {
  return <RadixMenu.Label className={cn("px-2.5 pt-2 pb-1 text-xs font-semibold text-slate", className)} {...props} />;
}
