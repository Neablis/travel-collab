import { describe, expect, it } from "vitest";
import { newPageDoc } from "@tc/contracts";
import { scenarios } from "@tc/factories";
import { toPublicNotebookView } from "./publicView";

// M58 (ADR-088 §5): three floors hold whatever a widget's setting says,
// because they are in the view, not in the widgets. Each test below was seen
// red by removing the one line that holds its floor.

const page = { title: "Plan", content: newPageDoc() };

// A trip whose first stop is a booked, attributed one, with members and a chat
// attached to the input the way a real read would carry them.
function tripWithPeople() {
  const trip = scenarios.threeDayTrip();
  const id = trip.days[0]!.activityIds[0]!;
  const stop = trip.activities[id]!;
  const full = {
    ...trip,
    members: [{ userId: "user-sam-secret", role: "owner" as const }],
    activities: {
      ...trip.activities,
      [id]: {
        ...stop,
        addedBy: "user-sam-secret",
        bookedBy: "user-alex-secret",
        participants: ["user-alex-secret"],
        booking: { confirmation: "XK29QP", provider: "Opentable", url: "https://example.com/manage/XK29QP" },
      },
    },
    // Not a TripDetail field: a caller that spreads a richer object in must not leak it.
    chat: [{ id: "m1", text: "meet at the airport at six" }],
  };
  return { full, id };
}

describe("toPublicNotebookView", () => {
  it("floor 1: a booking keeps its provider and loses its code and manage link", () => {
    const { full, id } = tripWithPeople();
    const view = toPublicNotebookView(full, page, 3);
    expect(view.activities[id]!.booking).toEqual({ provider: "Opentable" });
    expect(JSON.stringify(view)).not.toContain("XK29QP");
  });

  it("floor 2: no chat reaches the view", () => {
    const { full } = tripWithPeople();
    const view = toPublicNotebookView(full, page, 3);
    expect(Object.keys(view)).not.toContain("chat");
    expect(JSON.stringify(view)).not.toContain("meet at the airport");
  });

  it("floor 3: no stop names who added or booked it, and no member id is in the view", () => {
    const { full, id } = tripWithPeople();
    const view = toPublicNotebookView(full, page, 3);
    expect(view.activities[id]).toMatchObject({ addedBy: null, bookedBy: null, participants: [] });
    expect(Object.keys(view)).not.toContain("members");
    expect(JSON.stringify(view)).not.toMatch(/secret/);
  });

  it("carries the page and the trip's own plan, and only the listed fields", () => {
    const { full } = tripWithPeople();
    const view = toPublicNotebookView(full, page, 3);
    expect(Object.keys(view).sort()).toEqual(
      ["activities", "backlog", "budget", "currency", "days", "page", "startDate", "tripCostTotal", "tripId", "travellerCount", "unscheduledCostSubtotal", "name"].sort(),
    );
    expect(view.page).toEqual(page);
    expect(view.travellerCount).toBe(3);
  });
});
