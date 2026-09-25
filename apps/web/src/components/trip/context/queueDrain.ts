import {
  sendTripCommand,
  sendTripCommandBatch,
  type ApiResult,
  type BoardCommand,
  type CommandOutcome,
} from "@/lib/apiClient";
import { beginWrite, endWrite } from "@/lib/queryCache";
import { tripKeys } from "@/lib/queryKeys";
import type { PendingUnit } from "./optimistic";

/**
 * Send one queued unit the way the sequential sender does: a single command
 * through the single-command endpoint, anything larger as one batch.
 */
export function sendUnit(tripId: string, unit: PendingUnit): Promise<ApiResult<CommandOutcome>> {
  return unit.commands.length === 1
    ? sendTripCommand(unit.commands[0]! as BoardCommand)
    : sendTripCommandBatch(tripId, unit.commands);
}

/** The drain still running for each trip, so a second one queues behind it. */
const drains = new Map<string, Promise<void>>();

/**
 * Finish sending a queue whose provider has unmounted while the page lives on —
 * an in-app navigation away from the trip (KI-5).
 *
 * Waits for `inFlight` (the unit the sender already had on the wire) and for
 * any earlier drain of the same trip, then sends `units` **one at a time, in
 * queue order**, each its own request and so its own history entry. Nothing is
 * sent until the one before it has answered, so no unit can overtake another,
 * and a unit the server refuses is simply not applied — the ones behind it are
 * still sent, each decided on its own against the trip as it then stands.
 *
 * It holds one write scope on the trip for its whole length. Each send opens
 * and closes its own, and between one unit's answer and the next unit's send
 * none would be open: a board that mounted meanwhile would take its
 * KI-2026-09-14-e re-read in that gap and then miss every later unit.
 *
 * Module-level on purpose: the provider that owned the queue is gone, and this
 * has to outlive it. Resolves, never rejects.
 */
export function drainAfter(
  tripId: string,
  inFlight: Promise<unknown> | null,
  units: readonly PendingUnit[],
): Promise<void> {
  const scope = tripKeys.all(tripId);
  beginWrite(scope);
  const before = [drains.get(tripId), inFlight].map((p) => (p ?? Promise.resolve()).catch(() => {}));
  const run: Promise<void> = Promise.all(before)
    .then(async () => {
      for (const unit of units) {
        // `sendUnit` resolves rather than rejects (apiClient's invariant); the
        // catch keeps one bad unit from ending the drain if that ever breaks.
        await sendUnit(tripId, unit).catch(() => {});
      }
    })
    .finally(() => {
      if (drains.get(tripId) === run) drains.delete(tripId);
      endWrite(scope);
    });
  drains.set(tripId, run);
  return run;
}
