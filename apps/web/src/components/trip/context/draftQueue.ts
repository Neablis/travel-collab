import { SUGGESTION_UNIT_COMMANDS_MAX, type BatchableCommand, type TripDetail } from "@tc/contracts";
import { predictBatch } from "@tc/predict";
import { activityTargets } from "./concurrentEdits";
import { adoptOutcome, enqueue, type EnqueueResult, type OptimisticState, type PendingUnit } from "./optimistic";

/**
 * Queue a suggester's gesture onto their draft (W75; Mitchell's production
 * test, 2026-10-04: he added a stop, moved it, and the tray said "2 changes
 * not sent").
 *
 * A gesture whose every command is an edit, move or removal of stops ONE
 * earlier unit of this draft added is folded into that unit rather than
 * queued as its own. Each unit becomes one change (W1), so the reviewer sees
 * "Added X; Moved X to Day 2" as one thing they accept or dismiss. The
 * server's dry run and accept already replay a unit's commands in order as one
 * batch, so an add followed by its edits is a unit like any other.
 *
 * A removal of such a stop drops the unit that added it instead, when that
 * unit touches nothing else: the draft nets nothing. Where it touches more, the
 * removal is folded in like any edit.
 *
 * Folding moves a gesture earlier in the replay, so it is done only where that
 * cannot change the result, and otherwise the gesture is queued as before:
 *
 * - the folded unit stays within {@link SUGGESTION_UNIT_COMMANDS_MAX}. Past it
 *   the gesture is its own change, rather than compacting edits: the domain
 *   has no "latest state of this stop" command to collapse them into;
 * - the folded draft predicts cleanly, and to the same trip the unfolded one
 *   would. The board shows the draft's end state, so it must not depend on how
 *   the draft was grouped. This one check is also what keeps a removal from
 *   dropping an add a later unit still names — a reorder that also moved an
 *   existing stop, which depends on the add server-side (W9): without the add
 *   that unit no longer predicts. And it sees what no rule on ids could, such
 *   as a `position` in a day an intervening unit also reordered.
 */
export function enqueueDraft(state: OptimisticState, id: string, commands: BatchableCommand[]): EnqueueResult {
  const plain = enqueue(state, id, commands);
  if (!plain.ok) return plain;
  const pending = folded(state.pending, commands);
  if (pending === null) return plain;
  const next = adoptOutcome({ ...state, pending }, state.confirmed);
  const end = lastPrediction(next);
  if (end === null || !sameTrip(end, lastPrediction(plain.state))) return plain;
  return { ok: true, state: next };
}

const STOP_EDITS = new Set<BatchableCommand["type"]>(["UpdateActivity", "MoveActivity", "RemoveActivity"]);

/** The draft with `commands` folded into the unit that added their stops, or null where that does not apply. */
function folded(pending: readonly PendingUnit[], commands: BatchableCommand[]): PendingUnit[] | null {
  if (!commands.every((c) => STOP_EDITS.has(c.type))) return null;
  const stops = activityTargets(commands);
  const owner = pending.findIndex((u) => u.commands.some((c) => c.type === "AddActivity" && stops.includes(c.activityId)));
  if (owner === -1) return null;
  const adds = new Set(pending[owner]!.commands.flatMap((c) => (c.type === "AddActivity" ? [c.activityId] : [])));
  if (!stops.every((s) => adds.has(s))) return null;

  const unit = pending[owner]!;
  const removesAll = commands.every((c) => c.type === "RemoveActivity");
  if (removesAll && activityTargets(unit.commands).every((s) => stops.includes(s))) {
    return pending.filter((_, i) => i !== owner);
  }
  if (unit.commands.length + commands.length > SUGGESTION_UNIT_COMMANDS_MAX) return null;
  return pending.map((u, i) => (i === owner ? { ...u, commands: [...u.commands, ...commands] } : u));
}

/** The stops a draft adds, and the stops already on the trip it changes (W76). */
export type DraftStops = { added: ReadonlySet<string>; changed: ReadonlySet<string> };

/**
 * The stops `pending` adds, and the other stops it names, which the board
 * marks "Not sent". Read off the commands rather than predicted, so a stop the
 * draft both adds and later edits is added, not changed.
 */
export function draftStops(pending: readonly PendingUnit[]): DraftStops {
  const added = new Set(pending.flatMap((u) => u.commands.flatMap((c) => (c.type === "AddActivity" ? [c.activityId] : []))));
  const changed = new Set(pending.flatMap((u) => activityTargets(u.commands)).filter((id) => !added.has(id)));
  return { added, changed };
}

/**
 * The trip the whole draft ends at, as the client predicts it, or null when
 * some unit no longer predicts (KI-42). An emptied draft ends at the confirmed
 * trip, replayed through the same projection rather than read as the server
 * sent it: the server's conflict context is not the client's, so the two would
 * differ on a trip neither draft changed.
 */
function lastPrediction(state: OptimisticState): TripDetail | null {
  if (state.pending.some((u) => u.predictedDetail === null)) return null;
  const last = state.pending.at(-1);
  if (last) return last.predictedDetail;
  const replayed = predictBatch(state.confirmed.detail, []);
  return replayed.ok ? replayed.detail : null;
}

// Structural, ignoring key order: the activities record is keyed by id, and
// two replays may insert the same stops in a different order.
function sameTrip(a: TripDetail, b: TripDetail | null): boolean {
  return b !== null && canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : v,
  );
}
