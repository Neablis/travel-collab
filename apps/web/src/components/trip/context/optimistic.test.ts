import { describe, expect, it } from "vitest";
import {
  enqueue,
  confirmHead,
  failHead,
  clearFailure,
  unsentCount,
  activeDetail,
  activeHistory,
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
});
