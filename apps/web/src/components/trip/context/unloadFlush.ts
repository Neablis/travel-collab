import type { TripCommandUnit } from "@tc/contracts";
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
  /** The request body's `units`: each sent unit's key and commands, in order (ADR-066). */
  body: TripCommandUnit[];
  /** Whether the body fits a keepalive request. */
  keepalive: boolean;
};

/**
 * What to send for the queued units, when the queue is about to stop existing
 * (KI-5). Each goes with its key (ADR-066), so the caller may include the unit
 * already in flight: if the server has applied it, the batch leaves it out.
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
  const body = units.map((u) => ({ key: u.id, commands: u.commands }));
  if (body.length === 0) return null;

  // One pass, each unit encoded once: this runs synchronously inside
  // `pagehide`, and re-encoding the growing batch per unit is quadratic in the
  // queue. The body is `{"units":[u1,u2,…]}`, so its size is the empty
  // envelope, plus every unit's own bytes, plus one comma between each pair,
  // exactly what `JSON.stringify({ units })` would produce.
  const encoder = new TextEncoder();
  const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
  const envelope = bytes({ units: [] });
  const bodySize = (payload: number, count: number) => envelope + payload + Math.max(count - 1, 0);

  let payload = 0;
  let taken = 0;
  for (const unit of body) {
    const nextPayload = payload + bytes(unit);
    // Staying pages send everything (see above), so only an unloading one stops.
    if (unloading && bodySize(nextPayload, taken + 1) > budget) break;
    payload = nextPayload;
    taken += 1;
  }

  if (taken === 0) return null;
  return {
    units: units.slice(0, taken),
    body: body.slice(0, taken),
    keepalive: bodySize(payload, taken) <= budget,
  };
}

/**
 * The `pagehide` flush for a queue whose first unit the sender may already have
 * sent (ADR-066). That unit goes too, under its key, so the server leaves it
 * out if it landed. But it is only a maybe: if carrying it costs the units
 * behind it their place in the keepalive budget, the flush goes without it,
 * as it did before keys. The rule is to carry the most unsent units, with the
 * head on a tie.
 */
export function unloadFlushAfterHead(
  units: readonly PendingUnit[],
  { headSent, budget = KEEPALIVE_BODY_BUDGET }: { headSent: boolean; budget?: number },
): UnloadFlush | null {
  const withHead = unloadFlush(units, { unloading: true, budget });
  if (!headSent || units.length === 0) return withHead;
  const unsentWithHead = withHead ? withHead.units.length - 1 : 0;
  if (unsentWithHead === units.length - 1) return withHead;
  const withoutHead = unloadFlush(units.slice(1), { unloading: true, budget });
  return (withoutHead?.units.length ?? 0) > unsentWithHead ? withoutHead : withHead;
}
