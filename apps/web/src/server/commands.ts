import { z } from "zod";
import {
  BatchableCommand,
  TripCommand,
  type EventEnvelope,
  type Origin,
  type TripDetail,
  type TripEvent,
  type TripHistory,
  type TripMember,
} from "@tc/contracts";
import {
  buildHistoryEntries,
  decideHistoryCommand,
  decideTripCommand,
  deriveUndoRedo,
  evolveTrip,
  foldEnvelopes,
  groupBatches,
  tripDetailFromState,
} from "@tc/domain";
import { serverConflictContext } from "./conflictContext";
import { db } from "./db/client";
import { appendToStream, readStream } from "./eventStore";
import { applyTripEvents, upsertTripDetail } from "./projections";
import { memberRolePolicy } from "./accessPolicy";
import { effectiveMembers } from "./access/members";

export type CommandResult =
  | { ok: true; tripId: string; detail: TripDetail; history: TripHistory }
  | { ok: false; error: { code: string; message: string } };

// Build the authoritative detail (persisting it) and history DTO from the
// full envelope list — the same shapes the read endpoints serve. Runs inside
// the caller's transaction so the projections it writes are part of the same
// atomic write as the appended events.
async function projectAndHistory(
  tx: Parameters<typeof upsertTripDetail>[0],
  allEnvelopes: EventEnvelope[],
  tripId: string,
): Promise<{ detail: TripDetail; history: TripHistory }> {
  const nextState = foldEnvelopes(allEnvelopes);
  if (nextState === null) throw new Error("state cannot be null after an accepted command");
  const firstEnvelope = allEnvelopes[0];
  if (firstEnvelope === undefined) throw new Error("no envelopes to project");
  const detail = tripDetailFromState(nextState, firstEnvelope.occurredAt, serverConflictContext());
  await upsertTripDetail(tx, detail);
  const targets = deriveUndoRedo(groupBatches(allEnvelopes));
  const history: TripHistory = {
    tripId,
    entries: buildHistoryEntries(allEnvelopes).reverse(),
    canUndo: targets.undo !== null,
    canRedo: targets.redo !== null,
  };
  return { detail, history };
}

// The command pipeline (docs/guidelines/building-the-parts.md). Every write
// in the planning domain goes through this exact sequence — including undo,
// redo, and revert, which differ ONLY in how step 4 decides (ADR-005).
export async function executeTripCommand(input: unknown, actorId: string): Promise<CommandResult> {
  // 1. validate the command against the contract
  const parsed = TripCommand.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid-command", message: parsed.error.message } };
  }
  const command = parsed.data;

  return db.transaction(async (tx): Promise<CommandResult> => {
    // 2. load the stream and fold to current state
    const history = await readStream(tx, command.tripId);
    const state = foldEnvelopes(history);

    // 3. authorize via the AccessPolicy seam.
    //
    // The member list is the EFFECTIVE one — the log's owner merged with the
    // Access module's accepted-invite rows (M11 link 3). The planning domain
    // still knows nothing about invites: `state.members` is unchanged, and the
    // merge happens out here, on the way into the seam that was always the
    // only interpreter of a role (AGENTS.md invariant 6c).
    const members = state === null ? null : await effectiveMembers(tx, command.tripId, state.members);
    if (!memberRolePolicy.canExecute(actorId, command.type, members)) {
      return { ok: false, error: { code: "forbidden", message: "Not a member of this trip." } };
    }

    // 4. decide — history commands need the envelope history (already loaded;
    //    zero extra I/O), everything else the folded state.
    let events: TripEvent[];
    let origin: Origin;
    if (
      command.type === "UndoLastChange" ||
      command.type === "RedoChange" ||
      command.type === "RevertToState"
    ) {
      const decision = decideHistoryCommand(history, command);
      if (!decision.ok) return { ok: false, error: decision.rejection };
      events = decision.events;
      origin = decision.origin;
    } else {
      const decision = decideTripCommand(state, command, { actorId });
      if (!decision.ok) return { ok: false, error: decision.rejection };
      events = decision.events;
      origin = { kind: "user" };
    }

    // 5. append with optimistic concurrency (one batch per command execution)
    const appended = await appendToStream(tx, {
      streamId: command.tripId,
      expectedSeq: history.length,
      events,
      actorId,
      occurredAt: new Date().toISOString(),
      batchId: crypto.randomUUID(),
      origin,
    });
    if (!appended.ok) {
      return {
        ok: false,
        error: { code: "concurrency-conflict", message: "Someone else changed this trip. Retry." },
      };
    }

    // 6-7. update projections + build the authoritative response — a revert
    //    into a formerly-conflicted state resurfaces its badges here.
    await applyTripEvents(tx, appended.envelopes);
    const { detail, history: historyDto } = await projectAndHistory(
      tx,
      [...history, ...appended.envelopes],
      command.tripId,
    );

    return { ok: true, tripId: command.tripId, detail: withMembers(detail, members), history: historyDto };
  });
}

