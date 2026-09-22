import type { TripEventsPage } from "@tc/contracts";
import { isDemoTripId } from "@/lib/demoTrip";
import { db } from "./db/client";
import { readStreamAfter, readStreamHeadSeq } from "./eventStore";
import { demoTripHeadSeq } from "./demoTrip";

/**
 * The read side of M13 link 2 — "what happened on this trip since `seq` N?"
 *
 * ADR-049 decided this is a cursor the client asks for rather than a stream
 * pushed to it, and that the cursor is per-stream `seq`. This module is the
 * server half of that decision; the transport seam on the client is the other
 * half, and neither knows what the other is.
 */

/**
 * The most envelopes one poll will carry.
 *
 * A cap exists because ADR-049 promised the poll costs "one indexed range scan
 * per visible multi-member trip", and a range scan that can return an entire
 * trip's log is not that. A caller further behind than this is told to refetch
 * the trip (`resync`), which is one cheap request against a projection, rather
 * than being walked through the gap a page at a time.
 */
export const MAX_EVENTS_PER_POLL = 200;

/**
 * Envelopes committed after `afterSeq`, and where the head is now.
 *
 * **The steady-state poll costs one index-only lookup.** Nothing has usually
 * happened between two polls five seconds apart, and in that case this returns
 * after `readStreamHeadSeq` alone — the range scan runs only on a poll that
 * actually has news. That asymmetry is what makes the interval affordable, so
 * the early return below is load-bearing rather than a micro-optimisation.
 *
 * `afterSeq` ahead of the head is not an error: a client can hold a seq this
 * trip no longer has after a revert, and the honest answer is the head it
 * should resynchronise to, not a 4xx.
 */
export async function getTripEventsAfter(
  tripId: string,
  afterSeq: number,
): Promise<TripEventsPage> {
  // The demo trip is a fixture, not rows (ADR-031) — its log is folded from
  // `@tc/fixtures` and never moves, so there is nothing to broadcast and never
  // will be. A reader at the head stays at the head; one holding a lower seq
  // is told to resync, which for the demo resolves against the same fixture.
  if (isDemoTripId(tripId)) {
    const headSeq = demoTripHeadSeq();
    return { headSeq, events: [], resync: afterSeq < headSeq };
  }

  const headSeq = await readStreamHeadSeq(db, tripId);
  if (afterSeq >= headSeq) return { headSeq, events: [], resync: false };
  if (headSeq - afterSeq > MAX_EVENTS_PER_POLL) return { headSeq, events: [], resync: true };

  const events = await readStreamAfter(db, tripId, afterSeq, MAX_EVENTS_PER_POLL);
  return { headSeq, events, resync: false };
}
