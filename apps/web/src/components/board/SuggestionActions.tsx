"use client";

import { type ReactElement, useId, useMemo, useState } from "react";
import type { ResolveSuggestionChangeInput, SuggestionChange, TripDetail } from "@tc/contracts";
import { useSessionUser } from "@/components/account/useSessionUser";
import { useTrip } from "@/components/trip/context/TripProvider";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { Text } from "@/components/ui/text";
import { type Ghost, suggestionOverlay } from "@/lib/suggestionOverlay";
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
 * profiles, "a former traveler" once they are not a member, and `null` while
 * the profiles have not landed — a guess either way would be wrong for someone.
 */
export function authorName(people: Readonly<Record<string, string>> | null, authorId: string): string | null {
  if (people === null) return null;
  return people[authorId] ?? "a former traveler";
}

/** Where every pending change shows: on the board, or in the header chip. */
export type SuggestionGhosts = {
  board: Omit<BoardSuggestions, "review">;
  /** One ghost per change the board cannot draw — trip fields, days, the rack, untimed stops. */
  offBoard: Ghost[];
  /** One ghost per change that no longer applies. */
  stale: Ghost[];
  /** Every pending change this reader may see. */
  pending: SuggestionChange[];
};

/**
 * The trip's pending suggestions, placed (spec §2.4). Null for a reader who
 * sees none (`suggestions` is null for `boardMode === "read"`). Runs the
 * overlay on the CONFIRMED trip: a suggester's unsent draft is already their
 * optimistic board, and is not a ghost.
 */
export function useSuggestionGhosts(): SuggestionGhosts | null {
  const { trip, suggestions } = useTrip();
  const changes = suggestions?.changes ?? null;
  return useMemo(() => (trip === null || changes === null ? null : placeGhosts(trip, changes)), [trip, changes]);
}

/**
 * `Board`'s `suggestions` prop: ghosts by day and by stop, plus the review
 * popover as a slot (it reads `useTrip()`, and `Board` is props-only).
 * Undefined while previewing a past version, whose board the changes were not
 * drafted against.
 */
export function useBoardSuggestions(): BoardSuggestions | undefined {
  const ghosts = useSuggestionGhosts();
  const { preview } = useTrip();
  return useMemo(
    () =>
      ghosts === null || preview.seq !== null
        ? undefined
        : { ...ghosts.board, review: (list, trigger) => <SuggestionReview ghosts={list} trigger={trigger} /> },
    [ghosts, preview.seq],
  );
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

// The board draws a change only where it can sit on a river: a timed stop that
// is there now, or a timed stop landing on a day that is there now. Everything
// else goes to the chip, so every pending change is reachable once (W42). A
// change the overlay files as trip-level — a removed day, whose stops it also
// moves to the rack — is shown only in the chip, not as markers too.
function placeGhosts(trip: TripDetail, changes: SuggestionChange[]): SuggestionGhosts {
  const overlay = suggestionOverlay(trip, changes);
  const tripLevel = new Set(overlay.tripLevel.map((g) => g.changeId));
  const days = new Map<string, Ghost[]>();
  const stops = new Map<string, Ghost[]>();
  const drawn = new Set<string>();
  const dayIds = new Set(trip.days.map((d) => d.dayId));
  const onRiver = new Set(trip.days.flatMap((d) => d.activityIds.filter((id) => trip.activities[id]?.timeWindow)));
  const first = new Map<string, Ghost>();

  for (const [activityId, ghosts] of overlay.byActivity) {
    for (const ghost of ghosts) {
      if (!first.has(ghost.changeId)) first.set(ghost.changeId, ghost);
      if (tripLevel.has(ghost.changeId)) continue;
      const lands = (ghost.kind === "add" || ghost.kind === "move") && ghost.activity?.timeWindow;
      if (lands && typeof ghost.dayId === "string" && dayIds.has(ghost.dayId)) {
        days.set(ghost.dayId, [...(days.get(ghost.dayId) ?? []), ghost]);
        drawn.add(ghost.changeId);
      }
      if (ghost.kind !== "add" && onRiver.has(activityId)) {
        stops.set(activityId, [...(stops.get(activityId) ?? []), ghost]);
        drawn.add(ghost.changeId);
      }
    }
  }

  const offBoard = [
    ...overlay.tripLevel,
    ...[...first.values()].filter((g) => !drawn.has(g.changeId) && !tripLevel.has(g.changeId)),
  ];
  return {
    board: { days, stops },
    offBoard,
    stale: overlay.stale,
    pending: changes.filter((c) => c.status === "pending"),
  };
}
