import { randomUUID } from "node:crypto";
import type { BatchableCommand, TripDetail, TripLineage } from "@tc/contracts";
import { diffTripStates, hydrate, type TripState } from "@tc/domain";
import { executeTripCommand, executeTripCommandBatch, type CommandResult } from "./commands";
import { hasAtLeast } from "./accessPolicy";
import { effectiveMembers } from "./access/members";
import { readShareForClone } from "./access/shares";
import { demoTrip } from "./demoTrip";
import { db } from "./db/client";
import { getTripHead } from "./history";
import { getTripDetail } from "./projections";

// Every day and activity id is remapped to a fresh UUID. Reusing source ids
// across streams is the KI-1 hazard (its post-mortem notes fork-with-lineage
// will want to preserve day ids — that is M11's decision to make, not a
// precedent this should set), and it keeps the two streams fully independent.
//
// M11 link 5 made that decision, and it is: NO, ids are not preserved. KI-1's
// own "reachability while it was open" note says preserving day ids across a
// clone is "the obvious implementation" and is exactly what would have made
// that latent diff bug active. The lineage pointer records the relationship
// instead — which is what the relationship actually is, and it costs nothing
// to carry.
function remapIds(state: TripState, tripId: string): TripState {
  const dayIds = new Map(state.days.map((d) => [d.dayId, randomUUID()]));
  const activityIds = new Map(Object.keys(state.activities).map((id) => [id, randomUUID()]));
  const remap = (m: Map<string, string>, id: string): string => m.get(id) ?? id;
  return {
    ...state,
    tripId,
    days: state.days.map((d) => ({
      dayId: remap(dayIds, d.dayId),
      activityIds: d.activityIds.map((id) => remap(activityIds, id)),
    })),
    backlog: state.backlog.map((id) => remap(activityIds, id)),
    activities: Object.fromEntries(
      Object.entries(state.activities).map(([id, a]) => [remap(activityIds, id), a]),
    ),
    // Dismissals are OCCURRENCE-scoped (KI-14) and a fresh trip has had no
    // occurrences; conflict ids also embed the old day/activity ids.
    dismissedConflictIds: [],
  };
}

/**
 * Copy a trip's planning state into a fresh stream owned by `actorId`.
 *
 * `source` is the state to copy — the CURRENT projection when duplicating your
 * own trip, or a REPLAY at the share's pinned seq when cloning a share link.
 * `lineage` is the pointer recorded at genesis: which trip, at which history
 * point, called what at the time (ADR-028).
 */
async function cloneFrom(
  source: TripDetail,
  lineage: TripLineage,
  actorId: string,
  name: string,
): Promise<CommandResult> {
  const tripId = randomUUID();
  const created = await executeTripCommand(
    { type: "CreateTrip", tripId, name, forkedFrom: lineage },
    actorId,
  );
  if (!created.ok) return created;
  // Planning state only. The source's Notebook pages are NOT copied: pages are
  // a separate CRUD module referencing trips by id (ADR-014), and cloning prose
  // is template machinery, which is link 6's bet.

  // diffTripStates was built for exactly this transformation: given an empty
  // state and a target, emit the events that produce the target. Turning those
  // events back into commands keeps the copy inside the normal pipeline.
  //
  // The target's name must be the COPY's name, not the source's. CreateTrip
  // above already set it; if the target still carried the source name the diff
  // would emit a TripNameSet stripping the change straight back off — the copy
  // would silently end up sharing the original's name.
  //
  // `forkedFrom` is taken from the copy's own genesis state for the same
  // reason: the source's lineage (if it was itself a clone) is not this trip's,
  // and lineage is not diffable anyway — no command changes it.
  const empty = hydrate(created.detail);
  const target = { ...remapIds(hydrate(source), tripId), name, forkedFrom: empty.forkedFrom };
  const commands = diffTripStates(empty, target).map((e) => eventToCommand(e, tripId));
  if (commands.length === 0) return created;

  // `CreateTrip` above committed in its OWN transaction — the command pipeline
  // opens one per execution — so by the time the batch runs, the copy already
  // exists. Without compensation a failed batch strands a bare, named
  // "<name> (copy)" trip in the cloner's list with none of the plan in it, and
  // reports an error at the same time (CodeRabbit, PR #70).
  //
  // A compensating DeleteTrip rather than one transaction spanning both: the
  // atomic version means threading an outer transaction through
  // executeTripCommand/executeTripCommandBatch, which is a change to the
  // command pipeline itself (AGENTS.md invariant 1's machinery) and much
  // larger than the defect. This is a soft delete, so the stream survives and
  // the husk is filtered out of every summary read — visible only to a
  // rebuild, which is the correct trace of an attempt that happened.
  //
  // The throw path matters too: `eventToCommand` is total over what an
  // empty→target diff can emit, but it throws by construction if that ever
  // stops being true, and an exception would strand the trip just as a
  // rejection does.
  let batched: CommandResult;
  try {
    batched = await executeTripCommandBatch(commands, actorId);
  } catch (error) {
    await executeTripCommand({ type: "DeleteTrip", tripId }, actorId);
    throw error;
  }
  if (!batched.ok) await executeTripCommand({ type: "DeleteTrip", tripId }, actorId);
  return batched;
}

