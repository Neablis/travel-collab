import { z } from "zod";
import type { TripDetail } from "@tc/contracts";
import type { CountryFactsCard, CountryFactsPayload, MacroDef, WidgetContext } from "../../registry-types";
import { blockOf } from "../../registry-types";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { CURRENCY_NAMES, countryFacts, type CountryFacts } from "../../data/countries";

// `country.facts` — "Know before you go" (M14 link 11; widget brainstorm tier
// B). Plugs, power, driving side, emergency numbers, currency, calling code and
// tipping, one card per country the trip stops in.
//
// **A registered widget, not a primitive**, for `open`'s reason: a primitive is
// `entity + filters + shape` (ADR-039 decision 1), and "the countries" is not an
// entity the matrix has or a set anybody asked to narrow. A "know before you go,
// Japan only" is a question nobody has put; if it is, `city`'s dimension is the
// one to reach for, and this gains a `selection` then.
//
// **No inputs, so it inserts immediately** (ADR-035 decision 2). Everything it
// needs is already on the trip: every stop has carried `location.countryCode`
// since M12.

const CountryFactsParams = z.object({});
type CountryFactsParams = z.infer<typeof CountryFactsParams>;

/**
 * The countries the trip stops in, in the order it reaches them, each once.
 *
 * **Scheduled stops only.** The backlog is parked ideas — somewhere the trip
 * might go — and a card telling someone which plug to pack for a country they
 * are not visiting is noise on the one page they print. Stops in day order and
 * then in each day's stored order, which is the board's order.
 *
 * `address.countryCode` is the fallback because the contract holds the two
 * equal when both are present (`Location`'s refine), so a stop typed with an
 * address and not yet geocoded still names its country.
 */
function countriesInTripOrder(trip: TripDetail): string[] {
  const seen = new Set<string>();
  for (const day of trip.days) {
    for (const id of day.activityIds) {
      const location = trip.activities[id]?.location;
      const code = location?.countryCode ?? location?.address?.countryCode;
      if (code) seen.add(code);
    }
  }
  return [...seen];
}

const volts = (facts: CountryFacts) => `${facts.volts.join("/")} V · ${facts.hertz.join("/")} Hz`;

function cardOf(code: string, facts: CountryFacts): CountryFactsCard {
  return {
    code,
    name: facts.name,
    plugs: facts.plugs.join(", "),
    power: volts(facts),
    drives: facts.drives === "left" ? "Left" : "Right",
    emergency: facts.emergency === null ? null : facts.emergency.join(" · "),
    currency: facts.currencies.map((c) => `${c} · ${CURRENCY_NAMES[c] ?? c}`).join(", "),
    callingCode: facts.callingCode,
    tipping: facts.tipping,
  };
}

export const countryFactsWidget: MacroDef<CountryFactsParams, CountryFactsPayload> = {
  name: "country.facts",
  title: "Know before you go",
  shape: "block",
  params: CountryFactsParams,
  inputs: [],
  selection: undefined,
  description:
    "A card per country the trip stops in: plug type, voltage, which side of the road, emergency numbers, currency, calling code and tipping.",
  emptyText: "add a stop with a place to see this",
  // Fixed, never computed (ADR-037 decision 5): no country named.
  preview: "plugs, emergency numbers and currency for each country you visit",
  resolve: ({ trip }: WidgetContext, _params): MacroResult<CountryFactsPayload> => {
    if (!trip) return needsTrip();
    // A code outside the table (Antarctica, or a geocoder's private-use code)
    // gets no card rather than a card of dashes: a card that names a country
    // and then knows nothing about it reads as a rendering fault.
    const countries = countriesInTripOrder(trip).flatMap((code) => {
      const facts = countryFacts(code);
      return facts ? [cardOf(code, facts)] : [];
    });
    if (countries.length === 0) return empty();
    return ok({ kind: "country-facts", countries });
  },
  render: blockOf,
};
