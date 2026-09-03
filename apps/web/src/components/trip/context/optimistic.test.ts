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
    // send time") was false precisely because the units left `pending`.
    //
    // This reducer-level test can only show the retained head is ELIGIBLE to
    // be sent — intact commands, in order, with no `failure` gating the
    // sender. It never invokes TripProvider's sender, so on its own it would
    // stay green through a sender regression, which is the same "asserted but
    // unenforced" shape KI-42 was. The end-to-end claim — that the retained
    // unit actually reaches the server — is enforced in
    // `TripProvider.test.tsx`, "TripProvider retained-unit sender (KI-42)".
    it("leaves the retained head eligible for the sender: intact and ungated", () => {
      const next = confirmHead(queued(), authoritative());
      expect(next.pending[0]!.commands).toEqual([
        { type: "AddActivity", tripId, activityId: "act-1", dayId: "d-a", title: "Colosseum tour" },
      ]);
      // TripProvider's sequential sender runs while pending is non-empty and
      // no failure is recorded. A successful send records none.
      expect(next.failure).toBeUndefined();
    });

    // KI-55, fixed. `enqueue` used to predict a NEWLY queued unit against
    // `baseDetail`, which skips the retained nulls — so the new prediction
    // (and therefore `activeDetail`) rendered that unit's work while omitting
    // work queued AHEAD of it that was still going to be sent. It now queues
    // the unit unpredicted instead, which keeps the nulls a strict suffix of
    // `pending`. This test used to assert the inverse and passed; that was the
    // bug, written down. See KI-55 under docs/known-issues/resolved/.
    it("queues a unit behind retained ones unpredicted, so the preview stays honest (KI-55)", () => {
      const retained = confirmHead(queued(), authoritative());
      expect(retained.pending.every((u) => u.predictedDetail === null)).toBe(true);

      const added = enqueue(retained, "u4", [{ type: "AddDay", tripId, dayId: "d-d" }]);
      expect(added.ok).toBe(true);
      if (!added.ok) throw new Error("unreachable");

      // Nothing is lost: the new unit is queued and counted alongside the
      // retained ones, in order, and the sender is still ungated.
      expect(added.state.pending.map((u) => u.id)).toEqual(["u2", "u3", "u4"]);
      expect(unsentCount(added.state)).toBe(3);
      expect(added.state.failure).toBeUndefined();
      // It carries no prediction, so the nulls remain a suffix.
      expect(added.state.pending.map((u) => u.predictedDetail)).toEqual([null, null, null]);
      // And the board shows the authoritative trip: no d-c, and no d-d either.
      // Assert the day *identities*, not just the count — "renders d-c, omits
      // d-d" has the same count as the correct answer and as the old bug.
      const shown = activeDetail(added.state);
      expect(shown).toEqual(authoritative().detail);
      const shownDayIds = shown.days.map((day) => day.dayId);
      expect(shownDayIds).not.toContain("d-d");
      expect(shownDayIds).not.toContain("d-c");
    });

    // The barrier has to hold for the whole tail, not just the first unit past
    // it. Before the fix each new unit predicted over the previous one's
    // detail, so the divergence compounded: two edits, a preview two days
    // ahead of a trip that omitted the two retained units entirely.
    it("keeps every later unit unpredicted, not just the first (KI-55)", () => {
      const retained = confirmHead(queued(), authoritative());
      const a = enqueue(retained, "u4", [{ type: "AddDay", tripId, dayId: "d-d" }]);
      if (!a.ok) throw new Error("setup");
      const b = enqueue(a.state, "u5", [{ type: "AddDay", tripId, dayId: "d-e" }]);
      if (!b.ok) throw new Error("setup");

      expect(b.state.pending.map((u) => u.id)).toEqual(["u2", "u3", "u4", "u5"]);
      expect(b.state.pending.every((u) => u.predictedDetail === null)).toBe(true);
      expect(activeDetail(b.state)).toEqual(authoritative().detail);
    });

    // The barrier withholds the predicted DETAIL, not the unit and not its
    // description: the user's edit is still named in the pending history,
    // exactly like the retained units ahead of it, so a board that stops
    // moving is not a queue that has gone silent.
    it("still describes the unit it queues unpredicted (KI-55)", () => {
      const retained = confirmHead(queued(), authoritative());
      const added = enqueue(retained, "u4", [{ type: "AddDay", tripId, dayId: "d-d" }]);
      if (!added.ok) throw new Error("setup");

      const u4 = added.state.pending.find((u) => u.id === "u4")!;
      expect(u4.description).not.toBe("");
      const rows: HistoryRow[] = activeHistory(added.state).entries;
      expect(rows.filter((e) => e.pending).map((e) => e.batchId)).toEqual(["u4", "u3", "u2"]);
    });

    // The barrier is a queue condition, not a validation change: a command
    // that cannot apply to the trip the user is looking at is still refused
    // with the predictor's own code, rather than being swallowed into the
    // unpredicted tail where nothing would ever tell the user about it.
    it("still rejects an impossible command while the queue is unpredictable (KI-55)", () => {
      const retained = confirmHead(queued(), authoritative());
      const r = enqueue(retained, "u4", [
        { type: "MoveActivity", tripId, activityId: "ghost", toDayId: null, position: 0 },
      ]);
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error("unreachable");
      expect(r.code).toBe("activity-not-found");
    });

    // The barrier lifts on its own. Once the retained units drain (here: the
    // server confirms them one by one), the next edit predicts and the board
    // moves again — the cost is bounded by the queue, not sticky.
    it("resumes predicting once the queue has no unpredicted unit left (KI-55)", () => {
      const retained = confirmHead(queued(), authoritative());
      const added = enqueue(retained, "u4", [{ type: "AddDay", tripId, dayId: "d-d" }]);
      if (!added.ok) throw new Error("setup");

      // u2, u3 and u4 each reach the server and are confirmed in order.
      let s = added.state;
      s = confirmHead(s, authoritative());
      s = confirmHead(s, authoritative());
      s = confirmHead(s, authoritative());
      expect(s.pending).toHaveLength(0);

      const next = enqueue(s, "u6", [{ type: "AddDay", tripId, dayId: "d-f" }]);
      expect(next.ok).toBe(true);
      if (!next.ok) throw new Error("unreachable");
      expect(activeDetail(next.state).days.map((day) => day.dayId)).toContain("d-f");
    });

    // KI-55 REPRODUCTION. The queue is sent sequentially, in order, so any
    // trip the server can ever hold while this queue drains contains the work
    // of a PREFIX of the queue. u3 (AddDay d-c) is queued ahead of u4 (AddDay
    // d-d): no send produces a trip with d-d and without d-c. The rendered
    // preview must therefore never show a later unit's work while omitting an
    // earlier queued unit's.
    it("never previews a later unit's work while omitting an earlier queued unit's (KI-55)", () => {
      const retained = confirmHead(queued(), authoritative());
      const added = enqueue(retained, "u4", [{ type: "AddDay", tripId, dayId: "d-d" }]);
      expect(added.ok).toBe(true);
      if (!added.ok) throw new Error("unreachable");

      const shownDayIds = activeDetail(added.state).days.map((day) => day.dayId);
      const sendOrder = ["d-c", "d-d"]; // u3 then u4
      const shownFromQueue = sendOrder.filter((dayId) => shownDayIds.includes(dayId));
      // Whatever the preview shows of the queue must be a PREFIX of the send
      // order. Showing ["d-d"] means previewing u4 without u3, which no send
      // ever reaches.
      expect(shownFromQueue).toEqual(sendOrder.slice(0, shownFromQueue.length));
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
