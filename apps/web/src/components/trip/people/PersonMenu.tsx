"use client";

import { Fragment, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";

/** One thing the reader may do to a row. */
export type PersonAction = { label: string; onSelect: () => void; destructive?: boolean };

/**
 * A row's one control: the `⋯` menu (spec §4). Holds only what the reader may
 * do, so a row with nothing to offer renders no trigger at all rather than a
 * menu that opens onto nothing.
 *
 * An action that removes something is listed last, under a hairline, and
 * opens a confirm rather than acting — the caller's `onSelect` does that.
 */
export function PersonMenu({ label, actions }: { label: string; actions: readonly PersonAction[] }) {
  const [open, setOpen] = useState(false);
  if (actions.length === 0) return null;
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${label}`}>
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </MenuTrigger>
      <MenuContent>
        {actions.map((action, i) => (
          <Fragment key={action.label}>
            {action.destructive && i > 0 && !actions[i - 1]!.destructive ? <MenuSeparator /> : null}
            <MenuItem variant={action.destructive ? "destructive" : "default"} onSelect={action.onSelect}>
              {action.label}
            </MenuItem>
          </Fragment>
        ))}
      </MenuContent>
    </Menu>
  );
}
