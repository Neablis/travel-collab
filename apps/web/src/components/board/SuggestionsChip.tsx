"use client";

import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { Text } from "@/components/ui/text";
import { dayLabel } from "@/lib/dates";
import type { Ghost } from "@/lib/suggestionOverlay";
import { useTrip } from "@/components/trip/context/TripProvider";
import { SuggestionActions, useAuthorNames } from "./SuggestionActions";

/**
 * The header's pending-suggestion count (spec §2.4) — the only notification
 * there is (§2.7). It opens EVERY pending change with its actions (W74): the
 * ones drawn on the board first, by day, then the ones the board cannot draw
 * and the ones that no longer apply, and every note sent with them. Nothing at
 * all for a viewer, or with nothing pending.
 *
 * Author names come from `PeopleProvider` (W15), which `TripHeader` mounts.
 */
export function SuggestionsChip() {
  const { suggestionGhosts: ghosts, trip } = useTrip();
  const nameOf = useAuthorNames(ghosts?.pending.map((c) => c.authorId) ?? []);
  const [open, setOpen] = useState(false);
  if (ghosts === null || ghosts.pending.length === 0) return null;

  const count = ghosts.pending.length;
  // One note per suggestion, which every change sent with it carries.
  const notes = [...new Map(ghosts.pending.flatMap((c) => (c.note === null ? [] : [[c.suggestionId, c] as const]))).values()];
  // Mitchell's production test, 2026-10-04: this listed only what the board
  // could not draw, and with every change on the board it said so and offered
  // nothing, so an owner who opened it never found Accept. The ghosts stay
  // where they are; the chip is also the list.
  const dayIndex = new Map((trip?.days ?? []).map((d, i) => [d.dayId, i]));
  const where = (ghost: Ghost) => {
    if (ghost.dayId === null) return "Unscheduled";
    const index = ghost.dayId === undefined ? undefined : dayIndex.get(ghost.dayId);
    return index === undefined ? null : dayLabel(trip?.startDate ?? null, index);
  };
  // By day, then as sent: `sort` is stable and `onBoard` is in creation order.
  const onBoard = [...ghosts.onBoard].sort(
    (a, b) => (dayIndex.get(a.dayId ?? "") ?? Infinity) - (dayIndex.get(b.dayId ?? "") ?? Infinity),
  );
  const listed: { ghost: Ghost; stale: boolean }[] = [
    ...ghosts.offBoard.map((ghost) => ({ ghost, stale: false })),
    ...ghosts.stale.map((ghost) => ({ ghost, stale: true })),
  ];
  const byLine = (authorId: string) => {
    const name = nameOf(authorId);
    return name === null ? null : `Suggested by ${name}`;
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      trigger={
        <Button variant="secondary" size="sm">
          {count === 1 ? "1 suggestion" : `${count} suggestions`}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {notes.map((c) => (
          <Text key={c.suggestionId} as="p" variant="secondary">
            “{c.note}”{byLine(c.authorId) !== null && ` — ${byLine(c.authorId)}`}
          </Text>
        ))}
        {onBoard.length > 0 && (
          <Group label="On the board">
            {onBoard.map((ghost) => (
              <Item key={ghost.changeId} ghost={ghost} detail={where(ghost)} byLine={byLine(ghost.authorId)} />
            ))}
          </Group>
        )}
        {listed.length > 0 && (
          <Group label="Not on the board">
            {listed.map(({ ghost, stale }) => (
              <Item key={ghost.changeId} ghost={ghost} stale={stale} byLine={byLine(ghost.authorId)} />
            ))}
          </Group>
        )}
      </div>
    </Popover>
  );
}

// One group of the list, named so a screen reader hears where its changes are.
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Text as="span" className="text-xs font-semibold uppercase text-slate">
        {label}
      </Text>
      <ul aria-label={`Suggestions ${label.toLowerCase()}`} className="m-0 flex list-none flex-col gap-3 p-0">
        {children}
      </ul>
    </div>
  );
}

function Item({ ghost, stale = false, detail = null, byLine }: { ghost: Ghost; stale?: boolean; detail?: string | null; byLine: string | null }) {
  return (
    <li className="flex flex-col gap-1">
      <Text as="span" className="text-sm text-ink">
        {ghost.description}
      </Text>
      {(detail !== null || byLine !== null) && (
        <Text as="span" variant="muted">
          {[detail, byLine].filter((part) => part !== null).join(" · ")}
        </Text>
      )}
      <SuggestionActions ghost={ghost} stale={stale} />
    </li>
  );
}
