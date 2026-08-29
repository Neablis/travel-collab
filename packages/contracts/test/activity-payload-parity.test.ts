import { describe, expect, it } from "vitest";
import { ActivityAddedV1, ActivityUpdatedV1 } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";

// src/activity.ts composes both event payloads from one `ActivityPayloadFields`
// block, and its comment claims that is what keeps their defaults in step. This
// enforces the claim: hand the two payloads back their own duplicated field
// lists and these fail, which is exactly the pre-2026-08-28 state — a
// `.default()` landing on Added but not Updated corrupts replay for *updated*
// activities only, invisibly, until someone replays an old log.
describe("ActivityAdded/ActivityUpdated payload parity", () => {
  const shared = () => {
    const added = Object.keys(ActivityAddedV1.shape.payload.shape);
    const updated = Object.keys(ActivityUpdatedV1.shape.payload.shape);
    return { added, updated };
  };

  // Sorted, deliberately. `Object.keys` on a Zod shape reflects DECLARATION
  // order, so the previous `toEqual` also failed when two fields were merely
  // swapped in `ActivityPayloadFields` — a diff that changes nothing either
  // payload accepts or produces. Order is not part of this contract: event
  // payloads are stored in `event_log.payload` as jsonb (schema.ts), which
  // Postgres normalises rather than storing verbatim, and nothing hashes or
  // string-compares a payload. What this test exists to catch is a
  // `.default()` landing on one payload and not the other — a question about
  // the field SET. Failing on key order taught a reader to fix the order and
  // move on, which is the one reaction that can't find that bug.
  it("carry the same field set apart from dayId", () => {
    const { added, updated } = shared();
    // dayId is Added-only: an update never relocates an activity (that is
    // ActivityMoved), so there is nothing for it to say.
    expect(added.filter((k) => k !== "dayId").sort()).toEqual([...updated].sort());
  });

  it("materialise identical defaults from a minimal stored payload", () => {
    const bare = { tripId: TRIP, activityId: A1, title: "Den", timeWindow: null, location: null, notes: null };
    const added = ActivityAddedV1.parse({
      type: "ActivityAdded",
      version: 1,
      payload: { ...bare, dayId: null },
    }).payload;
    const updated = ActivityUpdatedV1.parse({
      type: "ActivityUpdated",
      version: 1,
      payload: bare,
    }).payload;

    const { dayId: _dayId, ...addedShared } = added;
    expect(updated).toEqual(addedShared);
    // Named explicitly so a newly-added defaulting field that only reached one
    // payload cannot hide behind a toEqual over two equally-incomplete objects.
    expect(addedShared).toMatchObject({ anchors: [], kind: "planned", tags: [], cost: null });
  });
});
