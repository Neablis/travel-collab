import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activityFactory, tripDetailFixture, uuidFrom } from "@tc/factories";
import { tripTargets } from "@/components/palette/commands";
import { registerBoardFocus, resolveLink, useBoardFocus, type BoardFocus } from "./boardFocus";

const DAY = uuidFrom(1, 46);
const placed = activityFactory.build({ activityId: uuidFrom(2, 46), title: "Colosseum" });
const parked = activityFactory.build({ activityId: uuidFrom(3, 46), title: "Gelato" });
const trip = tripDetailFixture({
  days: [{ dayId: DAY, activityIds: [placed.activityId], date: null, costSubtotal: 0 }],
  backlog: [parked.activityId],
  activities: { [placed.activityId]: placed, [parked.activityId]: parked },
});
const board = (): BoardFocus => ({ ...tripTargets(trip, { focusedActivityId: null, focusedDayId: null, selectedDayId: null }), focusDay: vi.fn(), focusActivity: vi.fn() });

let cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.forEach((undo) => undo());
  cleanups = [];
});

describe("the board's focus, as chat reads it (M46 D3)", () => {
  // A board remounting registers its new entry before the old one's cleanup
  // runs: that cleanup must not take the new one away.
  it("keeps the newer board when an older one takes its entry back", () => {
    const older = board();
    const newer = board();
    const takeBackOlder = registerBoardFocus(older);
    cleanups.push(registerBoardFocus(newer));
    takeBackOlder();
    expect(renderHook(() => useBoardFocus()).result.current).toBe(newer);
  });

  // ⌘K's *Go to › Stop* offers no parked stop: it is on no day to go to.
  it("resolves a stop on a day, and not a parked one", () => {
    const here = board();
    expect(resolveLink(here, { kind: "stop", id: placed.activityId })?.label).toBe("Colosseum");
    expect(resolveLink(here, { kind: "stop", id: parked.activityId })).toBeNull();
  });
});