/**
 * "Duplicate trip" — a copy of a trip you can already see, at its current
 * history point.
 *
 * **A viewer may duplicate, and that is a deliberate decision** (ADR-028), not
 * inherited from the membership-only check this replaced. Cloning creates a
 * NEW stream owned by the cloner; it takes nothing from the source and grants
 * nothing on it. A viewer can already read every stop, day and cost through
 * the board, so refusing them a copy protects nothing and only makes the
 * product feel arbitrary.
 */
export async function duplicateTrip(sourceTripId: string, actorId: string): Promise<CommandResult> {
  const source = await getTripDetail(sourceTripId);
  if (source === null) {
    return { ok: false, error: { code: "not-found", message: "This trip does not exist." } };
  }
  const members = await effectiveMembers(db, sourceTripId, source.members);
  if (!hasAtLeast(actorId, members, "viewer")) {
    return { ok: false, error: { code: "forbidden", message: "Not a member of this trip." } };
  }
  if (source.status === "deleted") {
    return { ok: false, error: { code: "trip-deleted", message: "This trip has been deleted." } };
  }
  const atSeq = await getTripHead(sourceTripId);
  if (atSeq === null) {
    return { ok: false, error: { code: "not-found", message: "This trip does not exist." } };
  }
  return cloneFrom(
    source,
    { tripId: sourceTripId, atSeq, name: source.name },
    actorId,
    `${source.name} (copy)`,
  );
}

/**
 * "Make this my trip" — a copy taken from a share link, by someone who may be
 * no relation to the trip at all.
 *
 * The copy is of the PINNED state, not the current one: the link showed a
 * particular point in history and that is what its holder chose to take. Any
 * other answer means the button copies something the person never saw.
 */
export async function cloneSharedTrip(token: string, actorId: string): Promise<CommandResult> {
  const shared = await readShareForClone(token);
  if (!shared.ok) {
    const code = shared.error.code === "not-found" ? "not-found" : "share-unavailable";
    return { ok: false, error: { code, message: shared.error.message } };
  }
  const { detail, tripId, atSeq, name } = shared.value;
  return cloneFrom(detail, { tripId, atSeq, name }, actorId, `${name} (copy)`);
}

/**
 * "Make this my trip" — from the built-in demo trip at `/s/featured`.
 *
 * The same `cloneFrom` every other copy goes through, handed a `TripDetail`
 * that was folded in memory instead of read out of Postgres (ADR-031). The
 * copy that lands in the visitor's list is an ordinary trip built by the
 * ordinary command pipeline; nothing about it remembers it came from a
 * fixture except the lineage pointer.
 *
 * That pointer names `DEMO_TRIP_ID`, which is a real UUID naming no row —
 * see the note on it. `forkedFrom` is display-only text today ("Copied from
 * ..., as it was at change N"), and this is the trade the demo is worth: the
 * alternative, `forkedFrom: null`, would tell the person who just cloned the
 * demo that their trip came from nowhere.
 */
export async function cloneDemoTrip(actorId: string): Promise<CommandResult> {
  const { detail, seq } = demoTrip();
  return cloneFrom(
    detail,
    { tripId: detail.tripId, atSeq: seq, name: detail.name },
    actorId,
    `${detail.name} (copy)`,
  );
}

// The diff emits the same event set the batchable commands produce, so the
// mapping is total over what diffTripStates can return for an empty→target run.
function eventToCommand(event: ReturnType<typeof diffTripStates>[number], tripId: string): BatchableCommand {
  switch (event.type) {
    case "DayAdded":
      return { type: "AddDay", tripId, dayId: event.payload.dayId };
    case "TripStartDateSet":
      return { type: "SetTripDates", tripId, startDate: event.payload.startDate, endDate: null, newDayIds: [] };
    case "TripCurrencySet":
      return { type: "SetTripCurrency", tripId, currency: event.payload.currency };
    case "TripBudgetSet":
      return { type: "SetTripBudget", tripId, budget: event.payload.budget };
    case "TripNameSet":
      return { type: "SetTripName", tripId, name: event.payload.name };
    case "ActivityAdded":
      // ActivityAdded event payloads use explicit null for "unset" fields
      // (they're stored as jsonb forever); AddActivity the command uses
      // .optional() rather than .nullable() for the same fields, so null
      // must be normalized to undefined before it will pass validation.
      return {
        type: "AddActivity", tripId,
        activityId: event.payload.activityId,
        dayId: event.payload.dayId ?? undefined,
        title: event.payload.title,
        timeWindow: event.payload.timeWindow ?? undefined,
        location: event.payload.location ?? undefined,
        notes: event.payload.notes ?? undefined,
        anchors: event.payload.anchors,
        kind: event.payload.kind,
        tags: event.payload.tags,
        cost: event.payload.cost ?? undefined,
      };
    case "ActivityMoved":
      return {
        type: "MoveActivity", tripId,
        activityId: event.payload.activityId,
        toDayId: event.payload.toDayId,
        position: event.payload.position,
      };
    default:
      throw new Error(`cloneTrip: unexpected event ${event.type} from an empty-state diff`);
  }
}
