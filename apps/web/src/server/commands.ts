import { CreateTrip, TripEvent } from "@tc/contracts";
import { decideCreateTrip, evolveTrip, type TripState } from "@tc/domain";
import { db } from "./db/client";
import { appendToStream, readStream } from "./eventStore";
import { applyTripEvents } from "./projections";
import { soleMemberPolicy } from "./accessPolicy";

export type CommandResult =
  | { ok: true; tripId: string }
  | { ok: false; error: { code: string; message: string } };

// The command pipeline (docs/guidelines/building-the-parts.md). Every write
// in the planning domain goes through this exact sequence.
export async function handleCreateTrip(
  input: { tripId: string; name: string },
  actorId: string,
): Promise<CommandResult> {
  // 1. validate the command against the contract
  const parsed = CreateTrip.safeParse({ type: "CreateTrip", ...input });
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "invalid-command", message: parsed.error.message },
    };
  }
  const command = parsed.data;

  return db.transaction(async (tx): Promise<CommandResult> => {
    // 2. load the stream and fold to current state
    const history = await readStream(tx, command.tripId);
    let state: TripState | null = null;
    for (const env of history) {
      const event = TripEvent.parse({
        type: env.type,
        version: env.version,
        payload: env.payload,
      });
      state = evolveTrip(state, event);
    }

    // 3. authorize via the AccessPolicy seam
    if (!soleMemberPolicy.canExecute(actorId, command.type, state?.members ?? null)) {
      return { ok: false, error: { code: "forbidden", message: "Not a member of this trip." } };
    }

    // 4. decide
    const decision = decideCreateTrip(state, command, { actorId });
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

    return { ok: true, tripId: command.tripId };
  });
}
