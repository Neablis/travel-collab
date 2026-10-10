import { VIEWS, type View } from "@/components/trip/context/LensRouter";
import type { PaletteCommand } from "./paletteRegistry";

// **The palette's commands, as lists of the page's own actions** (ADR-068 §1).
// Every builder here takes the function a page control already calls and
// names it; none of them does anything itself. A command that needed its own
// behaviour would be a second way to do the thing, which is the drift ADR-068
// exists to stop: add the action to the page first, then list it here.
//
// Each builder is called by the screen that owns the action, which registers
// the result (`usePaletteSource`).

/** The trip's lenses, by the lens switcher's own `setView`. */
export function lensCommands(setView: (view: View) => void): PaletteCommand[] {
  return VIEWS.map((view) => ({ id: `view:${view}`, label: view, group: "Go to", keywords: ["lens", "view"], run: () => setView(view) }));
}

/** *New stop*, by the editor's `openCreate` with what the screen would prefill. */
export function newStopCommand(openNewStop: () => void): PaletteCommand {
  return { id: "new-stop", label: "New stop", group: "Do", keywords: ["add", "activity", "create"], run: openNewStop };
}

/** Undo and redo, by the History controls' own handlers, offered only when each can run. */
export function undoRedoCommands(actions: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}): PaletteCommand[] {
  return [
    ...(actions.canUndo ? [{ id: "undo", label: "Undo", group: "Do" as const, keywords: ["back", "revert"], run: actions.onUndo }] : []),
    ...(actions.canRedo ? [{ id: "redo", label: "Redo", group: "Do" as const, run: actions.onRedo }] : []),
  ];
}

/** Trip settings, and Share as its snapshots section, by the header's own opener. */
export function tripSettingsCommands(openSettings: (section: "share" | null) => void, canShare: boolean): PaletteCommand[] {
  return [
    { id: "settings", label: "Trip settings", group: "Go to", keywords: ["dates", "people", "currency"], run: () => openSettings(null) },
    ...(canShare
      ? [{ id: "share", label: "Share", group: "Do" as const, keywords: ["link", "snapshot"], run: () => openSettings("share") }]
      : []),
  ];
}

/** *Ask the assistant*, by the opener the assistant's own controls use. */
export function askCommand(openAssistant: () => void): PaletteCommand {
  return { id: "ask", label: "Ask the assistant", group: "Do", keywords: ["ai", "chat", "help"], run: openAssistant };
}

/** *New trip*, by Home's own New trip button. */
export function newTripCommand(startNewTrip: () => void): PaletteCommand {
  return { id: "new-trip", label: "New trip", group: "Do", keywords: ["create", "plan"], run: startNewTrip };
}

/** The app's places and the person's trips, by the router the header's links use. */
export function placeCommands(go: (href: string) => void, trips: readonly { tripId: string; name: string }[]): PaletteCommand[] {
  return [
    { id: "go:home", label: "Your trips", group: "Go to", keywords: ["home", "trips"], run: () => go("/") },
    { id: "go:playbooks", label: "Playbooks", group: "Go to", keywords: ["discover", "ideas"], run: () => go("/playbooks") },
    { id: "go:account", label: "Account", group: "Go to", keywords: ["settings", "profile"], run: () => go("/account") },
    ...trips.map((trip) => ({ id: `go:trip:${trip.tripId}`, label: trip.name, group: "Go to" as const, keywords: ["trip"], run: () => go(`/trips/${trip.tripId}`) })),
  ];
}

/** Where a block of stops can be moved to: `key` is what the move is handed, `label` ends the command's name. */
export type MoveDestination = { key: string; label: string };

/**
 * *Move <what> to <destination>*, one per destination, each by the drag's own
 * move with that destination's `key` (PR 395 review: a block of stops that
 * only a drag could move). A Calendar city card hands over its `onDrop`, a
 * Plan day the day-header drag's `moveDay`; what a key means is theirs.
 */
export function moveStopsCommands(
  source: { id: string; name: string },
  destinations: readonly MoveDestination[],
  move: (key: string) => void,
): PaletteCommand[] {
  return destinations.map((to) => ({
    id: `move:${source.id}:${to.key}`,
    label: `Move ${source.name} to ${to.label}`,
    group: "Do",
    keywords: ["stops", "day", "drag"],
    run: () => move(to.key),
  }));
}
