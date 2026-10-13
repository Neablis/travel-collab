"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { PaletteDay, PaletteStop } from "@/components/palette/commands";

// A chat message's day and stop chips (M46 D3) focus the board, and the
// composer's *@day* / *@stop* picker offers the board's days and stops. The
// board owns both — its trip and its `focusDay` / `focusActivity`, the ones
// ⌘K's *Go to* runs — so it registers them here and the chat reads them, on
// `components/nav/phoneAsk.ts`'s model: one entry, the latest registration
// wins, and a board that unmounts takes its entry with it.
//
// **The days and stops are this trip's, and nothing else is.** A message's
// link is an id it carries, and a crafted or pasted one may name another
// trip's day. `resolveLink` looks it up only among the registered board's own
// targets, so such an id finds nothing: no chip, no focus, and no name from
// outside this trip.

/** What the board offers the chat: its days and stops, and how to go to one. */
export type BoardFocus = {
  days: readonly PaletteDay[];
  stops: readonly PaletteStop[];
  focusDay: (dayId: string) => void;
  focusActivity: (activityId: string) => void;
};

/** A message's link resolved on this board: what it is called now, and how to go there. */
export type ResolvedLink = { label: string; focus: () => void };

let entry: BoardFocus | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Registers `next` as the board's focus, answering the call that takes it back; a replaced entry is left alone. */
export function registerBoardFocus(next: BoardFocus): () => void {
  entry = next;
  emit();
  return () => {
    if (entry !== next) return;
    entry = null;
    emit();
  };
}

/** The registered board, or `null` where none is mounted. */
export function useBoardFocus(): BoardFocus | null {
  return useSyncExternalStore(
    subscribe,
    () => entry,
    () => null,
  );
}

/**
 * A link's day or stop on `board`, or `null`: no board, an id that is not this
 * trip's, or a target since deleted. A parked stop is `null` too, as ⌘K's
 * *Go to › Stop* offers none: it is on no day to go to.
 */
export function resolveLink(board: BoardFocus | null, link: { kind: "day" | "stop"; id: string }): ResolvedLink | null {
  if (board === null) return null;
  if (link.kind === "day") {
    const day = board.days.find((d) => d.dayId === link.id);
    return day === undefined ? null : { label: day.label, focus: () => board.focusDay(day.dayId) };
  }
  const stop = board.stops.find((s) => s.activityId === link.id && s.dayId !== null);
  return stop === undefined ? null : { label: stop.label, focus: () => board.focusActivity(stop.activityId) };
}

/**
 * Offers this board to the chat while mounted, `null` targets offering none.
 * The focus functions may be fresh each render: the entry calls the latest,
 * so only the targets changing re-registers.
 */
export function useBoardFocusEntry(
  targets: { days: readonly PaletteDay[]; stops: readonly PaletteStop[] } | null,
  focusDay: (dayId: string) => void,
  focusActivity: (activityId: string) => void,
): void {
  const latest = useRef({ focusDay, focusActivity });
  useEffect(() => {
    latest.current = { focusDay, focusActivity };
  });
  useEffect(() => {
    if (targets === null) return;
    return registerBoardFocus({
      days: targets.days,
      stops: targets.stops,
      focusDay: (dayId) => latest.current.focusDay(dayId),
      focusActivity: (activityId) => latest.current.focusActivity(activityId),
    });
  }, [targets]);
}
