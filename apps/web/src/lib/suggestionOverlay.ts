import type { ActivityView, BatchableCommand, SuggestionChange, TripDetail } from "@tc/contracts";
import { predictBatch } from "@tc/predict";

// Spec W5: ghosts are a pure client overlay. Each pending change is predicted
// with the optimistic queue's own `predictBatch` on the confirmed trip, plus
// the pending changes it depends on, then diffed against that base. It skips a
// no-op sub-command as accepting will (W51), so a change is stale only when
// accepting it would be refused, a change already true throughout included. Nothing
// here is planning state — the server holds no projection of an unaccepted
// change (ADR-063), and neither does this.

export type GhostKind = "add" | "update" | "move" | "remove";

/** One thing a pending change would do, as the board draws it. */
export type Ghost = {
  changeId: string;
  suggestionId: string;
  authorId: string;
  description: string;
  kind: GhostKind;
  /** The stop this ghost is about; absent on trip-level and stale ghosts. */
  activityId?: string;
  /** The stop as it would be — for add, update and move. */
  activity?: ActivityView;
  /**
   * Where it lands (add, move, update) or the day it leaves (remove). `null` is
   * the unscheduled rack, as in `MoveActivity.toDayId`.
   */
  dayId?: string | null;
  dependsOn: string[];
  /** The `dependsOn` changes still pending: this one cannot be accepted first (spec §2.7). */
  blockedBy: string[];
};

/** Every pending change, filed by where the board shows it. */
export type SuggestionOverlay = {
  /** Every ghost about a stop, keyed by that stop — including stops a change adds. */
  byActivity: Map<string, Ghost[]>;
  /** Added stops, keyed by the day they land in; `null` is the rack. */
  byDay: Map<string | null, Ghost[]>;
  /**
   * One ghost per change with no stop on the board to sit on: trip fields,
   * days, and a change whose every stop is itself still only suggested. The
   * header chip lists these (spec §2.4).
   */
  tripLevel: Ghost[];
  /** One ghost per change that no longer predicts: "no longer applies" (§2.7). */
  stale: Ghost[];
};

const ACCEPT_LIKE = { skipNoOps: true };

// Commands that change the trip rather than a stop. AddDay is not here: a new
// day with stops in it shows as those stops, and an empty one falls to
// tripLevel anyway for having nothing else to show.
const TRIP_LEVEL = new Set<BatchableCommand["type"]>([
  "SetTripName",
  "SetTripDates",
  "SetTripStartDate",
  "SetTripCurrency",
  "SetTripBudget",
  "RemoveDay",
]);

/**
 * Where each pending change in `changes` would show on `confirmed`. Pure: it
 * reads `confirmed` and never writes to it. Changes are taken in creation
 * order; anything not pending is ignored.
 */
export function suggestionOverlay(confirmed: TripDetail, changes: SuggestionChange[]): SuggestionOverlay {
  const overlay: SuggestionOverlay = { byActivity: new Map(), byDay: new Map(), tripLevel: [], stale: [] };
  // Stable sort: the server already orders by creation and position, and a
  // tie on `createdAt` (one suggestion's changes share it) keeps that order.
  const pending = changes
    .map((c, i) => [c, i] as const)
    .filter(([c]) => c.status === "pending")
    .sort(([a, i], [b, j]) => a.createdAt.localeCompare(b.createdAt) || i - j)
    .map(([c]) => c);
  const order = new Map(pending.map((c, i) => [c.id, i]));
  const byId = new Map(pending.map((c) => [c.id, c]));
  const confirmedPlacement = placements(confirmed);

  for (const change of pending) {
    const common = {
      changeId: change.id,
      suggestionId: change.suggestionId,
      authorId: change.authorId,
      description: change.description,
      dependsOn: change.dependsOn,
      blockedBy: change.dependsOn.filter((id) => byId.has(id)),
    };

    // The base this change was drafted on: confirmed, plus every pending change
    // it depends on, transitively, in the order they were made. A dependency
    // that is no longer pending is accepted (so already in confirmed) or was
    // resolved away with its dependents (so not here either).
    let base: TripDetail | null = confirmed;
    for (const id of [...ancestors(change, byId)].sort((a, b) => order.get(a)! - order.get(b)!)) {
      const step = predictBatch(base, byId.get(id)!.commands, ACCEPT_LIKE);
      if (!step.ok) {
        base = null;
        break;
      }
      base = step.detail;
    }
    const predicted = base === null ? null : predictBatch(base, change.commands, ACCEPT_LIKE);
    if (base === null || predicted === null || !predicted.ok) {
      overlay.stale.push({ ...common, kind: guessKind(change.commands) });
      continue;
    }

    const ghosts = diff(base, predicted.detail, change.commands).map((g): Ghost => ({ ...common, ...g }));
    for (const ghost of ghosts) {
      push(overlay.byActivity, ghost.activityId!, ghost);
      if (ghost.kind === "add") push(overlay.byDay, ghost.dayId ?? null, ghost);
    }
    // "Anchored" means a stop or a day the reviewer can see on the board now.
    const anchored = ghosts.some((g) =>
      g.kind === "add"
        ? g.dayId === null || confirmedPlacement.days.has(g.dayId!)
        : confirmedPlacement.of.has(g.activityId!),
    );
    if (!anchored || change.commands.some((c) => TRIP_LEVEL.has(c.type))) {
      overlay.tripLevel.push({ ...common, kind: tripKind(change.commands) });
    }
  }
  return overlay;
}

