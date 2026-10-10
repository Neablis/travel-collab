"use client";

import { type ReactNode, useId, useState } from "react";
import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { Text } from "@/components/ui/text";
import { acceptAllOrder } from "@/lib/acceptAll";
import { dayLabel } from "@/lib/dates";
import type { Ghost } from "@/lib/suggestionOverlay";
import { useTrip } from "@/components/trip/context/TripProvider";
import { AuthorChip, SuggestionActions, useAuthorNames, withVia } from "./SuggestionActions";

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
  const { suggestionGhosts: ghosts, trip, boardMode, suggestions } = useTrip();
  const nameOf = useAuthorNames(ghosts?.pending.map((c) => c.authorId) ?? []);
  const [open, setOpen] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const noteId = useId();
  if (ghosts === null || ghosts.pending.length === 0) return null;

  // W77, as M40 D1 amends it: every change that still applies, in ONE call,
  // so one History entry and one undo. All or nothing: the server's refusal
  // names the change it is about and says nothing landed.
  const acceptable = acceptAllOrder(ghosts.pending, new Set(ghosts.stale.map((g) => g.changeId)));
  const acceptAll = async () => {
    if (suggestions === null) return;
    setRefusal(null);
    setAccepting(true);
    const result = await suggestions.acceptMany(acceptable.map((c) => c.id));
    setAccepting(false);
    if (!result.ok) setRefusal(result.error.message);
  };

  const count = ghosts.pending.length;
  const phrase = count === 1 ? "1 suggestion" : `${count} suggestions`;
  // One note per suggestion, which every change sent with it carries.
  const notes = [...new Map(ghosts.pending.flatMap((c) => (c.note === null ? [] : [[c.suggestionId, c] as const]))).values()];
  // Mitchell's production test, 2026-10-04: this listed only what the board
  // could not draw, and with every change on the board it said so and offered
  // nothing, so an owner who opened it never found Accept. The ghosts stay
  // where they are; the chip is also the list.
  // A suggested day is numbered after the trip's days, as the board draws it.
  const realDays = trip?.days.length ?? 0;
  const dayIndex = new Map([
    ...(trip?.days ?? []).map((d, i) => [d.dayId, i] as const),
    ...ghosts.newDays.map((g, k) => [g.dayId!, realDays + k] as const),
  ]);
  const where = (ghost: Ghost) => {
    if (ghost.dayId === null) return "Unscheduled";
    const index = ghost.dayId === undefined ? undefined : dayIndex.get(ghost.dayId);
    if (index === undefined) return null;
    const label = dayLabel(trip?.startDate ?? null, index);
    return index < realDays ? label : `${label} · suggested`;
  };
  // By day, then as sent: `sort` is stable and `onBoard` is in creation order.
  const onBoard = [...ghosts.onBoard].sort(
    (a, b) => (dayIndex.get(a.dayId ?? "") ?? Infinity) - (dayIndex.get(b.dayId ?? "") ?? Infinity),
  );
  const listed: { ghost: Ghost; stale: boolean }[] = [
    ...ghosts.offBoard.map((ghost) => ({ ghost, stale: false })),
    ...ghosts.stale.map((ghost) => ({ ghost, stale: true })),
  ];
  const byLine = (ghost: Ghost) => {
    const name = nameOf(ghost.authorId);
    return name === null ? null : withVia(`Suggested by ${name}`, ghost.via);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setRefusal(null);
      }}
      align="end"
      trigger={
        // Add stop's size, beside it in the header (Mitchell's preview
        // comment, 2026-10-04).
        //
        // **Below 768px, a count** (Mitchell, 2026-10-09): the conflict chip's
        // shape and size in the suggestion mark's brand tint and bulb
        // (RiverBlock). Words and conflict chip together left the trip title no
        // room in the phone's pinned row (M39 D9). The phrase is the name at
        // every width, so it is the visible label wherever one is shown.
        <Button
          variant="secondary"
          aria-label={phrase}
          className="max-md:gap-1 max-md:rounded-full max-md:border-0 max-md:bg-brand-tint max-md:px-3 max-md:font-semibold max-md:text-brand-pressed max-md:hover:bg-brand-tint"
        >
          <Lightbulb className="size-4 md:hidden" aria-hidden />
          <span className="md:hidden">{count}</span>
          <span className="max-md:hidden">{phrase}</span>
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Two or more: with one, its own Accept below is the same button. */}
        {boardMode === "write" && (acceptable.length > 1 || accepting) && (
          <Button variant="primary" size="sm" className="self-start" disabled={accepting} onClick={() => void acceptAll()}>
            {accepting ? "Accepting…" : "Accept all"}
          </Button>
        )}
        {refusal !== null && (
          <Text as="p" role="alert" className="text-xs text-danger-ink">
            {refusal}
          </Text>
        )}
        {/* A message from a person, not the app's own copy (W77; Mitchell's
            preview comment, 2026-10-04): set apart in a card, quoted, and
            named for who wrote it. */}
        {notes.map((c) => {
          const name = nameOf(c.authorId);
          const captionId = `${noteId}-${c.suggestionId}`;
          return (
            <figure key={c.suggestionId} aria-labelledby={captionId} className="m-0 rounded-md border border-hairline bg-moss p-3">
              <figcaption id={captionId} className="text-xs font-semibold text-slate">
                {name === null ? "Note" : `Note from ${name}`}
              </figcaption>
              <blockquote className="m-0 mt-1 border-l-2 border-brand pl-2 text-sm whitespace-pre-wrap text-ink">{c.note}</blockquote>
            </figure>
          );
        })}
        {onBoard.length > 0 && (
          <Group label="On the board">
            {onBoard.map((ghost) => (
              <Item key={ghost.changeId} ghost={ghost} detail={where(ghost)} byLine={byLine(ghost)} />
            ))}
          </Group>
        )}
        {listed.length > 0 && (
          <Group label="Not on the board">
            {listed.map(({ ghost, stale }) => (
              <Item key={ghost.changeId} ghost={ghost} stale={stale} byLine={byLine(ghost)} />
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
        // The chip leads the by-line it belongs to, not the day before it.
        <Text as="span" variant="muted" className="flex flex-wrap items-center gap-x-1.5">
          {detail}
          {detail !== null && byLine !== null && <span aria-hidden>·</span>}
          {byLine !== null && (
            <span className="inline-flex items-center gap-1.5">
              <AuthorChip authorId={ghost.authorId} />
              {byLine}
            </span>
          )}
        </Text>
      )}
      <SuggestionActions ghost={ghost} stale={stale} />
    </li>
  );
}