// The stored projection stays exactly what the log produces (invariant 2 —
// `upsertTripDetail` above already wrote it); only the DTO handed back to the
// caller carries the effective member list, so a command response and a
// subsequent GET agree about who is on the trip.
//
// `members` is null only for CreateTrip, whose stream did not exist when the
// merge was attempted; the created trip's own projection already carries its
// owner and there are no grants to merge yet.
function withMembers(detail: TripDetail, members: TripMember[] | null): TripDetail {
  return members === null ? detail : { ...detail, members };
}

const BatchBody = z.array(BatchableCommand).min(1);

// Same pipeline as executeTripCommand, but decides N batchable commands
// against the evolving state and — only if every one succeeds — appends all
// resulting events under ONE batchId, so groupBatches/buildHistoryEntries
// treat the whole batch as a single history entry (ADR-005-adjacent: undo
// unwinds the batch as a unit). Any rejection appends nothing.
export async function executeTripCommandBatch(input: unknown, actorId: string): Promise<CommandResult> {
  // 1. validate the batch shape against the contract
  const parsed = BatchBody.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid-command", message: parsed.error.message } };
  }
  const commands = parsed.data;
  const tripId = commands[0]!.tripId;
  if (!commands.every((c) => c.tripId === tripId)) {
    return {
      ok: false,
      error: { code: "invalid-command", message: "All commands in a batch must target the same trip." },
    };
  }

  return db.transaction(async (tx): Promise<CommandResult> => {
    // 2. load the stream and fold to current state
    const history = await readStream(tx, tripId);
    let state = foldEnvelopes(history);

    // 3. authorize via the AccessPolicy seam (same check as executeTripCommand),
    //    for EVERY sub-command: roles are per-command (accessPolicy.ts), so
    //    checking only the first would let a batch smuggle in a command the
    //    actor's role does not permit.
    const members = state === null ? null : await effectiveMembers(tx, tripId, state.members);
    if (commands.some((c) => !memberRolePolicy.canExecute(actorId, c.type, members))) {
      return { ok: false, error: { code: "forbidden", message: "Not a member of this trip." } };
    }

    // 4. decide each command in order against the evolving state. A no-op
    //    sub-command is SKIPPED, not fatal — one redundant Set*/etc. must not roll
    //    back an otherwise-valid batch (2026-07-25 live-testing finding). Real
    //    rejections (day-not-found, activity-already-exists, …) still abort.
    const events: TripEvent[] = [];
    for (const command of commands) {
      const decision = decideTripCommand(state, command, { actorId });
      if (!decision.ok) {
        if (decision.rejection.code === "no-op") continue;
        return { ok: false, error: decision.rejection };
      }
      for (const event of decision.events) state = evolveTrip(state, event);
      events.push(...decision.events);
    }
    // If every sub-command was a no-op there is nothing to append — report it the
    // same way a single no-op command does, rather than appending an empty batch
    // (appendToStream requires ≥1 event and one batch = one history entry).
    if (events.length === 0) {
      return { ok: false, error: { code: "no-op", message: "This change would have no effect." } };
    }

    // 5. append every event from every command under ONE batchId
    const appended = await appendToStream(tx, {
      streamId: tripId,
      expectedSeq: history.length,
      events,
      actorId,
      occurredAt: new Date().toISOString(),
      batchId: crypto.randomUUID(),
      origin: { kind: "user" },
    });
    if (!appended.ok) {
      return {
        ok: false,
        error: { code: "concurrency-conflict", message: "Someone else changed this trip. Retry." },
      };
    }

    // 6-7. update projections + build the authoritative response
    await applyTripEvents(tx, appended.envelopes);
    const { detail, history: historyDto } = await projectAndHistory(
      tx,
      [...history, ...appended.envelopes],
      tripId,
    );

    return { ok: true, tripId, detail: withMembers(detail, members), history: historyDto };
  });
}
