import { describe, expect, it } from "vitest";
import { enqueue, confirmHead, failHead, activeDetail, activeHistory, type OptimisticState } from "./optimistic";
import { tripDetailFixture, historyFixture } from "@/mocks/fixtures";

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

  it("failHead drops the failed unit AND everything queued behind it", () => {
    let s = base();
    const a = enqueue(s, "u1", [{ type: "AddDay", tripId, dayId: "d-a" }]);
    if (!a.ok) throw new Error("setup"); s = a.state;
    const b = enqueue(s, "u2", [{ type: "AddDay", tripId, dayId: "d-b" }]);
    if (!b.ok) throw new Error("setup"); s = b.state;
    const rolled = failHead(s);
    expect(rolled.pending).toHaveLength(0);
    expect(activeDetail(rolled).days.some((d) => d.dayId === "d-a" || d.dayId === "d-b")).toBe(false);
  });
});
