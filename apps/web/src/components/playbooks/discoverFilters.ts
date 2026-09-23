import { formatMoney } from "@/lib/formatMoney";
import {
  BUDGET_BAND_EDGES,
  LENGTH_BAND_LABELS,
  LengthBand,
  RATING_FLOOR_LABELS,
  RatingFloor,
  type BudgetBand,
} from "@/lib/playbooks";

// SPEC §33.2 — **a place is a tab, a question is a chip, a property of the list
// rides the sentence about the list.** This module holds the questions.
//
// One list, because four things have to agree about it and did not before: the
// set-filter chips, the *Filters* menu, the active-filter count, and what
// *Clear filters* resets. Keeping them as four hand-written places is how the phone
// badge came to count "sorted by newest" as a filter — sort is a property of
// the list, not a question, and it is deliberately NOT in here.
//
// **Scope is not in here either.** `Everyone / Yours / Saved` is a PLACE: it
// never counts toward the filter badge and *Clear filters* must not reset it
// (§33.2, and `DiscoverScreen`'s *Search everywhere* used to reset it).
//
// **These ids name what the group MEANS, not a domain enum member**
// (`docs/guidelines/building-from-the-design.md`). `budget` and `length` are
// filter groups; `BudgetBand` and `LengthBand` are the value types they carry.
// A filter id that spelled a plan id or an entitlement is the trap
// `planVersions.fourthPlan.test.ts` exists to catch.

export type DiscoverFilterId = "rating" | "budget" | "length";

export type FilterOption = { value: string; label: string };

/** Just the question half of Discover's state — no scope, no sort, no cities. */
export type FilterState = { rating: RatingFloor; budget: BudgetBand; length: LengthBand };

export type FilterContext = {
  /**
   * The currency every result shares, or null when the library holds nothing
   * priced. Budget cannot be offered at all in that case — see below.
   */
  budgetCurrency: string | null;
};

export type FilterDef = {
  id: DiscoverFilterId;
  /** The group heading in the *Filters* menu, and a chip's fallback label. */
  label: string;
  /** The value meaning "not asked" — a filter on this value is not active. */
  none: string;
  /** `null` when the filter cannot honestly be offered right now. */
  options: (ctx: FilterContext) => FilterOption[] | null;
  value: (state: FilterState) => string;
  apply: (state: FilterState, value: string) => FilterState;
};

export const FILTER_DEFS: readonly FilterDef[] = [
  {
    // §35.5's order — Rating, Budget, Length — and the design's `FILTER_DEFS`.
    // It waited for M12 (link 5) because until `saved_days.rating` existed it
    // would have been a control over data that did not (project rule 2).
    //
    // Always offerable, unlike Budget: a floor over a library with few ratings
    // is still an honest question, and the answer — fewer days, since any floor
    // excludes the unrated — is the true one.
    id: "rating",
    label: "Rating",
    none: "any",
    options: () => RatingFloor.options.map((value) => ({ value, label: RATING_FLOOR_LABELS[value] })),
    value: (state) => state.rating,
    apply: (state, value) => ({ ...state, rating: value as RatingFloor }),
  },
  {
    id: "budget",
    label: "Budget",
    none: "any",
    options: ({ budgetCurrency }) => {
      // The bands hide rather than compare numbers that are not comparable.
      // ADR-008 makes currency trip-level, so a mixed result set is not
      // reachable through the product's own write path, but a control that
      // silently compared JPY to USD would be worse than an absent one.
      if (budgetCurrency === null) return null;
      const twoHundred = formatMoney(BUDGET_BAND_EDGES.twoHundred, budgetCurrency);
      const fiveHundred = formatMoney(BUDGET_BAND_EDGES.fiveHundred, budgetCurrency);
      const oneThousand = formatMoney(BUDGET_BAND_EDGES.oneThousand, budgetCurrency);
      // "Budget", not "Budget each" — the trailing "each" was on the control's
      // label AND on every option, saying the same thing twice (Mitchell,
      // 2026-09-01). **The design still draws "$N each" and must not be
      // followed back**: the number these bands compare is a day's TOTAL
      // (`SavedDayFacts.totalCost`, a sum of priced stops with nothing to
      // divide by). Per-head maths is M19's.
      //
      // Four bands over three edges, and mutually exclusive so a Playbook
      // cannot match two at once (Mitchell, 2026-09-01: "sub 200, sub 500,
      // sub 1000 and above 1000").
      return [
        { value: "any", label: "Any budget" },
        { value: "under200", label: `Under ${twoHundred}` },
        { value: "200to500", label: `${twoHundred} – ${fiveHundred}` },
        { value: "500to1000", label: `${fiveHundred} – ${oneThousand}` },
        { value: "over1000", label: `Over ${oneThousand}` },
      ];
    },
    value: (state) => state.budget,
    apply: (state, value) => ({ ...state, budget: value as BudgetBand }),
  },
  {
    id: "length",
    label: "Length",
    none: "any",
    options: () =>
      LengthBand.options.map((value) => ({ value, label: LENGTH_BAND_LABELS[value] })),
    value: (state) => state.length,
    apply: (state, value) => ({ ...state, length: value as LengthBand }),
  },
];

/** Is this filter asking something? */
export function isFilterSet(def: FilterDef, state: FilterState): boolean {
  return def.value(state) !== def.none;
}

/**
 * How many questions are being asked.
 *
 * **Scope and sort are excluded**, which is the whole of §33.2's correction:
 * the phone badge used to count "sorted by newest" as a filter, and a place is
 * never a filter at all.
 */
export function activeFilterCount(state: FilterState): number {
  return FILTER_DEFS.filter((def) => isFilterSet(def, state)).length;
}

/** Every question dropped, and nothing else touched. */
export function clearedFilters(state: FilterState): FilterState {
  return FILTER_DEFS.reduce((acc, def) => def.apply(acc, def.none), state);
}

/**
 * What a set filter's chip reads: **its value** (§33.2), falling back to the
 * filter's name if the value has no option.
 *
 * A chip reading "Budget" when a budget is chosen makes the reader open it to
 * find out what they asked for, which is the thing the chip was supposed to
 * save them.
 */
export function chipLabel(def: FilterDef, state: FilterState, options: readonly FilterOption[]): string {
  if (!isFilterSet(def, state)) return def.label;
  const current = def.value(state);
  return options.find((o) => o.value === current)?.label ?? def.label;
}

/**
 * The chips in the row: only the filters that are asking something (§35.5).
 * Every filter is offered in the one *Filters* menu; a set one ALSO surfaces
 * as its own chip, so it can be read and cleared in place without opening it.
 */
export function rowFilters(state: FilterState): readonly FilterDef[] {
  return FILTER_DEFS.filter((def) => isFilterSet(def, state));
}

/** The *Filters* trigger: `Filters`, or `Filters · N` once N questions are asked (§35.5). */
export function filtersLabel(state: FilterState): string {
  const count = activeFilterCount(state);
  return count > 0 ? `Filters · ${count}` : "Filters";
}
