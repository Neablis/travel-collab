import { describe, expect, it } from "vitest";
import type { ActivityFormValue } from "./ActivityEditor";
import { addActivityCommand, updateActivityCommand } from "./activityCommands";

const TRIP = "11111111-1111-4111-8111-111111111111";
const ACT = "22222222-2222-4222-8222-222222222222";
const DAY = "33333333-3333-4333-8333-333333333333";

const form = (over: Partial<ActivityFormValue> = {}): ActivityFormValue => ({
  title: "Fushimi Inari",
  dayId: null,
  timeWindow: null,
  location: null,
  notes: null,
  anchors: [],
  kind: "planned",
  tags: [],
  cost: null,
  bookedBy: null,
  participants: [],
  mode: null,
  endLocation: null,
  ...over,
});

// The type-level guarantee (a field added to `ActivityFormValue` stops the
// build) is proven by the compiler, not here — adding one makes
// `activityCommands.ts` fail with `Type '{ … }' is not assignable to type
// 'NothingLeftOver'`, naming both builders. These cover what the compiler
// cannot: that each field lands in the right place, with the right null
// handling, which differs between the two commands.
describe("addActivityCommand", () => {
  it("carries every field the form holds", () => {
    const command = addActivityCommand(
      TRIP,
      ACT,
      form({
        dayId: DAY,
        timeWindow: { start: "09:00", end: "10:00" },
        notes: "book ahead",
        kind: "transit",
        tags: ["meal"],
        cost: { amountMinor: 4200, currency: "USD" },
        bookedBy: "alice",
        participants: ["alice", "bob"],
        mode: "train",
        endLocation: { name: "Kyoto Station" },
      }),
    );
    expect(command).toMatchObject({
      type: "AddActivity",
      tripId: TRIP,
      activityId: ACT,
      dayId: DAY,
      title: "Fushimi Inari",
      timeWindow: { start: "09:00", end: "10:00" },
      notes: "book ahead",
      kind: "transit",
      tags: ["meal"],
      cost: { amountMinor: 4200, currency: "USD" },
      bookedBy: "alice",
      participants: ["alice", "bob"],
      mode: "train",
      endLocation: { name: "Kyoto Station" },
    });
  });

  // On a create, absent and empty are the same thing: the optional fields mean
  // "not supplied" and the decider resolves each to its zero value. An explicit
  // null would be saying "cleared", which a stop being created cannot be.
  it("sends undefined rather than null for the optional fields", () => {
    const command = addActivityCommand(TRIP, ACT, form());
    expect(command.dayId).toBeUndefined();
    expect(command.timeWindow).toBeUndefined();
    expect(command.location).toBeUndefined();
    expect(command.notes).toBeUndefined();
    expect(command.cost).toBeUndefined();
    expect(command.mode).toBeUndefined();
    expect(command.endLocation).toBeUndefined();
  });

  // Attribution is NOT null-collapsed: `bookedBy: null` is the honest zero
  // value ("nobody yet") rather than an absence, and `participants: []` is a
  // real empty list.
  it("keeps attribution as given rather than collapsing it", () => {
    const command = addActivityCommand(TRIP, ACT, form());
    expect(command.bookedBy).toBeNull();
    expect(command.participants).toEqual([]);
  });
});

describe("updateActivityCommand", () => {
  it("carries every field the form holds", () => {
    const command = updateActivityCommand(
      TRIP,
      ACT,
      form({
        title: "Kiyomizu-dera",
        kind: "pending",
        tags: ["ticketed"],
        bookedBy: "bob",
        participants: ["bob"],
      }),
    );
    expect(command).toMatchObject({
      type: "UpdateActivity",
      tripId: TRIP,
      activityId: ACT,
      title: "Kiyomizu-dera",
      kind: "pending",
      tags: ["ticketed"],
      bookedBy: "bob",
      participants: ["bob"],
    });
  });

  // The opposite of the create path, and the reason the two builders exist
  // separately: `UpdateActivity` reads omitted as "unchanged", so collapsing
  // null to undefined here would turn every "clear the time window" into a
  // silent no-op.
  it("passes null through, because on an update null means cleared", () => {
    const command = updateActivityCommand(TRIP, ACT, form());
    expect(command.timeWindow).toBeNull();
    expect(command.location).toBeNull();
    expect(command.notes).toBeNull();
    expect(command.cost).toBeNull();
    expect(command.bookedBy).toBeNull();
    // M24: what lets a stop leave `transit` — the decider refuses a leg left
    // behind, so the editor's cleared leg has to reach it as a clear.
    expect(command.mode).toBeNull();
    expect(command.endLocation).toBeNull();
  });

  // `ActivityEditor` disables the Day select in edit mode for this reason: a
  // cross-day move is `MoveActivity`'s job, not this form's. The field is
  // destructured and discarded rather than ignored, so the exhaustiveness
  // check cannot be satisfied by forgetting about it.
  it("never sends a dayId, even when the form holds one", () => {
    const command = updateActivityCommand(TRIP, ACT, form({ dayId: DAY }));
    expect(command).not.toHaveProperty("dayId");
  });
});
