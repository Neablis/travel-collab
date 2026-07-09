import { TripCommand, TripEvent } from "@tc/contracts";
import { decideTripCommand, evolveTrip, tripDetailFromState, type TripState } from "@tc/domain";
import { db } from "./db/client";
import { appendToStream, readStream } from "./eventStore";
import { applyTripEvents, upsertTripDetail } from "./projections";
import { soleMemberPolicy } from "./accessPolicy";

export type CommandResult =
  | { ok: true; tripId: string }
  | { ok: false; error: { code: string; message: string } };

// The command pipeline (docs/guidelines/building-the-parts.md). Every write
// in the planning domain goes through this exact sequence.
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
    let state: TripState | null = null;
    for (const env of history) {
      const event = TripEvent.parse({ type: env.type, version: env.version, payload: env.payload });
      state = evolveTrip(state, event);
    }

    // 3. authorize via the AccessPolicy seam
    if (!soleMemberPolicy.canExecute(actorId, command.type, state?.members ?? null)) {
      return { ok: false, error: { code: "forbidden", message: "Not a member of this trip." } };
    }

    // 4. decide
    const decision = decideTripCommand(state, command, { actorId });
    if (!decision.ok) return { ok: false, error: decision.rejection };

    // 5. append with optimistic concurrency
    const appended = await appendToStream(tx, {
      streamId: command.tripId,
      expectedSeq: history.length,
      events: decision.events,
      actorId,
      occurredAt: new Date().toISOString(),
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
    //    (tripDetailFromState computes conflicts) — same transaction.
    let nextState = state;
    for (const event of decision.events) nextState = evolveTrip(nextState, event);
    if (nextState === null) throw new Error("state cannot be null after an accepted command");
    const firstEnvelope = history[0] ?? appended.envelopes[0];
    if (firstEnvelope === undefined) throw new Error("append returned no envelopes");
    await upsertTripDetail(tx, tripDetailFromState(nextState, firstEnvelope.occurredAt));

    return { ok: true, tripId: command.tripId };
  });
}
