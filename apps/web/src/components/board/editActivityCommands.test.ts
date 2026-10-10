import { describe, expect, it } from "vitest";
import { activityFactory, tripDetailFixture } from "@tc/factories";
import type { ActivityView } from "@tc/contracts";
import type { ActivityFormValue } from "./ActivityEditor";
import { editActivityCommands } from "./editActivityCommands";
import { moveCommands } from "./moveCommands";

const DAY_1 = "11111111-1111-4111-8111-111111111111";
const DAY_2 = "22222222-2222-4222-8222-222222222222";
const TIMED = activityFactory.build({ timeWindow: { start: "10:00", end: "11:00" } });
const PARKED = activityFactory.build({ timeWindow: null });

const trip = tripDetailFixture({
  days: [
    { dayId: DAY_1, activityIds: [TIMED.activityId], date: "2027-06-01", costSubtotal: 0 },
    { dayId: DAY_2, activityIds: [], date: "2027-06-02", costSubtotal: 0 },
  ],
  backlog: [PARKED.activityId],
  activities: { [TIMED.activityId]: TIMED, [PARKED.activityId]: PARKED },
});

/** The form as the editor would hand it back for `activity`, on `dayId`. */
function form(activity: ActivityView, dayId: string | null): ActivityFormValue {
  const { activityId: _id, ...fields } = activity;
  void _id;
  return { ...fields, dayId } as ActivityFormValue;
}

describe("editActivityCommands", () => {
  it("is the one update it always was when the day is unchanged", () => {
    const commands = editActivityCommands(trip, TIMED.activityId, form(TIMED, DAY_1));
    expect(commands.map((c) => c.type)).toEqual(["UpdateActivity"]);
  });

  it("is only the move a drag builds when nothing but the day changed", () => {
    // The update would be a no-op, and the optimistic queue refuses a whole
    // unit over one, so sending it would drop the move too.
    expect(editActivityCommands(trip, TIMED.activityId, form(TIMED, DAY_2))).toEqual(
      moveCommands(trip, [TIMED.activityId], DAY_2),
    );
  });

  it("moves, then updates, when other fields changed too, keeping the stop's time", () => {
    const commands = editActivityCommands(trip, TIMED.activityId, { ...form(TIMED, DAY_2), title: "Renamed" });
    expect(commands).toEqual([
      ...moveCommands(trip, [TIMED.activityId], DAY_2),
      expect.objectContaining({ type: "UpdateActivity", title: "Renamed", timeWindow: { start: "10:00", end: "11:00" } }),
    ]);
  });

  it("gives a parked stop a time when it is put on a day without one, so it leaves the rack", () => {
    const commands = editActivityCommands(trip, PARKED.activityId, form(PARKED, DAY_2));
    expect(commands.at(-1)).toEqual(
      expect.objectContaining({ type: "UpdateActivity", timeWindow: { start: "09:00", end: "10:00" } }),
    );
  });

  it("strips the time when a stop is parked", () => {
    const commands = editActivityCommands(trip, TIMED.activityId, form(TIMED, null));
    expect(commands).toEqual([
      expect.objectContaining({ type: "MoveActivity", toDayId: null }),
      expect.objectContaining({ type: "UpdateActivity", timeWindow: null }),
    ]);
  });
});
