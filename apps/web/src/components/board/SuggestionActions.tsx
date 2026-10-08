"use client";

import { type ReactElement, useCallback, useEffect, useId, useMemo, useState } from "react";
import type { ResolveSuggestionChangeInput } from "@tc/contracts";
import { useSessionUser } from "@/components/account/useSessionUser";
import { usePeopleRecheck, usePersonas } from "@/components/pages/people";
import { useTrip } from "@/components/trip/context/TripProvider";
import { Button } from "@/components/ui/button";
import { PersonChip } from "@/components/ui/person-chip";
import { Popover } from "@/components/ui/popover";
import { Text } from "@/components/ui/text";
import type { Ghost } from "@/lib/suggestionOverlay";
import type { BoardSuggestions } from "./DayRiver";

/**
 * Accept, Dismiss and Withdraw for one pending change (spec §2.4, §2.7).
 *
 * Accept and Dismiss are a reviewer's (`boardMode === "write"`); Withdraw is the
 * author's. Every name carries the change's sentence, so the several on screen
 * at once stay distinguishable. A `stale` change (W5: it no longer predicts)
 * has nothing to accept, and says so.
 */
export function SuggestionActions({ ghost, stale = false }: { ghost: Ghost; stale?: boolean }) {
  const { suggestions, boardMode } = useTrip();
  const user = useSessionUser();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const hintId = useId();
  if (suggestions === null) return null;

  const reviewer = boardMode === "write";
  const author = typeof user?.id === "string" && user.id === ghost.authorId;
  // The server refuses an accept while a parent is pending (§2.7); the button
  // says which parent rather than letting the reader find out by a 409.
  const parent = ghost.blockedBy[0];
  const hint =
    parent === undefined ? null : `Accept “${suggestions.changes.find((c) => c.id === parent)?.description ?? "the change it builds on"}” first`;

  const run = async (action: ResolveSuggestionChangeInput["action"]) => {
    setBusy(true);
    setRefusal(null);
    const result = await suggestions.resolve(ghost.changeId, action);
    setBusy(false);
    if (!result.ok) setRefusal(result.error.message);
  };

  if (!reviewer && !author && !stale) return null;
  return (
    <div className="flex flex-col gap-1">
      {stale && (
        <Text as="span" className="text-xs font-semibold text-warning-ink">
          No longer applies
        </Text>
      )}
      <div className="flex flex-wrap gap-1.5">
        {reviewer && !stale && (
          <Button
            variant="primary"
            size="sm"
            disabled={busy || hint !== null}
            aria-describedby={hint === null ? undefined : hintId}
            aria-label={`Accept: ${ghost.description}`}
            onClick={() => void run("accept")}
          >
            Accept
          </Button>
        )}
        {reviewer && (
          <Button variant="secondary" size="sm" disabled={busy} aria-label={`Dismiss: ${ghost.description}`} onClick={() => void run("dismiss")}>
            Dismiss
          </Button>
        )}
        {author && (
          <Button variant="secondary" size="sm" disabled={busy} aria-label={`Withdraw: ${ghost.description}`} onClick={() => void run("withdraw")}>
            Withdraw
          </Button>
        )}
      </div>
      {reviewer && !stale && hint !== null && (
        <Text as="span" id={hintId} className="text-xs text-slate">
          {hint}
        </Text>
      )}
      {refusal !== null && (
        <Text as="span" role="alert" className="text-xs text-danger-ink">
          {refusal}
        </Text>
      )}
    </div>
  );
}

/**
 * What to call a suggestion's author (W15): their name from the trip's member
 * profiles, "a former traveler" once a fresh read (`rechecked`) has not found
 * them, and `null` until then — a guess either way would be wrong for someone.
 */
function authorName(
  people: Readonly<Record<string, string>> | null,
  rechecked: ReadonlySet<string>,
  authorId: string,
): string | null {
  if (people === null) return null;
  return people[authorId] ?? (rechecked.has(authorId) ? "a former traveler" : null);
}

/**
 * `authorName` for these authors, asking `PeopleProvider` to read the members
 * again for any the names do not hold — someone who joined after the names
 * were read is not a former traveler (review of #311, 3.1).
 */
export function useAuthorNames(authorIds: readonly string[]): (authorId: string) => string | null {
  const { names, rechecked, recheck } = usePeopleRecheck();
  // A string, so the effect runs when the set of authors changes, not on
  // every render's new array.
  const ids = [...new Set(authorIds)].sort().join(" ");
  useEffect(() => {
    if (names === null) return;
    for (const id of ids.split(" ")) if (id !== "" && !(id in names)) recheck(id);
  }, [names, ids, recheck]);
  return useCallback((authorId: string) => authorName(names, rechecked, authorId), [names, rechecked]);
}

/**
 * An author's `xs` chip (M38), drawn beside the name `useAuthorNames` gives.
 * Nothing for someone the members do not hold — "a former traveler" has no
 * persona to draw, and a chip of its initials would name nobody.
 */
export function AuthorChip({ authorId }: { authorId: string }) {
  const persona = usePersonas()?.[authorId];
  if (persona === undefined) return null;
  return <PersonChip name={persona.name} avatar={persona.avatar} color={persona.color} size="xs" />;
}

/**
 * `Board`'s `suggestions` prop: ghosts by day and by stop, plus the review
 * popover as a slot (it reads `useTrip()`, and `Board` is props-only).
 * Undefined while previewing a past version, whose board the changes were not
 * drafted against.
 */
export function useBoardSuggestions(): BoardSuggestions | undefined {
  const { suggestionGhosts: ghosts, preview, draft } = useTrip();
  const draftStops = draft?.stops;
  return useMemo(() => {
    if (preview.seq !== null || (ghosts === null && draftStops === undefined)) return undefined;
    // A draft is marked even before the suggestions list has been read.
    const board = ghosts?.board ?? { days: new Map(), stops: new Map() };
    return { ...board, draft: draftStops, review: (list, trigger) => <SuggestionReview ghosts={list} trigger={trigger} /> };
  }, [ghosts, preview.seq, draftStops]);
}

// A popover rather than buttons on the block: a 30-minute block is 22px tall,
// and three labelled buttons do not fit on it.
function SuggestionReview({ ghosts, trigger }: { ghosts: readonly Ghost[]; trigger: ReactElement }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} trigger={trigger} align="start">
      <ul aria-label="Suggested changes" className="m-0 flex list-none flex-col gap-3 p-0">
        {ghosts.map((ghost) => (
          <li key={ghost.changeId} className="flex flex-col gap-1.5">
            <Text as="span" className="text-sm text-ink">
              {ghost.description}
            </Text>
            <SuggestionActions ghost={ghost} />
          </li>
        ))}
      </ul>
    </Popover>
  );
}
