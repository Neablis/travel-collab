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
  const encoder = new TextEncoder();
  const size = (commands: BatchableCommand[]) => encoder.encode(JSON.stringify({ commands })).length;

  const all = units.flatMap((u) => u.commands);
  if (all.length === 0) return null;
  if (size(all) <= budget) return { units: [...units], commands: all, keepalive: true };
  if (!unloading) return { units: [...units], commands: all, keepalive: false };

  let taken = 0;
  let commands: BatchableCommand[] = [];
  for (const unit of units) {
    const next = [...commands, ...unit.commands];
    if (size(next) > budget) break;
    commands = next;
    taken += 1;
  }
  return taken === 0 ? null : { units: units.slice(0, taken), commands, keepalive: true };
}
