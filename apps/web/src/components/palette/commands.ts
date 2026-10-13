import { VIEWS, type View } from "@/components/trip/context/LensRouter";
import type { TripDetail } from "@tc/contracts";
import type { SettingsSection } from "@/lib/tripSettingsLink";
import type { PaletteCommand, PaletteNearness } from "./paletteRegistry";

// **The palette's commands, as lists of the page's own actions** (ADR-068 §1).
// Every builder here takes the function a page control already calls and
// names it; none of them does anything itself. A command that needed its own
// behaviour would be a second way to do the thing, which is the drift ADR-068
// exists to stop: add the action to the page first, then list it here.
//
// Each builder is called by the screen that owns the action, which registers
// the result (`usePaletteSource`).
//
// The command set is ADR-069 §4's; each screen registers the part it owns
// the action for (TripBoardScreen the trip's days, stops and notebooks,
// TripHeader its settings and History, Home *Add › Trip*, the palette itself
// the places, the notebook page its editing toggle).

/** The trip's lenses, by the lens switcher's own `setView`. */
export function lensCommands(setView: (view: View) => void): PaletteCommand[] {
  return VIEWS.map((view, order) => ({ id: `view:${view}`, action: "Go to", type: "View", target: { label: view }, nearness: "trip", order, run: () => setView(view) }));
}

/** *Add › Stop*, by the editor's `openCreate` with what the screen would prefill. */
export function newStopCommand(openNewStop: () => void): PaletteCommand {
  return { id: "new-stop", action: "Add", type: "Stop", nearness: "trip", order: 0, run: openNewStop };
}

/** *Add › Day*, by the board's own *One more day*. */
export function addDayCommand(addDay: () => void): PaletteCommand {
  return { id: "add-day", action: "Add", type: "Day", nearness: "trip", order: 1, run: addDay };
}

/** Undo and redo, by the History controls' own handlers, offered only when each can run. */
export function undoRedoCommands(actions: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}): PaletteCommand[] {
  return [
    ...(actions.canUndo ? [{ id: "undo", action: "Undo" as const, nearness: "trip" as const, order: 0, run: actions.onUndo }] : []),
    ...(actions.canRedo ? [{ id: "redo", action: "Redo" as const, nearness: "trip" as const, order: 1, run: actions.onRedo }] : []),
  ];
}

/**
 * *Edit › Trip › Settings / People / Cover / Sharing*, by the header's one
 * opener, at its top or at that section. Sharing is the snapshots section,
 * offered only to someone who may share.
 */
export function tripSettingsCommands(openSettings: (section: SettingsSection | null) => void, canShare: boolean): PaletteCommand[] {
  const at = (id: string, label: string, section: SettingsSection | null, order: number): PaletteCommand => ({
    id,
    action: "Edit",
    type: "Trip",
    target: { label },
    nearness: "trip",
    order,
    run: () => openSettings(section),
  });
  return [at("settings", "Settings", null, 0), at("people", "People", "people", 1), at("cover", "Cover", "cover", 2), ...(canShare ? [at("share", "Sharing", "share", 3)] : [])];
}

/** *Ask the assistant*, by the opener the assistant's own controls use. */
export function askCommand(openAssistant: () => void): PaletteCommand {
  return { id: "ask", action: "Ask the assistant", nearness: "global", run: openAssistant };
}

/** *Open chat*, by the opener the header's 💬 calls (M46). */
export function chatCommand(openChat: () => void): PaletteCommand {
  return { id: "chat", action: "Open chat", nearness: "trip", run: openChat };
}

/** *Add › Trip*, by Home's own New trip button. */
export function newTripCommand(startNewTrip: () => void): PaletteCommand {
  return { id: "new-trip", action: "Add", type: "Trip", nearness: "global", run: startNewTrip };
}

/**
 * The app's pages and the person's trips, by the router the header's links
 * use. `trips` come in the order Home lists them, which is their order here.
 * Each trip also has an unlisted `go:trip:<tripId>:view:<View>` per view,
 * landing on the `?view=` the trip page reads for every view (ADR-072 §6).
 */
export function placeCommands(go: (href: string) => void, trips: readonly { tripId: string; name: string }[]): PaletteCommand[] {
  return [
    { id: "go:home", action: "Go to", type: "Page", target: { label: "Home" }, nearness: "global", order: 0, run: () => go("/") },
    { id: "go:playbooks", action: "Go to", type: "Page", target: { label: "Playbooks" }, nearness: "global", order: 1, run: () => go("/playbooks") },
    { id: "go:account", action: "Go to", type: "Page", target: { label: "Account" }, nearness: "global", order: 2, run: () => go("/account") },
    ...trips.flatMap((trip, order) => {
      const toTrip = { action: "Go to" as const, type: "Trip" as const, target: { key: trip.tripId, label: trip.name }, nearness: "global" as const, order };
      return [
        { ...toTrip, id: `go:trip:${trip.tripId}`, run: () => go(`/trips/${trip.tripId}`) },
        ...VIEWS.map((view) => ({ ...toTrip, id: `go:trip:${trip.tripId}:view:${view}`, unlisted: true as const, run: () => go(`/trips/${trip.tripId}?view=${view}`) })),
      ];
    }),
  ];
}

