// ADR-084 §2's safety claim for cards: the server fills every card from what a
// tool returned this turn, so a card cannot show a place or a day the model
// made up. And a widget asked for after a drafted change is refused, since the
// change's card is the turn's one outcome and the widget would never render.
import { describe, expect, it } from "vitest";
import { newPlaceCache, newUiOutcomeBuffer, type UiOutcomeBuffer } from "@/server/assistant/deps";
import { repairToolInput } from "@/server/assistant/repairToolInput";
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
      options: { id: "ask", prompt: "How about Ichiran Shibuya?", cards: [{ kind: "place", id: "place-1", name: "Ichiran Shibuya", area: "Shibuya", city: "Tokyo" }] },
    });
  });

  // A city or district result is named by itself, and a line under it saying
  // the same word again tells the person nothing.
  it("leaves out an area or city that only repeats the card's name", async () => {
    const deps = turn();
    deps.placeCache.add([
      { name: "New Orleans", lat: 29.95, lng: -90.07, city: "New Orleans" },
      { name: "Warehouse District", lat: 29.94, lng: -90.07, area: "Warehouse District", city: "New Orleans" },
    ]);
    await showOptionsTool.invoke({ prompt: "Where to stay", places: [2, 3] }, deps);
    expect(deps.uiOutcome.outcome()).toEqual({
      options: {
        id: "ask",
        prompt: "Where to stay",
        cards: [
          { kind: "place", id: "place-2", name: "New Orleans" },
          { kind: "place", id: "place-3", name: "Warehouse District", city: "New Orleans" },
        ],
      },
    });
  });

  it("shows a published day only as search_playbooks returned it", async () => {
    const deps = turn();
    await showOptionsTool.invoke({ prompt: "Days like it", days: ["day-food", "day-made-up"] }, deps);
    expect(deps.uiOutcome.outcome()).toEqual({
      options: { id: "ask", prompt: "How about A day of ramen?", cards: [{ kind: "day", id: "day-food", name: "A day of ramen", cities: ["Tokyo"], stopCount: 4 }] },
    });
  });

  it("refuses a call naming nothing a tool returned, and ends the turn in no cards", async () => {
    const deps = turn();
    expect(await showOptionsTool.invoke({ prompt: "Made up", places: [3] }, deps)).toEqual({ shown: false, refused: expect.stringContaining("Search first") });
    expect(deps.uiOutcome.outcome()).toBeNull();
  });

  // PR 652 review: "Pick a day" over a lone card with Yes and No reads as a
  // choice with nothing to choose. The prompt becomes a question about it.
  it("asks about the one card left when the others were dropped, and says so", async () => {
    const deps = turn();
    const shown = await showOptionsTool.invoke({ prompt: "Pick a day", days: ["day-food", "day-made-up"] }, deps);
    expect(deps.uiOutcome.outcome()).toMatchObject({ options: { prompt: "How about A day of ramen?" } });
    expect(shown).toEqual({ shown: true, note: expect.stringContaining('"How about A day of ramen?"') });
  });

  // A whole-address name can run past the contract's 200 once asked about, and
  // a prompt over it drops the whole widget where the client parses it.
  it("keeps the model's own prompt when asking about the one card would run over 200", async () => {
    const deps = turn();
    deps.placeCache.add([{ name: "A".repeat(195), lat: 35.64, lng: 139.71 }]);
    await showOptionsTool.invoke({ prompt: "Two to try", places: [2, 99] }, deps);
    expect(deps.uiOutcome.outcome()).toMatchObject({ options: { prompt: "Two to try" } });
  });

  it("keeps the model's own prompt when it asked about one card", async () => {
    const deps = turn();
    await showOptionsTool.invoke({ prompt: "Add Ichiran?", places: [1] }, deps);
    expect(deps.uiOutcome.outcome()).toMatchObject({ options: { prompt: "Add Ichiran?" } });
  });

  // A fifth ref is cut before `run` sees it (`repairToolInput`), so the note
  // names what is on screen: the last sentence cannot point at the fifth.
  it("names the cards it shows, so the model knows which made it", async () => {
    const deps = turn();
    deps.placeCache.add([{ name: "Afuri Ebisu", lat: 35.64, lng: 139.71 }]);
    expect(await showOptionsTool.invoke({ prompt: "Two to try", places: [1, 2] }, deps)).toEqual({
      shown: true,
      note: expect.stringContaining("Shown: Ichiran Shibuya, Afuri Ebisu."),
    });
  });

  // Mitchell, 2026-10-30: five Choose rows looked bad. A call over four keeps
  // the model's first four, its best, since it orders them as it suggests.
  it("keeps a call naming five places to the model's first four", () => {
    expect(repairToolInput("show_options", { prompt: "Five to try", places: [1, 2, 3, 4, 5] })).toEqual({ prompt: "Five to try", places: [1, 2, 3, 4] });
  });
});

// M56 part 15: Mitchell, 2026-10-30, "same cap everywhere, keep behaviour
// consistent": a question over four options is cut as show_options' cards are.
describe("ask_user", () => {
  it("keeps a question naming five options to the model's first four", () => {
    const options = ["food", "art", "bars", "parks", "shops"].map((id) => ({ id, label: id }));
    expect(repairToolInput("ask_user", { question: "What is it about?", options })).toEqual({ question: "What is it about?", options: options.slice(0, 4) });
  });

  // A fifth option is cut before `run` sees it, so the note names what is on
  // screen, as show_options' does: the lead-in cannot point at the fifth.
  it("names the options it shows, so the model knows which made it", async () => {
    const options = [{ id: "food", label: "Food" }, { id: "art", label: "Art" }];
    expect(await askUserTool.invoke({ question: "What is it about?", options }, turn())).toEqual({ shown: true, note: expect.stringContaining("Shown: Food, Art.") });
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

// M56 part 6: what the person already said rides the hand-off to New trip, the
// fields the picker takes and the asks only the new trip can do.
describe("hand_off to New trip", () => {
  it("carries the prefill and asks into the outcome, and only to new_trip", async () => {
    const prefill = { days: 14, tags: ["meal" as const] };
    const asks = [{ said: "add a mezcal tasting", kind: "itinerary" as const }];
    const deps = turn();
    expect(await handOffTool.invoke({ task: "plan a food trip", to: "new_trip", prefill, asks }, deps)).toMatchObject({ shown: true });
    expect(deps.uiOutcome.outcome()).toEqual({ handOff: { task: "plan a food trip", to: "new_trip", prefill, asks } });

    const elsewhere = turn();
    await handOffTool.invoke({ task: "book a flight", to: "nowhere", prefill, asks }, elsewhere);
    expect(elsewhere.uiOutcome.outcome()).toEqual({ handOff: { task: "book a flight", to: "nowhere" } });
  });
});
