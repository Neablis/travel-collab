import { useEffect, useRef } from "react";
import type { TripHistory } from "@tc/contracts";
import { fetchTripEvents } from "@/lib/apiClient";

/**
 * The client half of M13 link 2 — the transport seam ADR-049 Decision 3 asks
 * for.
 *
 * Everything above this module knows one thing: *"the trip moved, go and get
 * it."* It does not know whether a poll, a stream or a socket found that out.
 * That is the whole point of the seam: ADR-049 rejected SSE **for now** on a
 * runtime argument (a serverless handler cannot learn of a commit made by
 * another invocation, so SSE without a broker is database polling you also pay
 * to hold open), and the thing that makes revisiting it cheap is that the
 * decision lives here and nowhere else. SSE's own `Last-Event-ID` **is** this
 * cursor, so swapping the transport changes this file and no contract.
 */

/**
 * How often a visible, multi-member trip asks.
 *
 * ADR-049 Decision 2 sized this against the freshness it buys, not the requests
 * it saves: a co-traveller's edit appears within ~5s of being committed. That
 * is a product-visible latency and the explicit price of not running a broker.
 * It is also a straight improvement on the previous answer, which was
 * "whenever someone remounts".
 */
export const POLL_INTERVAL_MS = 5000;

/**
 * The trip's confirmed head `seq`, read off the history the client already has.
 *
 * **Derived on purpose, and this is the one place that derives it.** The ADR
 * floated declaring `headSeq` on `TripHistory` instead. That turned out to cost
 * more than it is worth: `TripHistory` is the response schema of a PUBLIC v1
 * endpoint (`/api/v1/trips/:tripId/history`), so declaring it is a published
 * OpenAPI change — and a regeneration, and a caller-visible field — bought for
 * an internal polling cursor. One named function with the invariant written
 * down is the cheaper honest answer.
 *
 * The invariant it depends on, so nobody has to re-derive it: `entries` is
 * newest-first as served by the API, every event belongs to exactly one batch
 * and every batch is one entry, so `entries[0].toSeq` is the last `seq` the
 * server has. A trip with no history is at 0, which is also what the events
 * endpoint reports for a stream carrying nothing — so the two agree at the
 * empty case rather than one of them guessing.
 */
export function headSeqOf(history: TripHistory): number {
  return history.entries[0]?.toSeq ?? 0;
}

type BroadcastArgs = {
  tripId: string;
  /**
   * Whether the interval runs at all. The caller decides, because the reasons
   * are the caller's: a solo trip has no second writer, so the interval would
   * be pure cost; a trip being previewed at an older seq should not have the
   * present moving underneath it.
   */
  enabled: boolean;
  /**
   * The cursor, read at poll time rather than passed by value — the confirmed
   * head moves under this hook every time the user's own edits land, and a
   * cursor captured when the effect was set up would re-report those as remote
   * news on every tick.
   */
  cursor: () => number;
  /** "The trip moved." Called at most once per poll that has news. */
  onChanged: () => void;
};

/**
 * Poll this trip's log while the document is visible, and say when it moved.
 *
 * Three behaviours worth naming, because each is a decision rather than a
 * detail:
 *
 * - **Hidden tabs do not poll at all**, and a tab coming back polls
 *   immediately rather than waiting out an interval. ADR-046 noted that nothing
 *   in this app listened for `visibilitychange`; this is the first thing that
 *   does, and returning to a tab is exactly when a stale board is most visible.
 * - **A failed poll is silent.** It is not a user-facing error: the next tick
 *   retries, the board still shows the user's own work, and an error banner for
 *   a background read the user never asked for would be noise. Nothing is lost
 *   by a missed poll, because the cursor only advances on a poll that succeeded.
 * - **`resync` is treated exactly like news.** Both mean "your cursor is behind
 *   the head"; the caller's answer to either is to refetch the trip, which is
 *   the one cheap request that fixes an arbitrarily large gap.
 */
export function useTripBroadcast({ tripId, enabled, cursor, onChanged }: BroadcastArgs): void {
  // Held in refs so the effect below depends only on `tripId` and `enabled`.
  // Otherwise every render would tear down the interval and start a new one,
  // and a 5s interval that restarts every keystroke never fires.
  const cursorRef = useRef(cursor);
  const onChangedRef = useRef(onChanged);
  cursorRef.current = cursor;
  onChangedRef.current = onChanged;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      const before = cursorRef.current();
      const result = await fetchTripEvents(tripId, before);
      // `cancelled` is checked AFTER the await: the provider may have
      // unmounted, or the trip changed, while this request was in flight, and
      // telling a dead caller its trip moved is how you get a setState on an
      // unmounted tree.
      if (cancelled || !result.ok) return;
      if (result.value.resync || result.value.headSeq > before) onChangedRef.current();
    };

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void poll();
        start();
      } else {
        stop();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "visible") start();

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [tripId, enabled]);
}