/**
 * *Go to › Notebook › <title>*, by the Notebooks menu's own destination. In
 * the order the menu lists them.
 */
export function goToNotebookCommands(notebooks: readonly { id: string; title: string }[], openNotebook: (pageId: string) => void): PaletteCommand[] {
  return notebooks.map((notebook, order) => ({
    id: `go:notebook:${notebook.id}`,
    action: "Go to",
    type: "Notebook",
    target: { key: notebook.id, label: notebook.title },
    nearness: "trip",
    order,
    run: () => openNotebook(notebook.id),
  }));
}

/** *Edit › Notebook › Turn editing on/off*, by the toolbar's Edit page toggle, named for what it will do. */
export function notebookEditingCommand(editing: boolean, toggleEditing: () => void): PaletteCommand {
  return { id: "notebook-editing", action: "Edit", type: "Notebook", target: { label: editing ? "Turn editing off" : "Turn editing on" }, nearness: "trip", run: toggleEditing };
}

/** A day of this trip as every command names it, in day order. */
export type PaletteDay = { dayId: string; label: string; nearness: PaletteNearness; hasStops: boolean };
/** A stop of this trip as every command names it, by day and then time; `dayId` is null for a parked one. */
export type PaletteStop = { activityId: string; label: string; dayId: string | null; nearness: PaletteNearness };

/**
 * The trip's days and stops as the palette names and ranks them (ADR-069 §4,
 * §5). A day is "Day N", and "Day N · Rome · Ostia" when its stops name
 * cities, so a city is typeable: that is how *Move › Day* took over from the
 * Calendar city cards' commands. A stop is its title; a second stop with the
 * same title gets its day after it ("Ramen · Day 2"), which is all the label
 * needs, since the key (its id) already keeps the two apart.
 *
 * Nearest first: the stop or day focus is in, then the selected day and its
 * stops, then the rest of the trip.
 */
export function tripTargets(
  trip: Pick<TripDetail, "days" | "backlog" | "activities">,
  where: { focusedActivityId: string | null; focusedDayId: string | null; selectedDayId: string | null },
): { days: PaletteDay[]; stops: PaletteStop[] } {
  const dayTag = (dayId: string | null) => (dayId === null ? "Unscheduled" : `Day ${trip.days.findIndex((d) => d.dayId === dayId) + 1}`);
  const days = trip.days.map((day, index): PaletteDay => {
    const cities = [...new Set(day.activityIds.flatMap((id) => trip.activities[id]?.location?.city ?? []))];
    return {
      dayId: day.dayId,
      label: [`Day ${index + 1}`, ...cities].join(" · "),
      nearness: day.dayId === where.focusedDayId ? "focused" : day.dayId === where.selectedDayId ? "selected" : "trip",
      hasStops: day.activityIds.length > 0,
    };
  });
  // Timed stops by their start, untimed after them in the day's own order.
  const byTime = (ids: readonly string[]) =>
    ids
      .map((id, position) => ({ id, start: trip.activities[id]?.timeWindow?.start ?? "24:00", position }))
      .sort((a, b) => a.start.localeCompare(b.start) || a.position - b.position)
      .map(({ id }) => id);
  const placed = [...trip.days.flatMap((day) => byTime(day.activityIds).map((id) => ({ id, dayId: day.dayId as string | null }))), ...trip.backlog.map((id) => ({ id, dayId: null }))];
  const titled = placed.flatMap(({ id, dayId }) => {
    const activity = trip.activities[id];
    return activity === undefined ? [] : [{ activityId: id, dayId, title: activity.title.trim() || "Untitled stop" }];
  });
  const stops = titled.map(({ activityId, dayId, title }): PaletteStop => ({
    activityId,
    dayId,
    label: titled.filter((other) => other.title === title).length > 1 ? `${title} · ${dayTag(dayId)}` : title,
    nearness: activityId === where.focusedActivityId ? "focused" : dayId !== null && dayId === where.selectedDayId ? "selected" : "trip",
  }));
  return { days, stops };
}

const dayTarget = (day: PaletteDay) => ({ key: day.dayId, label: day.label });
const stopTarget = (stop: PaletteStop) => ({ key: stop.activityId, label: stop.label });

