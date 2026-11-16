import { describe, expect, it } from "vitest";
import {
  FILTER_DEFS,
  activeFilterCount,
  chipLabel,
  clearedFilters,
  isFilterSet,
  filtersLabel,
  rowFilters,
  type FilterState,
} from "./discoverFilters";

const NONE: FilterState = { visibility: "all", rating: "any", budget: "any", length: "any", tag: "any" };
// On *Yours*, the one tab where every filter is offered.
const USD = { budgetCurrency: "USD", scope: "yours" } as const;

const def = (id: string) => FILTER_DEFS.find((d) => d.id === id)!;

describe("SPEC §33.2's rule, as a data structure", () => {
  // The rule the whole link implements: a place is a tab, a question is a chip,
  // a property of the list rides the sentence about the list. Only the middle
  // one belongs here.
  it("holds the questions, and neither the place nor the ordering", () => {
    const ids = FILTER_DEFS.map((d) => d.id);
    // *Yours*' public / private first, then §35.5's three in its order:
    // Rating, Budget, Length; then M42's tag.
    expect(ids).toEqual(["visibility", "rating", "budget", "length", "tag"]);
    expect(ids).not.toContain("scope");
    expect(ids).not.toContain("sort");
  });

  it("counts only what is being asked", () => {
    expect(activeFilterCount(NONE)).toBe(0);
    expect(activeFilterCount({ ...NONE, budget: "under200" })).toBe(1);
    expect(activeFilterCount({ ...NONE, budget: "under200", length: "one" })).toBe(2);
    expect(
      activeFilterCount({ visibility: "private", rating: "4", budget: "under200", length: "one", tag: "beach" }),
    ).toBe(5);
  });

  it("clears every question and invents none", () => {
    expect(
      clearedFilters({ visibility: "public", rating: "4.5", budget: "over1000", length: "seven-plus", tag: "beach" }),
    ).toEqual(NONE);
    expect(
      activeFilterCount(clearedFilters({ visibility: "all", rating: "3", budget: "over1000", length: "one", tag: "any" })),
    ).toBe(0);
  });
});

describe("what appears in the row", () => {
  // §35.5: no face chips. Every filter lives in the one menu, and a chip
  // appears only for a filter that is asking something, so it can be cleared
  // in place.
  it("shows a chip only for a filter that is set", () => {
    expect(rowFilters(NONE).map((d) => d.id)).toEqual([]);
    expect(rowFilters({ ...NONE, length: "four-six" }).map((d) => d.id)).toEqual(["length"]);
    expect(rowFilters({ ...NONE, budget: "under200", length: "four-six" }).map((d) => d.id)).toEqual([
      "budget",
      "length",
    ]);
    expect(rowFilters({ ...NONE, rating: "4" }).map((d) => d.id)).toEqual(["rating"]);
  });

  // §35.5: the trigger says how many questions are asked, and nothing when none.
  it("labels the menu Filters, with the count once anything is asked", () => {
    expect(filtersLabel(NONE)).toBe("Filters");
    expect(filtersLabel({ ...NONE, length: "one" })).toBe("Filters · 1");
    expect(filtersLabel({ ...NONE, budget: "under200", length: "one" })).toBe("Filters · 2");
  });

  // §33.2: a set chip shows its VALUE. A chip still reading "Budget" once a
  // budget is chosen makes the reader open it to find out what they asked for.
  it("labels a chip with its value when set and its name when not", () => {
    const budget = def("budget");
    const options = budget.options(USD)!;
    expect(chipLabel(budget, NONE, options)).toBe("Budget");
    expect(chipLabel(budget, { ...NONE, budget: "under200" }, options)).toBe("Under $200.00 each");
  });

  // A value with no matching option — a band renamed under a stored filter —
  // falls back to the group's name rather than rendering an empty chip.
  it("falls back to the filter's name when the value has no option", () => {
    const budget = def("budget");
    expect(chipLabel(budget, { ...NONE, budget: "under200" }, [])).toBe("Budget");
  });
});

