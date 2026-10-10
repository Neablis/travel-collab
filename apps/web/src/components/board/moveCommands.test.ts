import { describe, expect, it } from "vitest";
import { activityFactory, tripDetailFixture } from "@tc/factories";
import { moveCommands } from "./moveCommands";

const DAY_1 = "11111111-1111-4111-8111-111111111111";
const DAY_2 = "22222222-2222-4222-8222-222222222222";
const NEW_DAY = "33333333-3333-4333-8333-333333333333";
const [A, B, C, PARKED] = activityFactory.buildList(4).map((a) => a.activityId);

function trip() {
  return tripDetailFixture({
    days: [
      { dayId: DAY_1, activityIds: [A!, B!], date: "2027-06-01", costSubtotal: 0 },
      { dayId: DAY_2, activityIds: [C!], date: "2027-06-02", costSubtotal: 0 },
    ],
    backlog: [PARKED!],
  });
}

describe("moveCommands", () => {
  it("appends each stop to the end of the day it moves to, in order", () => {
    expect(moveCommands(trip(), [A!, B!], DAY_2)).toEqual([
      expect.objectContaining({ type: "MoveActivity", activityId: A, toDayId: DAY_2, position: 1 }),
      expect.objectContaining({ type: "MoveActivity", activityId: B, toDayId: DAY_2, position: 2 }),
    ]);
  });

  it("parks at the end of the rack", () => {
    expect(moveCommands(trip(), [C!], null)).toEqual([
      expect.objectContaining({ type: "MoveActivity", activityId: C, toDayId: null, position: 1 }),
    ]);
  });

  it("sends nothing for a stop already on the day, which would be an undo step that changes nothing", () => {
    expect(moveCommands(trip(), [A!], DAY_1)).toEqual([]);
  });

  it("keeps a drop's own position, which on the stop's own day is a reorder", () => {
    expect(moveCommands(trip(), [B!], DAY_1, { position: 0 })).toEqual([
      expect.objectContaining({ type: "MoveActivity", activityId: B, toDayId: DAY_1, position: 0 }),
    ]);
  });

  it("adds the new days before moving onto one, so the batch can be decided in order", () => {
    expect(moveCommands(trip(), [C!], NEW_DAY, { newDayIds: [NEW_DAY] })).toEqual([
      expect.objectContaining({ type: "AddDay", dayId: NEW_DAY }),
      expect.objectContaining({ type: "MoveActivity", activityId: C, toDayId: NEW_DAY, position: 0 }),
    ]);
  });
});