/** *Go to › Day › <day>*, by the page's `focusDay`. */
export function goToDayCommands(days: readonly PaletteDay[], focusDay: (dayId: string) => void): PaletteCommand[] {
  return days.map((day, order) => ({ id: `go:day:${day.dayId}`, action: "Go to", type: "Day", target: dayTarget(day), nearness: day.nearness, order, run: () => focusDay(day.dayId) }));
}

/** *Go to › Stop › <stop>*, by the page's `focusActivity`; a parked stop is on no day to go to. */
export function goToStopCommands(stops: readonly PaletteStop[], focusActivity: (activityId: string) => void): PaletteCommand[] {
  return stops.flatMap((stop, order) =>
    stop.dayId === null
      ? []
      : [{ id: `go:stop:${stop.activityId}`, action: "Go to" as const, type: "Stop" as const, target: stopTarget(stop), nearness: stop.nearness, order, run: () => focusActivity(stop.activityId) }],
  );
}

/** *Edit › Stop › <stop>*, by the editor's `openEdit`, what a click on its card does. */
export function editStopCommands(stops: readonly PaletteStop[], openEdit: (activityId: string) => void): PaletteCommand[] {
  return stops.map((stop, order) => ({ id: `edit:stop:${stop.activityId}`, action: "Edit", type: "Stop", target: stopTarget(stop), nearness: stop.nearness, order, run: () => openEdit(stop.activityId) }));
}

/** *Remove › Stop › <stop>*, by the board's own `removeActivity`, its ✕. */
export function removeStopCommands(stops: readonly PaletteStop[], removeActivity: (activityId: string) => void): PaletteCommand[] {
  return stops.map((stop, order) => ({ id: `remove:stop:${stop.activityId}`, action: "Remove", type: "Stop", target: stopTarget(stop), nearness: stop.nearness, order, run: () => removeActivity(stop.activityId) }));
}

/** *Remove › Day › <day>*, by the board's own `removeDay`, its day header's ✕. */
export function removeDayCommands(days: readonly PaletteDay[], removeDay: (dayId: string) => void): PaletteCommand[] {
  return days.map((day, order) => ({ id: `remove:day:${day.dayId}`, action: "Remove", type: "Day", target: dayTarget(day), nearness: day.nearness, order, run: () => removeDay(day.dayId) }));
}

// Each Move leaf's `order` puts its target first and its destination second,
// so the targets keep their natural order and each one's destinations theirs.
const moveOrder = (target: number, destination: number, destinations: number) => target * (destinations + 1) + destination;

/**
 * *Move › Stop › <stop> › <day or Unscheduled>*, by the board's own
 * `moveActivity` — what a drop on that day's column does — with `null` for
 * the rack. A stop is not offered the place it already is.
 */
export function moveStopCommands(
  stops: readonly PaletteStop[],
  days: readonly PaletteDay[],
  moveActivity: (activityId: string, toDayId: string | null) => void,
): PaletteCommand[] {
  const places = [...days.map((day) => ({ dayId: day.dayId as string | null, segment: dayTarget(day) })), { dayId: null, segment: { key: "unscheduled", label: "Unscheduled" } }];
  return stops.flatMap((stop, s) =>
    places.flatMap((to, d) =>
      to.dayId === stop.dayId
        ? []
        : [
            {
              id: `move:stop:${stop.activityId}:${to.segment.key}`,
              action: "Move" as const,
              type: "Stop" as const,
              target: stopTarget(stop),
              destination: to.segment,
              nearness: stop.nearness,
              order: moveOrder(s, d, places.length),
              run: () => moveActivity(stop.activityId, to.dayId),
            },
          ],
    ),
  );
}

/**
 * *Move › Day › <day> › <another day, or a new day after the last>*, by the
 * day-header drag's own `moveDay` (PR 395 review: a day's stops moved only by
 * a drag), with `null` for the new day. One batch, so one History entry. Only
 * a day with stops is offered: moving none would change nothing.
 */
export function moveDayCommands(days: readonly PaletteDay[], moveDay: (fromDayId: string, toDayId: string | null) => void): PaletteCommand[] {
  const last = days.length;
  const places = [...days.map((day) => ({ dayId: day.dayId as string | null, segment: dayTarget(day) })), { dayId: null, segment: { key: "new", label: `New day after Day ${last}` } }];
  return days.flatMap((day, s) =>
    day.hasStops
      ? places.flatMap((to, d) =>
          to.dayId === day.dayId
            ? []
            : [
                {
                  id: `move:day:${day.dayId}:${to.segment.key}`,
                  action: "Move" as const,
                  type: "Day" as const,
                  target: dayTarget(day),
                  destination: to.segment,
                  nearness: day.nearness,
                  order: moveOrder(s, d, places.length),
                  run: () => moveDay(day.dayId, to.dayId),
                },
              ],
        )
      : [],
  );
}
