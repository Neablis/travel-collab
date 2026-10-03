"use client";

import { useState } from "react";
import { usePeople } from "@/components/pages/people";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { Text } from "@/components/ui/text";
import type { Ghost } from "@/lib/suggestionOverlay";
import { authorName, SuggestionActions, useSuggestionGhosts } from "./SuggestionActions";

/**
 * The header's pending-suggestion count (spec §2.4) — the only notification
 * there is (§2.7). It opens the changes the board cannot draw and the ones that
 * no longer apply, each with its actions, and every note sent with them.
 * Nothing at all for a viewer, or with nothing pending.
 *
 * Author names come from `PeopleProvider` (W15), which `TripHeader` mounts.
 */
export function SuggestionsChip() {
  const ghosts = useSuggestionGhosts();
  const people = usePeople();
  const [open, setOpen] = useState(false);
  if (ghosts === null || ghosts.pending.length === 0) return null;

  const count = ghosts.pending.length;
  // One note per suggestion, which every change sent with it carries.
  const notes = [...new Map(ghosts.pending.flatMap((c) => (c.note === null ? [] : [[c.suggestionId, c] as const]))).values()];
  const listed: { ghost: Ghost; stale: boolean }[] = [
    ...ghosts.offBoard.map((ghost) => ({ ghost, stale: false })),
    ...ghosts.stale.map((ghost) => ({ ghost, stale: true })),
  ];
  const byLine = (authorId: string) => {
    const name = authorName(people, authorId);
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
        {listed.length === 0 ? (
          <Text as="p" variant="secondary">
            Every suggestion is on the board.
          </Text>
        ) : (
          <ul aria-label="Suggestions not on the board" className="m-0 flex list-none flex-col gap-3 p-0">
            {listed.map(({ ghost, stale }) => (
              <li key={ghost.changeId} className="flex flex-col gap-1">
                <Text as="span" className="text-sm text-ink">
                  {ghost.description}
                </Text>
                {byLine(ghost.authorId) !== null && (
                  <Text as="span" variant="muted">
                    {byLine(ghost.authorId)}
                  </Text>
                )}
                <SuggestionActions ghost={ghost} stale={stale} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popover>
  );
}
