"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

// **Where the palette's commands come from** (M41 D9, ADR-068). The palette is
// mounted once, by `(app)/layout.tsx`, and the actions it runs belong to the
// screens below it: the lens switch and the trip's state to `TripBoardScreen`,
// Trip settings and undo to `TripHeader`, New trip to Home. No context spans
// both, so each screen registers the actions its own controls call, under a
// name of its own, and takes them back when it unmounts. It is
// `phoneAsk.ts`'s arrangement, which the tab bar's Ask already uses, with a
// list per screen in place of its single entry.
//
// A screen never writes a command's behaviour here: it hands over the function
// its button calls (ADR-068 §1), so a palette command cannot drift from the
// control it stands for.
//
// What a screen registers is a flat list of leaves, each carrying its whole
// path (ADR-069). The drill-in tree is derived from their shared prefixes
// (`grammar.ts`), so no screen owns a branch and none can leave one empty.

/** The palette's verbs (ADR-069 §1), a closed set: every path starts with one. */
export type PaletteAction = "Go to" | "Add" | "Edit" | "Move" | "Remove";
/** The only commands with no Type or Target (ADR-069 §1). */
export type PaletteSingleton = "Undo" | "Redo" | "Ask the assistant";
/** What kind of thing a path's Target is (ADR-069 §1). */
export type PaletteType = "Trip" | "Day" | "Stop" | "View" | "Notebook" | "Page";

/** A Target or Destination: what it is called, and any other words it answers to. */
export type PaletteSegment = {
  label: string;
  /** Tells apart two segments with one label (two stops called Ramen) so they are two branches; the label when absent. */
  key?: string;
  aliases?: readonly string[];
};

/**
 * How near a command's thing is to where you are, nearest first (ADR-069 §5):
 * the focused stop or day, the selected day, the current trip, anywhere.
 */
export type PaletteNearness = "focused" | "selected" | "trip" | "global";

/**
 * One thing the palette can do: a path, *Action › Type › Target [›
 * Destination]*, or a singleton. `run` is the page control's own function
 * (ADR-068 §1). `nearness` (default `"global"`) and `order` (the natural
 * order — days in day order, trips as Home lists them; default 0, then the
 * order registered) only break ties between equally good matches.
 */
export type PaletteCommand = {
  id: string;
  nearness?: PaletteNearness;
  order?: number;
  /**
   * Runnable by id (`runPaletteCommand`) but never a row: a listed command's
   * place, landing somewhere more exact, so the assistant can name it as one
   * command (ADR-072 §6). A person reaches it by the listed command and then
   * the page's own.
   */
  unlisted?: true;
  run: () => void;
} & (
  | { action: PaletteAction; type: PaletteType; target?: PaletteSegment; destination?: PaletteSegment }
  | { action: PaletteSingleton; type?: never; target?: never; destination?: never }
);

const sources = new Map<string, readonly PaletteCommand[]>();
let snapshot: readonly PaletteCommand[] = [];
const listeners = new Set<() => void>();

function emit() {
  snapshot = [...sources.values()].flat();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Registers `commands` as `source`'s, replacing what `source` had, and returns
 * the call that takes them back. Taking back a list that has since been
 * replaced leaves the newer one.
 */
export function registerPaletteCommands(source: string, commands: readonly PaletteCommand[]): () => void {
  sources.set(source, commands);
  emit();
  return () => {
    if (sources.get(source) !== commands) return;
    sources.delete(source);
    emit();
  };
}

/** Every registered command, screen by screen in the order they registered. */
export function usePaletteCommands(): readonly PaletteCommand[] {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}

/**
 * The registered command with `id`, for running one by name outside the
 * palette (ADR-072 §1): the assistant names a command, never a URL or a
 * handler, and this is the same object ⌘K would run.
 */
export function findPaletteCommand(id: string): PaletteCommand | undefined {
  return snapshot.find((command) => command.id === id);
}

/** Runs the registered command with `id`; false, having run nothing, when no screen offers it. */
export function runPaletteCommand(id: string): boolean {
  const command = findPaletteCommand(id);
  command?.run();
  return command !== undefined;
}

/**
 * Offers `commands` under `source` while the calling component is mounted.
 * They may be fresh objects every render: each registered `run` calls the
 * latest command with its id, so the list is re-registered only when which
 * commands are on offer, or what they are called or how near, changes.
 */
export function usePaletteSource(source: string, commands: readonly PaletteCommand[]): void {
  const latest = useRef(commands);
  useEffect(() => {
    latest.current = commands;
  });
  const shape = JSON.stringify(commands.map((c) => [c.id, c.action, c.type, c.target, c.destination, c.nearness, c.order, c.unlisted]));
  useEffect(() => {
    const offered = latest.current.map((command) => ({
      ...command,
      run: () => latest.current.find((c) => c.id === command.id)?.run(),
    }));
    return registerPaletteCommands(source, offered);
    // `shape` stands for `commands`, which this reads through `latest`: see the JSDoc.
  }, [source, shape]);
}
