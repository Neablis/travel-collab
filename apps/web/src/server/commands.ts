import { TripCommand, type Origin, type TripEvent } from "@tc/contracts";
import {
  decideHistoryCommand,
  decideTripCommand,
  foldEnvelopes,
  tripDetailFromState,
} from "@tc/domain";
import { serverConflictContext } from "./conflictContext";
import { db } from "./db/client";
import { appendToStream, readStream } from "./eventStore";
import { applyTripEvents, upsertTripDetail } from "./projections";
import { soleMemberPolicy } from "./accessPolicy";

export type CommandResult =
  | { ok: true; tripId: string }
  | { ok: false; error: { code: string; message: string } };

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

    // 3. authorize via the AccessPolicy seam
    if (!soleMemberPolicy.canExecute(actorId, command.type, state?.members ?? null)) {
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

    // 6. update projections in the same transaction
    await applyTripEvents(tx, appended.envelopes);

    // 7. run the conflict engine on the new state and persist the detail doc
    //    — a revert into a formerly-conflicted state resurfaces its badges here.
    const nextState = foldEnvelopes([...history, ...appended.envelopes]);
    if (nextState === null) throw new Error("state cannot be null after an accepted command");
    const firstEnvelope = history[0] ?? appended.envelopes[0];
    if (firstEnvelope === undefined) throw new Error("append returned no envelopes");
    await upsertTripDetail(tx, tripDetailFromState(nextState, firstEnvelope.occurredAt, serverConflictContext()));

    return { ok: true, tripId: command.tripId };
  });
}
