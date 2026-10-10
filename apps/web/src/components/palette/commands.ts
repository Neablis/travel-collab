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
//
// The paths below are ADR-069's grammar put on the v1 command set as it stood,
// unchanged in what each one does; the grammar's full command set replaces
// them (M41, PR 398).

/** The trip's lenses, by the lens switcher's own `setView`. */
export function lensCommands(setView: (view: View) => void): PaletteCommand[] {
  return VIEWS.map((view, order) => ({ id: `view:${view}`, action: "Go to", type: "View", target: { label: view }, nearness: "trip", order, run: () => setView(view) }));
}

/** *New stop*, by the editor's `openCreate` with what the screen would prefill. */
export function newStopCommand(openNewStop: () => void): PaletteCommand {
  return { id: "new-stop", action: "Add", type: "Stop", nearness: "trip", run: openNewStop };
}

/** Undo and redo, by the History controls' own handlers, offered only when each can run. */
export function undoRedoCommands(actions: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}): PaletteCommand[] {
  return [
    ...(actions.canUndo ? [{ id: "undo", action: "Undo" as const, run: actions.onUndo }] : []),
    ...(actions.canRedo ? [{ id: "redo", action: "Redo" as const, run: actions.onRedo }] : []),
  ];
}

/** Trip settings, and Share as its snapshots section, by the header's own opener. */
export function tripSettingsCommands(openSettings: (section: "share" | null) => void, canShare: boolean): PaletteCommand[] {
  return [
    { id: "settings", action: "Edit", type: "Trip", target: { label: "Settings" }, nearness: "trip", order: 0, run: () => openSettings(null) },
    ...(canShare
      ? [{ id: "share", action: "Edit" as const, type: "Trip" as const, target: { label: "Sharing" }, nearness: "trip" as const, order: 1, run: () => openSettings("share") }]
      : []),
  ];
}

/** *Ask the assistant*, by the opener the assistant's own controls use. */
export function askCommand(openAssistant: () => void): PaletteCommand {
  return { id: "ask", action: "Ask the assistant", run: openAssistant };
}

/** *New trip*, by Home's own New trip button. */
export function newTripCommand(startNewTrip: () => void): PaletteCommand {
  return { id: "new-trip", action: "Add", type: "Trip", run: startNewTrip };
}

/** The app's places and the person's trips, by the router the header's links use. */
export function placeCommands(go: (href: string) => void, trips: readonly { tripId: string; name: string }[]): PaletteCommand[] {
  return [
    { id: "go:home", action: "Go to", type: "Page", target: { label: "Home" }, order: 0, run: () => go("/") },
    { id: "go:playbooks", action: "Go to", type: "Page", target: { label: "Playbooks" }, order: 1, run: () => go("/playbooks") },
    { id: "go:account", action: "Go to", type: "Page", target: { label: "Account" }, order: 2, run: () => go("/account") },
    ...trips.map((trip, order) => ({
      id: `go:trip:${trip.tripId}`,
      action: "Go to" as const,
      type: "Trip" as const,
      target: { key: trip.tripId, label: trip.name },
      order,
      run: () => go(`/trips/${trip.tripId}`),
    })),
  ];
}

/** Where a block of stops can be moved to: `key` is what the move is handed, `label` is the Destination's. */
export type MoveDestination = { key: string; label: string };

/**
 * *Move › Day › <what> › <destination>*, one per destination, each by the drag's own
 * move with that destination's `key` (PR 395 review: a block of stops that
 * only a drag could move). A Calendar city card hands over its `onDrop`, a
 * Plan day the day-header drag's `moveDay`; what a key means is theirs.
 */
export function moveStopsCommands(
  source: { id: string; name: string },
  destinations: readonly MoveDestination[],
  move: (key: string) => void,
): PaletteCommand[] {
  return destinations.map((to, order) => ({
    id: `move:${source.id}:${to.key}`,
    action: "Move",
    type: "Day",
    target: { key: source.id, label: source.name },
    destination: { key: to.key, label: to.label },
    nearness: "focused",
    order,
    run: () => move(to.key),
  }));
}