type Placement = { of: Map<string, { dayId: string | null; index: number }>; days: Set<string> };

function placements(detail: TripDetail): Placement {
  const of = new Map<string, { dayId: string | null; index: number }>();
  for (const day of detail.days) day.activityIds.forEach((id, index) => of.set(id, { dayId: day.dayId, index }));
  detail.backlog.forEach((id, index) => of.set(id, { dayId: null, index }));
  return { of, days: new Set(detail.days.map((d) => d.dayId)) };
}

// Classified by the outcome, not the command names, so a unit of several
// commands (W1) shows what it does to each stop. A position change counts as a
// move only for a stop the unit itself moved: removing or adding a stop shifts
// every later neighbour's index, and those neighbours were not suggested.
function diff(base: TripDetail, predicted: TripDetail, commands: BatchableCommand[]): Omit<Ghost, keyof GhostCommon>[] {
  const before = placements(base).of;
  const after = placements(predicted).of;
  const movedByUnit = new Set(commands.flatMap((c) => (c.type === "MoveActivity" ? [c.activityId] : [])));
  const out: Omit<Ghost, keyof GhostCommon>[] = [];
  const ids = new Set([...Object.keys(base.activities), ...Object.keys(predicted.activities)]);
  for (const activityId of ids) {
    const was = base.activities[activityId];
    const now = predicted.activities[activityId];
    const from = before.get(activityId);
    const to = after.get(activityId);
    if (!was && now) {
      out.push({ kind: "add", activityId, activity: now, dayId: to?.dayId ?? null });
    } else if (was && !now) {
      out.push({ kind: "remove", activityId, dayId: from?.dayId ?? null });
    } else if (was && now) {
      const moved =
        (from?.dayId ?? null) !== (to?.dayId ?? null) || (movedByUnit.has(activityId) && from?.index !== to?.index);
      if (moved) out.push({ kind: "move", activityId, activity: now, dayId: to?.dayId ?? null });
      else if (!deepEqual(was, now)) out.push({ kind: "update", activityId, activity: now, dayId: to?.dayId ?? null });
    }
  }
  return out;
}

type GhostCommon = Pick<Ghost, "changeId" | "suggestionId" | "authorId" | "description" | "dependsOn" | "blockedBy">;

function ancestors(change: SuggestionChange, byId: Map<string, SuggestionChange>): Set<string> {
  const seen = new Set<string>();
  const walk = (c: SuggestionChange) => {
    for (const id of c.dependsOn) {
      const parent = byId.get(id);
      if (!parent || seen.has(id)) continue;
      seen.add(id);
      walk(parent);
    }
  };
  walk(change);
  return seen;
}

// A stale change has no outcome to diff, so its kind is read off what it asked
// for — enough for the chip to say "remove" rather than "change".
function guessKind(commands: BatchableCommand[]): GhostKind {
  const first = commands[0]?.type;
  if (first === "AddActivity" || first === "AddDay") return "add";
  if (first === "RemoveActivity" || first === "RemoveDay") return "remove";
  if (first === "MoveActivity") return "move";
  return "update";
}

function tripKind(commands: BatchableCommand[]): GhostKind {
  if (commands.some((c) => c.type === "RemoveDay")) return "remove";
  if (commands.some((c) => c.type === "AddDay")) return "add";
  return "update";
}

function push<K>(map: Map<K, Ghost[]>, key: K, ghost: Ghost): void {
  const list = map.get(key);
  if (list) list.push(ghost);
  else map.set(key, [ghost]);
}

// Structural, and blind to key order and to a key that is present but
// `undefined`: the confirmed stop came over the wire, the predicted one out of
// the reducer, and neither difference is a change anyone made.
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bs = b as unknown[];
    return a.length === bs.length && a.every((x, i) => deepEqual(x, bs[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) if (!deepEqual(ao[k], bo[k])) return false;
  return true;
}

/** Where every pending change shows: on the board, or in the header chip. */
export type SuggestionGhosts = {
  /** Ghosts by the day they land on and by the stop they mark — `Board`'s `suggestions`, less its review slot. */
  board: { days: Map<string, Ghost[]>; stops: Map<string, Ghost[]> };
  /** One ghost per change the board cannot draw — trip fields, days, the rack, untimed stops. */
  offBoard: Ghost[];
  /** One ghost per change that no longer applies. */
  stale: Ghost[];
  /** Every pending change this reader may see. */
  pending: SuggestionChange[];
};

/**
 * The trip's pending suggestions, placed (spec §2.4). `TripProvider` runs it
 * once per list and trip, on the CONFIRMED trip — a suggester's unsent draft
 * is already their optimistic board, and is not a ghost — and the board and
 * the header chip both read that one result.
 */
// The board draws a change only where it can sit on a river: a timed stop that
// is there now, or a timed stop landing on a day that is there now. Everything
// else goes to the chip, so every pending change is reachable once (W42). A
// change the overlay files as trip-level — a removed day, whose stops it also
// moves to the rack — is shown only in the chip, not as markers too.
export function placeGhosts(trip: TripDetail, changes: SuggestionChange[]): SuggestionGhosts {
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
