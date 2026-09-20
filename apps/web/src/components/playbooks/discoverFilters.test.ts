import { describe, expect, it } from "vitest";
import {
  FILTER_DEFS,
  activeFilterCount,
  chipLabel,
  clearedFilters,
  isFilterSet,
  moreFilters,
  rowFilters,
  type FilterState,
} from "./discoverFilters";

const NONE: FilterState = { budget: "any", length: "any" };
const USD = { budgetCurrency: "USD" };

const def = (id: string) => FILTER_DEFS.find((d) => d.id === id)!;

describe("SPEC §33.2's rule, as a data structure", () => {
  // The rule the whole link implements: a place is a tab, a question is a chip,
  // a property of the list rides the sentence about the list. Only the middle
  // one belongs here.
  it("holds the questions, and neither the place nor the ordering", () => {
    const ids = FILTER_DEFS.map((d) => d.id);
    expect(ids).toEqual(["budget", "length"]);
    expect(ids).not.toContain("scope");
    expect(ids).not.toContain("sort");
  });

  // §33.2 names Rating as the second face chip. It is deliberately absent:
  // there is no reviews table (M12 owns it), so the chip would be a control
  // over data that does not exist — project rule 2. Asserted so its absence
  // reads as a decision rather than as an oversight, and so M12 finds this test
  // when it adds it.
  it("has exactly one face filter today, and it is Budget", () => {
    expect(FILTER_DEFS.filter((d) => d.face).map((d) => d.id)).toEqual(["budget"]);
  });

  it("counts only what is being asked", () => {
    expect(activeFilterCount(NONE)).toBe(0);
    expect(activeFilterCount({ ...NONE, budget: "under200" })).toBe(1);
    expect(activeFilterCount({ budget: "under200", length: "one" })).toBe(2);
  });

  it("clears every question and invents none", () => {
    expect(clearedFilters({ budget: "over1000", length: "seven-plus" })).toEqual(NONE);
    expect(activeFilterCount(clearedFilters({ budget: "over1000", length: "one" }))).toBe(0);
  });
});

describe("what appears in the row", () => {
  // A face filter is always there; everything else earns its place by carrying
  // a value.
  it("shows face filters always and the rest only once asked", () => {
    expect(rowFilters(NONE).map((d) => d.id)).toEqual(["budget"]);
    expect(rowFilters({ ...NONE, length: "four-six" }).map((d) => d.id)).toEqual(["budget", "length"]);
  });

  it("keeps the non-face set in More filters whether or not it is set", () => {
    expect(moreFilters().map((d) => d.id)).toEqual(["length"]);
  });

  // §33.2: a set chip shows its VALUE. A chip still reading "Budget" once a
  // budget is chosen makes the reader open it to find out what they asked for.
  it("labels a chip with its value when set and its name when not", () => {
    const budget = def("budget");
    const options = budget.options(USD)!;
    expect(chipLabel(budget, NONE, options)).toBe("Budget");
    expect(chipLabel(budget, { ...NONE, budget: "under200" }, options)).toBe("Under $200.00");
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
    expect(def("budget").options({ budgetCurrency: null })).toBeNull();
    expect(def("budget").options(USD)).not.toBeNull();
  });

  // Four bands over three edges, mutually exclusive so a Playbook cannot match
  // two at once (Mitchell, 2026-09-01).
  it("offers four budget bands over $200/$500/$1,000, plus Any", () => {
    expect(def("budget").options(USD)!.map((o) => o.label)).toEqual([
      "Any budget",
      "Under $200.00",
      "$200.00 – $500.00",
      "$500.00 – $1,000.00",
      "Over $1,000.00",
    ]);
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

  it("treats `any` as not asking", () => {
    for (const d of FILTER_DEFS) {
      expect(isFilterSet(d, NONE)).toBe(false);
      expect(isFilterSet(d, d.apply(NONE, d.options(USD)![1]!.value))).toBe(true);
    }
  });
});
