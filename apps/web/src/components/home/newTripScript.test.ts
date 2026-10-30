import { describe, expect, it } from "vitest";
import {
  LENGTH_DAYS,
  NEW_TRIP_START,
  REVIEW,
  answer,
  back,
  cassLine,
  changeTo,
  chipFor,
  daysFor,
  isAnswered,
  next,
  offerDays,
  pageOf,
  pickPopularDays,
  setupOf,
  stepLabel,
  toggleDay,
  type NewTripPlace,
  type NewTripState,
  type PopularDay,
} from "./newTripScript";

// Everything that decides what is asked, what counts as an answer and what
// reaches the trip lives here with no React in it (SPEC §30.2, ADR-084 §1).

const LISBON: NewTripPlace = { id: "city:Lisbon", label: "Lisbon", kind: "city", hasPlaybooks: true };
const PORTO: NewTripPlace = { id: "world:li-porto", label: "Porto", detail: "Portugal", kind: "world", hasPlaybooks: false };
const TRAM: PopularDay = { savedDayId: "tram", name: "Tram 28 morning", adds: 12, dayCount: 1, author: "Mei L." };
const ALFAMA: PopularDay = { savedDayId: "alfama", name: "Alfama at dusk", adds: 3, dayCount: 2, author: "Mei L." };

/** Answer every page and land on Review. */
function walked(): NewTripState {
  let state = next(answer(NEW_TRIP_START, { where: LISBON }));
  state = next(answer(state, { start: { iso: "2027-04-10" } }));
  state = next(answer(state, { length: { days: 7, other: false } }));
  state = next(answer(state, { pace: "slow" }));
  return next(answer(state, { about: ["meal", "museum"] }));
}

describe("the pages", () => {
  it("walks five pages, saying which step, and then Review", () => {
    const seen: (string | null)[] = [];
    let state = NEW_TRIP_START;
    const answers = [{ where: LISBON }, { start: "not-yet" as const }, { length: { days: 4, other: false } }, { pace: "packed" as const }, {}];
    for (const each of answers) {
      seen.push(`${pageOf(state)}: ${stepLabel(state)}`);
      state = next(answer(state, each));
    }
    expect(seen).toEqual(["where: Step 1 of 5", "start: Step 2 of 5", "length: Step 3 of 5", "pace: Step 4 of 5", "about: Step 5 of 5"]);
    expect(pageOf(state)).toBe("review");
    expect(stepLabel(state)).toBeNull();
  });

  // Where commits only a picked place, and every other page but About needs
  // its pick: Next on an unanswered page is the same page.
  it("refuses to move on from a page with no answer", () => {
    expect(next(NEW_TRIP_START)).toBe(NEW_TRIP_START);
    const onStart = next(answer(NEW_TRIP_START, { where: LISBON }));
    // *Yes, pick a day* with no day picked is not an answer yet.
    expect(next(answer(onStart, { start: { iso: null } }))).toEqual(answer(onStart, { start: { iso: null } }));
    expect(isAnswered({ about: [] }, "pace")).toBe(false);
    // About is any or none.
    expect(isAnswered({ about: [] }, "about")).toBe(true);
  });

  it("goes back a page, and not before Where", () => {
    const onStart = next(answer(NEW_TRIP_START, { where: LISBON }));
    expect(pageOf(back(onStart))).toBe("where");
    expect(back(NEW_TRIP_START)).toBe(NEW_TRIP_START);
  });
});

