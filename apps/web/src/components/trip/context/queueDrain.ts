import {
  sendTripCommand,
  sendTripUnits,
  type ApiResult,
  type BoardCommand,
  type CommandOutcome,
} from "@/lib/apiClient";
import { beginWrite, endWrite } from "@/lib/queryCache";
import { tripKeys } from "@/lib/queryKeys";
import type { PendingUnit } from "./optimistic";
import { unloadFlushAfterHead } from "./unloadFlush";

/**
 * Send one queued unit the way the sequential sender does: a single command
 * through the single-command endpoint, anything larger as one batch. Either
 * way it carries the unit's id as its key (ADR-066), so the server applies it
 * once however many times it is sent: by the sender, a retry, or the unload
 * flush.
 */
export function sendUnit(tripId: string, unit: PendingUnit): Promise<ApiResult<CommandOutcome>> {
  return unit.commands.length === 1
    ? sendTripCommand(unit.commands[0]! as BoardCommand, { idempotencyKey: unit.id })
    : sendTripUnits(tripId, [{ key: unit.id, commands: unit.commands }]);
}

/** The drain still running for each trip, so a second one queues behind it. */
const drains = new Map<string, Promise<void>>();

/**
 * Per trip, every unit a drain still holds, oldest first: the first may be on
 * the wire. What a `pagehide` during the drain flushes (KI-5 window 6).
 */
const held = new Map<string, PendingUnit[]>();
/** Per trip, the units a `pagehide` flush took, each to whether it was applied. */
const flushed = new Map<string, Map<string, Promise<boolean>>>();
/** Per trip, the `pagehide` listener installed while its drain holds anything. */
const listeners = new Map<string, () => void>();

function hold(tripId: string, units: readonly PendingUnit[]): void {
  held.set(tripId, [...(held.get(tripId) ?? []), ...units]);
  if (listeners.has(tripId)) return;
  const listener = () => flushHeld(tripId);
  listeners.set(tripId, listener);
  window.addEventListener("pagehide", listener);
}

function release(tripId: string, unit: PendingUnit): void {
  const rest = (held.get(tripId) ?? []).filter((u) => u.id !== unit.id);
  if (rest.length > 0) {
    held.set(tripId, rest);
    return;
  }
  held.delete(tripId);
  const listener = listeners.get(tripId);
  if (listener) window.removeEventListener("pagehide", listener);
  listeners.delete(tripId);
}

// The provider's own `pagehide` flush, for a queue the provider no longer
// owns: one keepalive batch of what the drain still holds, the unit on the
// wire first under the key it was sent with (ADR-066), so the server leaves it
// out if it landed and applies it first if it did not. What persists is a
// prefix of what the person did; past the keepalive budget the rest is
// window 4's loss, as on the provider's path.
function flushHeld(tripId: string): void {
  const units = held.get(tripId) ?? [];
  const flush = unloadFlushAfterHead(units, { headSent: true });
  if (!flush) return;
  const answer = sendTripUnits(tripId, flush.body, { keepalive: flush.keepalive }).then(
    (result) => result.ok || result.error.code === "no-op",
    () => false,
  );
  const taken = flushed.get(tripId) ?? new Map<string, Promise<boolean>>();
  for (const unit of flush.units) taken.set(unit.id, answer);
  flushed.set(tripId, taken);
}

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
 * **If the page goes while it runs** (KI-5 window 6), the provider's
 * `pagehide` listener went with the provider, so the drain listens itself and
 * flushes everything it still holds as one keepalive batch (`flushHeld`). It
 * then sends none of those units on its own; should the page survive (the
 * back/forward cache), it waits for the batch's answer and sends only what the
 * batch did not apply.
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
  inFlight: { send: Promise<unknown>; unit: PendingUnit | null } | null,
  units: readonly PendingUnit[],
): Promise<void> {
  const scope = tripKeys.all(tripId);
  beginWrite(scope);
  const onWire = inFlight?.unit ?? null;
  hold(tripId, onWire === null ? units : [onWire, ...units]);
  const inFlightDone = (inFlight?.send ?? Promise.resolve()).catch(() => {}).finally(() => {
    if (onWire !== null) release(tripId, onWire);
  });
  const before = [(drains.get(tripId) ?? Promise.resolve()).catch(() => {}), inFlightDone];
  const run: Promise<void> = Promise.all(before)
    .then(async () => {
      for (const unit of units) {
        const taken = flushed.get(tripId)?.get(unit.id);
        // `sendUnit` resolves rather than rejects (apiClient's invariant); the
        // catch keeps one bad unit from ending the drain if that ever breaks.
        if (taken === undefined || !(await taken)) await sendUnit(tripId, unit).catch(() => {});
        release(tripId, unit);
      }
    })
    .finally(() => {
      if (drains.get(tripId) === run) {
        drains.delete(tripId);
        flushed.delete(tripId);
      }
      endWrite(scope);
    });
  drains.set(tripId, run);
  return run;
}
