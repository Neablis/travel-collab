import { describe, expect, it } from "vitest";
import {
  enqueue,
  confirmHead,
  failHead,
  clearFailure,
  unsentCount,
  activeDetail,
  activeHistory,
  type HistoryRow,
  type OptimisticState,
} from "./optimistic";
import { tripDetailFixture, historyFixture } from "@tc/factories";

const tripId = tripDetailFixture().tripId;
const base = (): OptimisticState => ({
  confirmed: { detail: tripDetailFixture(), history: historyFixture(tripId) },
  pending: [],
});

describe("optimistic state machine", () => {
  it("enqueue applies a predicted unit; activeDetail reflects it before confirm", () => {
    const r = enqueue(base(), "u1", [{ type: "AddDay", tripId, dayId: "d-new" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(activeDetail(r.state).days.some((d) => d.dayId === "d-new")).toBe(true);
    expect(r.state.pending).toHaveLength(1);
  });

  it("enqueue surfaces a rejection without mutating state", () => {
    const r = enqueue(base(), "u1", [{ type: "MoveActivity", tripId, activityId: "ghost", toDayId: null, position: 0 }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("activity-not-found");
  });

  it("confirmHead adopts the authoritative outcome and drops the head", () => {
    const q = enqueue(base(), "u1", [{ type: "AddDay", tripId, dayId: "d-new" }]);
    if (!q.ok) throw new Error("setup");
    const authoritative = { detail: tripDetailFixture(), history: historyFixture(tripId) };
    const next = confirmHead(q.state, authoritative);
    expect(next.pending).toHaveLength(0);
    expect(activeHistory(next).entries).toEqual(authoritative.history.entries);
  });

  // KI-36. This used to assert the opposite ("failHead drops the failed unit
  // AND everything queued behind it") and passed — that was the bug, written
  // down. The old behaviour discarded work the UI had already shown the user
  // as applied, telling them only about the single command the server named.
  describe("failHead retains the queue and records the failure (KI-36)", () => {
    const twoQueued = (): OptimisticState => {
      let s = base();
      const a = enqueue(s, "u1", [{ type: "AddDay", tripId, dayId: "d-a" }]);
      if (!a.ok) throw new Error("setup"); s = a.state;
      const b = enqueue(s, "u2", [{ type: "AddDay", tripId, dayId: "d-b" }]);
      if (!b.ok) throw new Error("setup"); s = b.state;
      return s;
    };
    const failure = { at: "2026-08-25T12:00:00.000Z", message: "boom" };

    it("keeps the failed head AND everything queued behind it — nothing is discarded", () => {
      const failed = failHead(twoQueued(), failure);
      expect(failed.pending.map((u) => u.id)).toEqual(["u1", "u2"]);
      expect(unsentCount(failed)).toBe(2);
      // The user's edits stay visible, because they are still real work.
      expect(activeDetail(failed).days.some((d) => d.dayId === "d-a")).toBe(true);
      expect(activeDetail(failed).days.some((d) => d.dayId === "d-b")).toBe(true);
    });

    it("records the failure verbatim, taking the instant as a parameter (no clock in the reducer)", () => {
      expect(failHead(twoQueued(), failure).failure).toEqual(failure);
      // Same input, same output — the reducer is pure, so the timestamp is
      // whatever the caller passed and never `Date.now()` read in here.
      expect(failHead(twoQueued(), failure)).toEqual(failHead(twoQueued(), failure));
    });

    it("leaves confirmed state untouched", () => {
      const s = twoQueued();
      expect(failHead(s, failure).confirmed).toBe(s.confirmed);
    });

    it("keeps the failure across further edits — enqueueing while failed does not silently un-fail", () => {
      const failed = failHead(twoQueued(), failure);
      const more = enqueue(failed, "u3", [{ type: "AddDay", tripId, dayId: "d-c" }]);
      if (!more.ok) throw new Error("setup");
      expect(more.state.failure).toEqual(failure);
      expect(unsentCount(more.state)).toBe(3);
    });

    it("clearFailure lifts the gate without touching the retained queue", () => {
      const failed = failHead(twoQueued(), failure);
      const retried = clearFailure(failed);
      expect(retried.failure).toBeUndefined();
      expect(retried.pending.map((u) => u.id)).toEqual(["u1", "u2"]);
    });

    it("clearFailure on a healthy state is identity — no needless re-render or re-send", () => {
      const s = twoQueued();
      expect(clearFailure(s)).toBe(s);
    });

    it("a successful send after a retry clears the failure with the queue", () => {
      const failed = failHead(twoQueued(), failure);
      const authoritative = { detail: tripDetailFixture(), history: historyFixture(tripId) };
      expect(confirmHead(clearFailure(failed), authoritative).failure).toBeUndefined();
    });
  });

  // KI-42. The successful-send trigger of the same silent-loss class as KI-5
  // and KI-36: the head send SUCCEEDS, `confirmHead` adopts the authoritative
  // state, and any queued unit that no longer predicts against it used to be
  // dropped — along with everything queued behind it, via the loop's `break`.
  // The user had already been shown those edits as applied, and nothing said a
  // word: the units never reached the server, so `failHead` never saw them.
  describe("confirmHead retains queued units that no longer predict (KI-42)", () => {
    // u1 adds a day, u2 puts an activity on that day, u3 is an independent
    // later edit. The server confirms u1 with an authoritative state that does
    // NOT contain the day (a concurrent removal, say) — so u2 cannot
    // re-predict, and u3, which would re-predict perfectly well on its own,
    // sits behind it.
    const queued = (): OptimisticState => {
      let s = base();
      const a = enqueue(s, "u1", [{ type: "AddDay", tripId, dayId: "d-a" }]);
      if (!a.ok) throw new Error("setup"); s = a.state;
      const b = enqueue(s, "u2", [
        { type: "AddActivity", tripId, activityId: "act-1", dayId: "d-a", title: "Colosseum tour" },
      ]);
      if (!b.ok) throw new Error("setup"); s = b.state;
      const c = enqueue(s, "u3", [{ type: "AddDay", tripId, dayId: "d-c" }]);
      if (!c.ok) throw new Error("setup"); s = c.state;
      return s;
    };
    // The head's authoritative outcome, without the day u1 asked for.
    const authoritative = () => ({ detail: tripDetailFixture(), history: historyFixture(tripId) });

    it("keeps the unpredictable unit AND everything queued behind it", () => {
      const next = confirmHead(queued(), authoritative());
      expect(next.pending.map((u) => u.id)).toEqual(["u2", "u3"]);
      expect(unsentCount(next)).toBe(2);
    });

    // The old comment's claim ("it will be reported via failHead semantics at
    // send time") was false precisely because the units left `pending`. This
    // is that claim enforced: the retained head is intact and the sender is
    // not gated, so the send — and therefore the server's verdict, and
    // therefore `failHead` — actually happens.
    it("leaves the retained units in a state the sender will send", () => {
      const next = confirmHead(queued(), authoritative());
      expect(next.pending[0]!.commands).toEqual([
        { type: "AddActivity", tripId, activityId: "act-1", dayId: "d-a", title: "Colosseum tour" },
      ]);
      // TripProvider's sequential sender runs while pending is non-empty and
      // no failure is recorded. A successful send records none.
      expect(next.failure).toBeUndefined();
    });

    it("keeps the retained units visible as pending history rows", () => {
      const next = confirmHead(queued(), authoritative());
      const rows: HistoryRow[] = activeHistory(next).entries;
      const pendingRows = rows.filter((e) => e.pending);
      expect(pendingRows.map((e) => e.batchId)).toEqual(["u3", "u2"]); // newest first
    });

    // Retained, but not rendered: a unit with no valid prediction contributes
    // nothing to the displayed trip, so the board shows the authoritative
    // state rather than a prediction computed against a base the server
    // replaced.
    it("shows the authoritative state, not a stale prediction", () => {
      const next = confirmHead(queued(), authoritative());
      expect(activeDetail(next)).toEqual(authoritative().detail);
    });

    it("keeps predicting the units AHEAD of the unpredictable one", () => {
      let s = base();
      for (const [id, command] of [
        ["u1", { type: "AddDay" as const, tripId, dayId: "d-a" }],
        ["u2", { type: "AddDay" as const, tripId, dayId: "d-b" }],
        ["u3", { type: "AddActivity" as const, tripId, activityId: "act-1", dayId: "d-a", title: "Colosseum tour" }],
        ["u4", { type: "AddDay" as const, tripId, dayId: "d-d" }],
      ] as const) {
        const r = enqueue(s, id, [command]);
        if (!r.ok) throw new Error("setup"); s = r.state;
      }
      const next = confirmHead(s, authoritative());
      expect(next.pending.map((u) => u.id)).toEqual(["u2", "u3", "u4"]);
      expect(next.pending.map((u) => u.predictedDetail !== null)).toEqual([true, false, false]);
      // u2 still predicts, so its day is still on screen; u4 is retained
      // unpredicted behind u3, so it is not — it is ordered after an edit the
      // client can no longer model.
      expect(activeDetail(next).days.some((d) => d.dayId === "d-b")).toBe(true);
      expect(activeDetail(next).days.some((d) => d.dayId === "d-d")).toBe(false);
    });

    // Retention is what makes recovery possible: the next authoritative
    // outcome may be one the retained unit predicts against perfectly well.
    it("re-predicts a retained unit once the head ahead of it is confirmed", () => {
      // The sender sends the retained head (u2); the server accepts it. u3,
      // retained unpredicted only because it sat behind u2, predicts again.
      const stalled = confirmHead(queued(), authoritative());
      const recovered = confirmHead(stalled, authoritative());
      expect(recovered.pending.map((u) => u.id)).toEqual(["u3"]);
      expect(recovered.pending[0]!.predictedDetail).not.toBeNull();
      expect(activeDetail(recovered).days.some((d) => d.dayId === "d-c")).toBe(true);
    });
  });
});
