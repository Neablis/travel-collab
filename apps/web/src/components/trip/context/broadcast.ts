import { useEffect, useRef } from "react";
import type { TripHistory } from "@tc/contracts";
import { fetchTripEvents } from "@/lib/apiClient";
import { isDemoTripId } from "@/lib/demoTrip";

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
 * it saves: a co-traveller's edit appears within one interval of being
 * committed. That is a product-visible latency and the explicit price of not
 * running a broker.
 *
 * **2s, down from the 5s the ADR shipped.** Mitchell, 2026-09-22, walking two
 * devices on the preview: *"updates can be a bit sluggish … maybe shorten it a
 * bit?"* 5s was chosen on a cost argument rather than a measured one, and the
 * cost it was protecting is bounded by the `interval` gate below: only a
 * VISIBLE, multi-member, non-demo trip polls on a timer, so this is 30 requests a
 * minute per open multi-traveller trip rather than per user.
 *
 * Worst-case latency is one interval plus the refetch, so this takes the
 * window a co-traveller's edit can sit invisible from ~5s to ~2s — the
 * difference between "did that save?" and "there it is".
 *
 * **The next move is adaptive, not shorter.** Halving this again buys less
 * each time and costs linearly; the real win is polling fast while someone is
 * actively working and backing off when they are not. Deliberately not built
 * here — it needs an activity signal this seam does not have, and a fixed
 * interval that is fast enough is worth more than a clever one that is not
 * yet written.
 */
export const POLL_INTERVAL_MS = 2000;

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
   * Whether this caller wants news at all. The caller decides, because the
   * reasons are the caller's: a trip that has not loaded has no cursor, and a
   * trip being previewed at an older seq should not have the present moving
   * underneath it. The demo trip is a fixture that never moves (ADR-031), so
   * the hook refuses that one itself rather than trusting every caller to.
   */
  enabled: boolean;
  /**
   * Whether it also polls on a timer. **Only this is gated on a second
   * writer** — the visibility-regain poll runs whenever `enabled` does, which
   * is ADR-049 Decision 2 as written (*"the visibility-regain poll runs
   * regardless, because one person in two tabs is a real case"*). The first
   * version gated both on one flag, so a solo trip's notebook never heard
   * about a stop moved in another tab (KI-2026-09-05-i item 5).
   */
  interval: boolean;
  /**
   * The cursor, read at poll time rather than passed by value — the confirmed
   * head moves under this hook every time the user's own edits land, and a
   * cursor captured when the effect was set up would re-report those as remote
   * news on every tick.
   */
  cursor: () => number;
  /**
   * "The trip moved", with the head the poll saw. Called at most once per poll
   * that has news. A caller with no history to read a cursor off (the
   * notebook) keeps this as its cursor; one with history ignores it.
   */
  onChanged: (headSeq: number) => void;
};

/**
 * Poll this trip's log while the document is visible, and say when it moved.
 *
 * Three behaviours worth naming, because each is a decision rather than a
 * detail:
 *
 * - **Hidden tabs do not poll at all**, and a tab coming back — or a window
 *   regaining focus — polls immediately rather than waiting out an interval,
 *   with or without one running. ADR-046 noted that nothing in this app
 *   listened for `visibilitychange`; this is the first thing that does, and
 *   returning to a tab is exactly when a stale board is most visible.
 * - **A failed poll is silent.** It is not a user-facing error: the next tick
 *   retries, the board still shows the user's own work, and an error banner for
 *   a background read the user never asked for would be noise. Nothing is lost
 *   by a missed poll, because the cursor only advances on a poll that succeeded.
 * - **`resync` is treated exactly like news.** Both mean "your cursor is behind
 *   the head"; the caller's answer to either is to refetch the trip, which is
 *   the one cheap request that fixes an arbitrarily large gap.
 */
export function useTripBroadcast({ tripId, enabled, interval, cursor, onChanged }: BroadcastArgs): void {
  // Held in refs so the effect below depends only on `tripId` and the gates.
  // Otherwise every render would tear down the interval and start a new one,
  // and a 5s interval that restarts every keystroke never fires.
  const cursorRef = useRef(cursor);
  const onChangedRef = useRef(onChanged);
  cursorRef.current = cursor;
  onChangedRef.current = onChanged;

  useEffect(() => {
    if (!enabled || isDemoTripId(tripId)) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    // One poll at a time. Returning to a tab fires `focus` and
    // `visibilitychange` together, and a slow poll can outlast an interval
    // tick; either way the second request would ask the question the first is
    // still asking, and report the same news twice.
    let inFlight = false;

    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const before = cursorRef.current();
        const result = await fetchTripEvents(tripId, before);
        // `cancelled` is checked AFTER the await: the provider may have
        // unmounted, or the trip changed, while this request was in flight, and
        // telling a dead caller its trip moved is how you get a setState on an
        // unmounted tree.
        if (cancelled || !result.ok) return;
        if (result.value.resync || result.value.headSeq > before) onChangedRef.current(result.value.headSeq);
      } finally {
        inFlight = false;
      }
    };

    const start = () => {
      if (!interval || timer !== null) return;
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

    // Two windows side by side are both visible, so moving from the board in
    // one to the notebook in the other fires no `visibilitychange` — focus is
    // what changes. KI-2026-09-05-i item 5 asked for exactly this pair.
    const onFocus = () => {
      if (document.visibilityState === "visible") void poll();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    if (document.visibilityState === "visible") start();

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [tripId, enabled, interval]);
}
