"use client";

import { useRef, useState, type Ref } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/cn";

// **The cover is its own control** (M49 decision 10, amended by Mitchell on
// 2026-10-25: *"remove the add, remove, change buttons for cover and make a
// more hidden experience"*). No buttons sit on a cover. For whoever may change
// it, hovering it dims it a little and shows a faint *Edit cover ✎*; a click,
// a tap or `Enter` opens one menu of what can be done to it. Everyone else
// gets the photo and nothing to press. With no cover, a faint *+ Add cover*
// stands in (`AddCoverLine`).

export type CoverAction = "change" | "reposition" | "remove";

const LABEL: Record<CoverAction, string> = { change: "Change cover", reposition: "Reposition", remove: "Remove" };

/**
 * The cover's trigger and menu: a button named *Edit cover* laid over the
 * photo (`className` places it), and the menu of `actions`, in the order
 * given. `onAction` runs once the menu has closed, so whatever it opens or
 * focuses is not undone by the menu handing focus back; a menu closed with
 * nothing chosen hands focus to the cover, as `triggerRef` lets a caller do
 * after its own action is done.
 */
export function CoverMenu({
  actions,
  onAction,
  triggerRef,
  caption = "bottom-right",
  className,
}: {
  actions: readonly CoverAction[];
  onAction: (action: CoverAction) => void;
  triggerRef?: Ref<HTMLButtonElement>;
  /** The corner the hover caption sits in, clear of whatever else is on the photo. */
  caption?: "bottom-right" | "top-right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const chosen = useRef<CoverAction | null>(null);
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger>
        <Button
          ref={triggerRef}
          variant="ghost"
          aria-label="Edit cover"
          className={cn(
            "group/cover absolute rounded-none p-0 transition-colors hover:bg-ink/10 focus-visible:bg-ink/10 focus-visible:-outline-offset-2",
            className,
          )}
        >
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute right-3 flex items-center gap-1 rounded-full bg-surface/80 px-2.5 py-1 text-xs font-medium text-slate opacity-0 transition-opacity group-hover/cover:opacity-100 group-focus-visible/cover:opacity-100",
              caption === "top-right" ? "top-3" : "bottom-3",
            )}
          >
            Edit cover
            <Pencil className="size-3" />
          </span>
        </Button>
      </MenuTrigger>
      <MenuContent
        onCloseAutoFocus={(event) => {
          const action = chosen.current;
          chosen.current = null;
          if (action === null) return;
          event.preventDefault();
          onAction(action);
        }}
      >
        {actions.map((action) => (
          <MenuItem
            key={action}
            variant={action === "remove" ? "destructive" : "default"}
            onSelect={() => (chosen.current = action)}
          >
            {LABEL[action]}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

/**
 * Where a cover would be, for whoever may set one: a faint *+ Add cover*,
 * shown by a mouse on hovering the row it sits in (an ancestor marked
 * `group/addcover`; the trip header's top row) or the button itself, and by a
 * keyboard on focus. A touch screen has no hover, so there it stays, faint.
 */
export function AddCoverLine({
  onClick,
  ref,
  className,
}: {
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
  className?: string;
}) {
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn(
        "gap-1 text-slate opacity-70 transition-opacity fine:opacity-0 fine:hover:opacity-70 fine:group-hover/addcover:opacity-70 fine:group-focus-within/addcover:opacity-70 focus-visible:opacity-100 fine:focus-visible:opacity-100",
        className,
      )}
    >
      <Plus className="size-3.5" aria-hidden />
      Add cover
    </Button>
  );
}
