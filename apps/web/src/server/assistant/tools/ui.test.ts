// ADR-084 §2's safety claim for cards: the server fills every card from what a
// tool returned this turn, so a card cannot show a place or a day the model
// made up. And a widget asked for after a drafted change is refused, since the
// change's card is the turn's one outcome and the widget would never render.
import { describe, expect, it } from "vitest";
import { newPlaceCache, newUiOutcomeBuffer, type UiOutcomeBuffer } from "@/server/assistant/deps";
import { askUserTool, handOffTool, showOptionsTool } from "./ui";

const ICHIRAN = { name: "Ichiran Shibuya", lat: 35.66, lng: 139.7, area: "Shibuya", city: "Tokyo" };
const FOOD_DAY = { savedDayId: "day-food", name: "A day of ramen", cities: ["Tokyo"], stopCount: 4 };

function turn(drafting = false): { uiOutcome: UiOutcomeBuffer; placeCache: ReturnType<typeof newPlaceCache> } {
  const placeCache = newPlaceCache();
  placeCache.add([ICHIRAN]);
  const uiOutcome = newUiOutcomeBuffer(["new_trip", "nowhere"], async () => ({ refused: "No trip here." }), () => drafting);
  uiOutcome.noteDays([FOOD_DAY]);
  return { uiOutcome, placeCache };
}

describe("show_options", () => {
  it("fills each card from the search that returned it, and cannot show an invented place", async () => {
    const deps = turn();
    const shown = await showOptionsTool.invoke({ prompt: "Two to try", places: [1, 7] }, deps);
    expect(shown).toEqual({ shown: true, note: expect.stringContaining("Left out, since no tool returned them: place 7") });
    expect(deps.uiOutcome.outcome()).toEqual({
      options: { id: "ask", prompt: "Two to try", cards: [{ kind: "place", id: "place-1", name: "Ichiran Shibuya", area: "Shibuya", city: "Tokyo" }] },
    });
  });

  it("shows a published day only as search_playbooks returned it", async () => {
    const deps = turn();
    await showOptionsTool.invoke({ prompt: "Days like it", days: ["day-food", "day-made-up"] }, deps);
    expect(deps.uiOutcome.outcome()).toEqual({
      options: { id: "ask", prompt: "Days like it", cards: [{ kind: "day", id: "day-food", name: "A day of ramen", cities: ["Tokyo"], stopCount: 4 }] },
    });
  });

  it("refuses a call naming nothing a tool returned, and ends the turn in no cards", async () => {
    const deps = turn();
    expect(await showOptionsTool.invoke({ prompt: "Made up", places: [3] }, deps)).toEqual({ shown: false, refused: expect.stringContaining("Search first") });
    expect(deps.uiOutcome.outcome()).toBeNull();
  });
});

describe("a widget after a drafted change", () => {
  it("is refused by all three, so the last sentence never points at a widget that does not render", async () => {
    const deps = turn(true);
    const refused = { shown: false, refused: expect.stringContaining("already drafts a change") };
    expect(await showOptionsTool.invoke({ prompt: "Two to try", places: [1] }, deps)).toEqual(refused);
    expect(await askUserTool.invoke({ question: "Which?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }, deps)).toEqual(refused);
    expect(await handOffTool.invoke({ task: "plan a trip", to: "new_trip" }, deps)).toEqual(refused);
    expect(deps.uiOutcome.outcome()).toBeNull();
  });
});
