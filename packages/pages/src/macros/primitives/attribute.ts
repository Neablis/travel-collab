import { z } from "zod";
import { AttributeFieldRef, type TripDetail, type UserPreferences } from "@tc/contracts";
import type { FilterDimension } from "@tc/contracts";
import type { MacroDef, WidgetContext } from "../../registry-types";
import { chip, inlineOf } from "../../registry-types";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { filterInputs, filterParams } from "../../filters";
import { formatCountdown, formatMoney } from "../../format";

// `attribute` — one primitive over an allow-listed field (ADR-039 decision 6).
//
// Mitchell, 2026-09-04:
//
// > more attribute as a generic in the ast, but defined / allow listed / hard
// > coded to common sense values for usability today in the ui
//
// So four widgets that each read one field become one primitive told which
// field to read. **The generic form is what the document stores; the allow-list
// is what stops it becoming a field browser over internal state**, and what
// makes a renamed contract field a failing test here rather than a broken
// widget in somebody's saved page.
//
// It declares NO filter dimensions, and that is the legality matrix speaking
// rather than an omission: `LEGAL_FILTERS.trip` and `LEGAL_FILTERS.account` are
// both empty, because a trip is one trip and an account is one account. There
// is no set, so there is nothing to narrow.
//
// Its entity is `trip`. Two of the four fields read the ACCOUNT, and the
// declaration has to pick one — `WidgetSelection.entity` is singular by ADR-039
// decision 1. Both rows of the matrix are empty, so the choice constrains
// nothing and the two are interchangeable here; `trip` is the one a reader
// expects to see on a widget whose commonest use is the trip's own name.

const ATTRIBUTE_FILTERS = [] as const satisfies readonly FilterDimension[];

// `field` is a param, not a dimension — the same treatment `count`'s `of` gets.
// It chooses WHAT is read rather than narrowing a set, so it earns no row in
// the matrix and no control from `filterInputs`; the picker offers it as four
// presets, which is decision 4's *"a named widget is a preset — data, not
// inheritance"*.
//
// Optional rather than required, because `insertWidget(name, {})` has to parse
// for every registered widget — that is what makes "insert then point it" and
// "insert immediately" one code path. An `attribute` with no field chosen has
// nothing to read and says so.
const AttributeParams = filterParams(ATTRIBUTE_FILTERS, { field: AttributeFieldRef.optional() });
type AttributeParams = z.infer<typeof AttributeParams>;

/**
 * What each field says when it has nothing — one line per field, because they
 * do not mean the same thing.
 *
 * They all read "nothing to show" before this, which is the widget's own
 * `emptyText` and the right answer for a widget with one empty state.
 * `attribute` has five, and on a brand-new trip's Overview several of them are
 * true at once: the shrug was the whole page. Each of these names the absence
 * and, where there is one, the thing to do about it.
 */
const NOTHING_TO_SHOW: Record<AttributeFieldRef, string> = {
  "trip.name": "this trip has no name",
  "trip.budgetRemaining": "no budget set",
  // The one a NEW trip most often hits, and the reason `because` exists: the
  // countdown is the first line of the Overview, and "nothing to show" there
  // says nothing about what to do. "yet" is doing real work — an undated trip
  // is not a trip without dates, it is one whose dates have not been picked.
  "trip.countdown": "no dates set yet",
  "account.name": "your name is not set",
  "account.homeAirport": "no home airport set",
};

// What each allow-listed field reads, in one place.
//
// `null` means "nothing to show", and every branch below reaches it honestly
// rather than by a fallback: a trip with no name, a trip with no budget set, an
// account whose preferences did not load, a name never chosen.
function read(
  field: AttributeFieldRef,
  trip: TripDetail | undefined,
  user: UserPreferences | null,
  today: string | null,
): string | null | "needs-trip" {
  switch (field) {
    case "trip.name":
      if (!trip) return "needs-trip";
      return trip.name.trim() === "" ? null : trip.name;
    case "trip.budgetRemaining":
      if (!trip) return "needs-trip";
      // `budgetRemaining` is already computed on `TripDetail` (budget − total),
      // so this deliberately does no arithmetic: a second implementation of
      // "what is left" is a second answer that can differ from the board's.
      //
      // **It may be negative, and it renders that.** Over budget is the state a
      // person most wants a notebook to say out loud, so clamping at zero would
      // suppress the only reading that changes a decision. `null` means no
      // budget is set — a different fact from "nothing left".
      return trip.budgetRemaining === null ? null : formatMoney(trip.budgetRemaining, trip.currency);
    case "trip.countdown": {
      if (!trip) return "needs-trip";
      // **No `today`, no answer.** The reader's calendar date is only knowable
      // on the client (see `WidgetContext.today`), and a countdown computed
      // against a UTC server date is off by one for several hours every evening
      // west of Greenwich — which on a widget whose whole content is a number
      // of days is the difference between right and wrong, not a rounding.
      if (today === null) return null;
      // The extremes of the DATED days, not the ends of the list — the rule
      // `dates` states at length. A trip dated at the front and open-ended at
      // the back has a first day and no last one, and reading `days.at(-1)`
      // blindly would count down to `null`.
      const dated = trip.days.map((day) => day.date).filter((date): date is string => date !== null);
      if (dated.length === 0) return null;
      const first = dated.reduce((a, b) => (b < a ? b : a));
      const last = dated.reduce((a, b) => (b > a ? b : a));
      return formatCountdown(today, first, last);
    }
    case "account.name": {
      // **The chosen name and nothing else — no fallback chain.** The app has
      // one (`apps/web/src/lib/displayName.ts`) which ends at the provider
      // name, then the email, then a derived handle. This does not want it, and
      // the reason is stronger than package boundaries: a notebook page is a
      // SHARED document, and a fallback that reaches an email address would
      // print one into a page a collaborator can read.
      const name = user?.displayName;
      return name == null || name.trim() === "" ? null : name;
    }
    case "account.homeAirport": {
      const code = user?.homeAirport;
      return code == null || code === "" ? null : code;
    }
  }
}

export const attribute: MacroDef<AttributeParams, string> = {
  name: "attribute", title: "One fact", shape: "single",
  params: AttributeParams, inputs: filterInputs(ATTRIBUTE_FILTERS),
  selection: { entity: "trip", filters: ATTRIBUTE_FILTERS },
  description:
    "One named fact about the trip or your account: its name, how long until it starts, what's left of the budget, your name, your home airport.",
  emptyText: "nothing to show",
  preview: "a single fact, spelled out",
  resolve: ({ trip, user, today }: WidgetContext, params): MacroResult<string> => {
    // No field chosen. Not `unbound("field")`: that answers a `field` INPUT,
    // which has a picker to fill it in. This `field` is not declared as one —
    // it is chosen once, by the preset, and no control could fill it in
    // afterwards. `empty()` is the state ADR-037 decision 6 calls "not set
    // up", which is what this is.
    if (!params.field) return empty();
    const value = read(params.field, trip, user, today);
    if (value === "needs-trip") return needsTrip();
    return value === null ? empty(NOTHING_TO_SHOW[params.field]) : ok(value);
  },
  render: (value) => inlineOf(chip("value", value)),
};