describe("Review's Change", () => {
  it("opens the page and comes straight back to Review", () => {
    const changed = next(answer(changeTo(walked(), "pace"), { pace: "balanced" }));
    expect(pageOf(changed)).toBe("review");
    expect(changed.answers.pace).toBe("balanced");
    expect(changed.destinationChanged).toBe(false);
  });

  // The gate's re-walk: a new place re-asks the later pages, every answer
  // still in place, under *Destination changed*.
  it("re-walks the later pages, prefilled, when Where changes", () => {
    const before = walked();
    let state = next(answer(changeTo(before, "where"), { where: PORTO }));
    expect(pageOf(state)).toBe("start");
    expect(state.destinationChanged).toBe(true);
    expect(cassLine(state, "")).toBe("Porto now. Your answers are kept — check they still fit.");
    const prefilled: string[] = [];
    while (pageOf(state) !== "review") {
      prefilled.push(`${pageOf(state)}=${isAnswered(state.answers, pageOf(state) as never)}`);
      state = next(state);
    }
    expect(prefilled).toEqual(["start=true", "length=true", "pace=true", "about=true"]);
    expect(state.answers).toEqual({ ...before.answers, where: PORTO });
    expect(state.destinationChanged).toBe(false);
  });

  it("comes straight back when Where is changed to the same place", () => {
    const state = next(answer(changeTo(walked(), "where"), { where: LISBON }));
    expect(state.page).toBe(REVIEW);
    expect(state.destinationChanged).toBe(false);
  });
});

describe("the published days on Review (D9)", () => {
  it("ranks by adds, at least one, never the reader's own, three at most", () => {
    const day = (savedDayId: string, adds: number, isMine = false) => ({
      savedDayId,
      name: savedDayId,
      adds,
      dayCount: 1,
      ownerDisplayName: "Mei L.",
      isMine,
    });
    const picked = pickPopularDays([day("a", 3), day("b", 0), day("c", 50, true), day("d", 12), day("e", 5), day("f", 4)]);
    expect(picked.map((d) => d.savedDayId)).toEqual(["d", "e", "f"]);
  });

  it("drops a read for a place the reader has moved off", () => {
    const onPorto = answer(NEW_TRIP_START, { where: PORTO });
    expect(offerDays(onPorto, LISBON.id, [TRAM])).toBe(onPorto);
  });

  it("takes the offer and the chosen days with it when the place changes", () => {
    let state = offerDays(answer(NEW_TRIP_START, { where: LISBON }), LISBON.id, [TRAM, ALFAMA]);
    state = toggleDay(state, "alfama");
    expect(setupOf(state).savedDays).toEqual([ALFAMA]);
    state = answer(state, { where: PORTO });
    expect(state.offer).toEqual([]);
    expect(setupOf(state).savedDays).toEqual([]);
  });

  it("chooses only offered days, in offer order, and unchooses on a second press", () => {
    let state = offerDays(answer(NEW_TRIP_START, { where: LISBON }), LISBON.id, [TRAM, ALFAMA]);
    state = toggleDay(toggleDay(toggleDay(state, "alfama"), "tram"), "nope");
    expect(state.chosen).toEqual(["tram", "alfama"]);
    expect(toggleDay(state, "tram").chosen).toEqual(["alfama"]);
  });
});

describe("what reaches the trip", () => {
  // The gate's "every answer reaches the trip", at the seam the component
  // hands `createTripWithSetup`.
  it("carries the day, the length, the pace and the tags", () => {
    expect(setupOf(walked())).toEqual({
      arrive: "2027-04-10",
      days: 7,
      pace: "slow",
      tags: ["meal", "museum"],
      savedDays: [],
    });
  });

  it("dates nothing for Not yet, or for Yes with no day picked", () => {
    expect(setupOf(answer(NEW_TRIP_START, { start: "not-yet" })).arrive).toBe("");
    expect(setupOf(answer(NEW_TRIP_START, { start: { iso: null } })).arrive).toBe("");
  });

  it("takes a counter's length as it is, and reopens it on the counter", () => {
    expect(setupOf(answer(NEW_TRIP_START, { length: { days: 9, other: true } })).days).toBe(9);
    expect(chipFor({ days: 7, other: true })).toBeNull();
    expect(chipFor({ days: 7, other: false })).toBe("A week");
  });

  it("keeps the five length chips and reads none off the prototype", () => {
    expect(Object.keys(LENGTH_DAYS)).toEqual(["Long weekend", "A week", "10 days", "2 weeks", "Longer"]);
    expect(daysFor("Longer")).toBe(21);
    expect(daysFor("constructor")).toBeNull();
  });
});