describe("what a filter can honestly offer", () => {
  // The bands compare minor units, so they only mean something inside one
  // currency. A mixed result set offers nothing rather than comparing JPY to
  // USD — and `null` means the filter appears nowhere at all, not that it
  // appears empty.
  it("offers no budget bands when the results share no currency", () => {
    expect(def("budget").options({ ...USD, budgetCurrency: null })).toBeNull();
    expect(def("budget").options(USD)).not.toBeNull();
  });

  // Four bands over three edges, mutually exclusive so a Playbook cannot match
  // two at once (Mitchell, 2026-09-01). Each band is a price per person, as
  // SPEC §15's "budget per person" filter is (ADR-060 decision 7).
  it("offers four per-person budget bands over $200/$500/$1,000, plus Any", () => {
    expect(def("budget").options(USD)!.map((o) => o.label)).toEqual([
      "Any budget",
      "Under $200.00 each",
      "$200.00 – $500.00 each",
      "$500.00 – $1,000.00 each",
      "Over $1,000.00 each",
    ]);
  });

  // `RATING_FLOOR_LABELS`, so the chip and the menu read what the server's
  // floor admits. Offered with or without a shared currency — nothing about a
  // rating depends on money, and Budget's `null` must not leak onto it.
  it("offers the rating floors, whatever the currency", () => {
    const labels = (budgetCurrency: string | null) =>
      def("rating").options({ ...USD, budgetCurrency })?.map((o) => o.label);
    expect(labels("USD")).toEqual(["Any rating", "3+ stars", "4+ stars", "4.5+ stars"]);
    expect(labels(null)).toEqual(labels("USD"));
    expect(chipLabel(def("rating"), { ...NONE, rating: "4" }, def("rating").options(USD)!)).toBe("4+ stars");
  });

  it("offers the four length bands the design names", () => {
    expect(def("length").options(USD)!.map((o) => o.value)).toEqual([
      "any",
      "one",
      "two-three",
      "four-six",
      "seven-plus",
    ]);
  });

  // ADR-070 §2 and §4: a tag filters by what a day's description names, which
  // is never Ticketed (a modifier) or Lodging (every trip sleeps), so neither
  // is a value. The rest in the picker's order, Food first.
  it("offers every category a description can name, and not Ticketed or Lodging", () => {
    const tags = def("tag").options(USD)!;
    expect(tags.map((o) => o.value)).toEqual([
      "any", "meal", "drinks", "nightlife", "museum", "sight", "outdoors",
      "beach", "shopping", "show", "tour", "wellness", "sports",
    ]);
    expect(chipLabel(def("tag"), { ...NONE, tag: "meal" }, tags)).toBe("Food");
  });

  it("treats `any` as not asking", () => {
    for (const d of FILTER_DEFS) {
      expect(isFilterSet(d, NONE)).toBe(false);
      expect(isFilterSet(d, d.apply(NONE, d.options(USD)![1]!.value))).toBe(true);
    }
  });
});

// Mitchell, 2026-11-16: "There should be a filter when on yours tab to filter
// on public/private/all". A question about *Yours*, so it is offered there and
// nowhere else, and it counts and clears like any other question.
describe("Yours' public / private question", () => {
  it("is offered on Yours, as All, Public and Private", () => {
    const options = def("visibility").options(USD)!;
    expect(options.map((o) => o.value)).toEqual(["all", "public", "private"]);
    expect(options.map((o) => o.label)).toEqual(["All", "Public", "Private"]);
    expect(chipLabel(def("visibility"), { ...NONE, visibility: "private" }, options)).toBe("Private");
  });

  // Under Everyone every day but yours is public, and under Saved every day is
  // someone's you took: the question has no honest answer there, so `null`
  // keeps it off every control and the screen clears it from state.
  it.each(["everyone", "saved"] as const)("is not offered on %s", (scope) => {
    expect(def("visibility").options({ ...USD, scope })).toBeNull();
  });

  it("asks nothing at All, and something at Public or Private", () => {
    expect(rowFilters(NONE).map((d) => d.id)).toEqual([]);
    expect(rowFilters({ ...NONE, visibility: "public" }).map((d) => d.id)).toEqual(["visibility"]);
    expect(filtersLabel({ ...NONE, visibility: "private" })).toBe("Filters · 1");
  });
});
