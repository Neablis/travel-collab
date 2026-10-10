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

/** One thing the palette can do. `run` is the page control's own function. */
export type PaletteCommand = {
  id: string;
  label: string;
  /** "Go to" moves somewhere; "Do" changes or opens something where you are. */
  group: "Go to" | "Do";
  keywords?: readonly string[];
  run: () => void;
};

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
 * Offers `commands` under `source` while the calling component is mounted.
 * They may be fresh objects every render: each registered `run` calls the
 * latest command with its id, so the list is re-registered only when which
 * commands are on offer, or what they are called, changes.
 */
export function usePaletteSource(source: string, commands: readonly PaletteCommand[]): void {
  const latest = useRef(commands);
  useEffect(() => {
    latest.current = commands;
  });
  const shape = commands.map((c) => `${c.id}\u0000${c.label}\u0000${c.group}\u0000${(c.keywords ?? []).join(" ")}`).join("\u0001");
  useEffect(() => {
    const offered = latest.current.map((command) => ({
      ...command,
      run: () => latest.current.find((c) => c.id === command.id)?.run(),
    }));
    return registerPaletteCommands(source, offered);
    // `shape` stands for `commands`, which this reads through `latest`: see the JSDoc.
  }, [source, shape]);
}
