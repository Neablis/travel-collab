import type { BatchableCommand } from "@tc/contracts";
import type { PendingUnit } from "./optimistic";

/**
 * The most a flush may put in one keepalive body, in bytes.
 *
 * Browsers refuse a keepalive request once the keepalive bodies in flight
 * from a document pass 64 KiB. The limit is shared, and a notebook page
 * flushes its own draft on the same `pagehide` (`useEditSession`), so this
 * leaves some of it for that one.
 */
export const KEEPALIVE_BODY_BUDGET = 48 * 1024;

export type UnloadFlush = {
  /** The units sent, oldest first. Always a prefix of what was passed in. */
  units: PendingUnit[];
  /** Their commands, in queue order, as one batch. */
  commands: BatchableCommand[];
  /** Whether the body fits a keepalive request. */
  keepalive: boolean;
};

/**
 * What to send for the queued units nobody has sent yet, when the queue is
 * about to stop existing (KI-5).
 *
 * **One batch, not one request per unit.** Separate requests from a page that
 * is going away race each other to the server, and ordered edits applied out
 * of order leave a trip no one made. One batch is decided in order and is
 * atomic: if any unit is refused, none of them is applied.
 *
 * **A page that is unloading only gets what fits.** A keepalive body over the
 * browser's limit is refused outright, so this sends the longest prefix of
 * whole units that fits, and nothing if the first unit alone does not. Units
 * are ordered edits, so what is sent must be a prefix: sending a later one
 * without an earlier one would persist a trip no send order produces. A page
 * that is not unloading (the provider unmounting in an in-app navigation)
 * sends everything, without keepalive if it has to — the fetch survives there.
 */
export function unloadFlush(
  units: readonly PendingUnit[],
  { unloading, budget = KEEPALIVE_BODY_BUDGET }: { unloading: boolean; budget?: number },
): UnloadFlush | null {
  const all = units.flatMap((u) => u.commands);
  if (all.length === 0) return null;

  // One pass, each command encoded once: this runs synchronously inside
  // `pagehide`, and re-encoding the growing batch per unit is quadratic in the
  // queue. The body is `{"commands":[c1,c2,…]}`, so its size is the empty
  // envelope, plus every command's own bytes, plus one comma between each pair
  // — exactly what `JSON.stringify({ commands })` would produce.
  const encoder = new TextEncoder();
  const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
  const envelope = bytes({ commands: [] });
  const bodySize = (payload: number, count: number) => envelope + payload + Math.max(count - 1, 0);

  let payload = 0;
  let count = 0;
  let taken = 0;
  for (const unit of units) {
    const nextPayload = payload + unit.commands.reduce((sum, c) => sum + bytes(c), 0);
    const nextCount = count + unit.commands.length;
    // Staying pages send everything (see above), so only an unloading one stops.
    if (unloading && bodySize(nextPayload, nextCount) > budget) break;
    payload = nextPayload;
    count = nextCount;
    taken += 1;
  }

  if (taken === units.length) {
    return { units: [...units], commands: all, keepalive: bodySize(payload, count) <= budget };
  }
  return taken === 0
    ? null
    : { units: units.slice(0, taken), commands: units.slice(0, taken).flatMap((u) => u.commands), keepalive: true };
}
