// **The account assistant's four tools** (M45 D1): aggregates across every
// trip the asker travelled on, computed by `@tc/domain` and never by a model
// reading trip dumps. `find_free_time` is the precedent — arithmetic belongs
// in a function, and the model is handed the answer.
//
// They read one port, `trips` (deps.ts), and nothing else: no `trip`, because
// an account turn has none, and no `actor`, because whose trips they are rides
// on the port from the session. Which trips count is the domain's rule
// (`travelledTrips`): only those the asker is travelling on (D2).
//
// Trip names, stop titles and city names are typed by people, often not by
// the asker, so each is fenced on the way out (`taint`). Country names come
// from the static list and are not.
import { z } from "zod";
import { ActivityTagCategory } from "@tc/contracts";
import {
  COUNTRIES,
  placesVisited,
  spendByCategory,
  suggestNextCountry,
  visitCounts,
  type CountryRegion,
} from "@tc/domain";
import { defineTool } from "@/server/assistant/defineTool";
import { untrusted } from "@/server/assistant/prompt";

const SpendCategorySchema = z.enum([...ActivityTagCategory.options, "untagged"]);

const SpendByCategoryInputSchema = z.object({
  category: SpendCategorySchema.optional().describe(
    'One category to report, e.g. "meal" for food. Omit for every category.',
  ),
});

const SpendByCategoryReadoutSchema = z.object({
  tripsCounted: z.number().int(),
  categories: z.array(
    z.object({
      category: SpendCategorySchema,
      currency: z.string(),
      totalMinor: z.number().int(),
      stops: z.number().int(),
      mostExpensive: z.object({
        title: z.string(),
        tripName: z.string(),
        perPersonMinor: z.number().int(),
        totalMinor: z.number().int(),
      }),
    }),
  ),
});
export type SpendByCategoryReadout = z.infer<typeof SpendByCategoryReadoutSchema>;

export const spendByCategoryTool = defineTool({
  name: "spend_by_category",
  description:
    "What the user has spent across every trip they travelled on, by category (a stop's first category tag; \"meal\" is food, \"untagged\" has none), per currency — never add different currencies together. Each row has its total for everyone travelling, its number of costed stops, and its most expensive stop by price for one person, which answers \"what was my most expensive meal?\". Amounts are integers in minor units (cents). Only stops on a day count; the ideas list does not.",
  domain: "account",
  effect: "read",
  spend: "none",
  input: SpendByCategoryInputSchema,
  output: SpendByCategoryReadoutSchema,
  taint: (readout: SpendByCategoryReadout) => ({
    ...readout,
    categories: readout.categories.map((row) => ({
      ...row,
      mostExpensive: {
        ...row.mostExpensive,
        title: untrusted(row.mostExpensive.title),
        tripName: untrusted(row.mostExpensive.tripName),
      },
    })),
  }),
  needs: ["trips"] as const,
  minimumRole: "viewer",
  run: async (input, deps) => spendByCategory(await deps.trips.load(), deps.trips.userId, input),
});

const PlacesVisitedReadoutSchema = z.object({
  tripsCounted: z.number().int(),
  countries: z.array(z.object({ code: z.string(), name: z.string().nullable() })),
  cities: z.array(z.object({ city: z.string(), countryCode: z.string().nullable() })),
  unknownStops: z.number().int(),
});
export type PlacesVisitedReadout = z.infer<typeof PlacesVisitedReadoutSchema>;

export const placesVisitedTool = defineTool({
  name: "places_visited",
  description:
    "Every country and city the user has been to, across every trip they travelled on — the answer to \"how many countries have I been to?\". `unknownStops` counts stops with no city or country recorded: say they were not counted rather than guessing where they were.",
  domain: "account",
  effect: "read",
  spend: "none",
  input: z.object({}),
  output: PlacesVisitedReadoutSchema,
  taint: (readout: PlacesVisitedReadout) => ({
    ...readout,
    cities: readout.cities.map((entry) => ({ ...entry, city: untrusted(entry.city) })),
  }),
  needs: ["trips"] as const,
  minimumRole: "viewer",
  run: async (_input, deps) => placesVisited(await deps.trips.load(), deps.trips.userId),
});

const VisitCountsInputSchema = z.object({
  by: z.enum(["city", "country"]).optional().describe('"city" (the default) or "country".'),
});

const VisitCountsReadoutSchema = z.object({
  tripsCounted: z.number().int(),
  by: z.enum(["city", "country"]),
  places: z.array(z.object({ place: z.string(), trips: z.number().int(), days: z.number().int(), stops: z.number().int() })),
  unknownStops: z.number().int(),
});
export type VisitCountsReadout = z.infer<typeof VisitCountsReadoutSchema>;

export const visitCountsTool = defineTool({
  name: "visit_counts",
  description:
    "How often the user has visited each city (or country), most first: ranked by trips, then days, then stops, across every trip they travelled on. `places[0]` answers \"which city have I been to most?\"; if the next one has the same trips, days and stops, it is a tie — say so.",
  domain: "account",
  effect: "read",
  spend: "none",
  input: VisitCountsInputSchema,
  output: VisitCountsReadoutSchema,
  // A city is a person's text; a country is the list's name for a code.
  taint: (readout: VisitCountsReadout) =>
    readout.by === "country"
      ? readout
      : { ...readout, places: readout.places.map((entry) => ({ ...entry, place: untrusted(entry.place) })) },
  needs: ["trips"] as const,
  minimumRole: "viewer",
  run: async (input, deps) => {
    const counted = visitCounts(await deps.trips.load(), deps.trips.userId, input.by ?? "city");
    if (counted.by === "city") return counted;
    return { ...counted, places: counted.places.map((entry) => ({ ...entry, place: countryName(entry.place) })) };
  },
});

const REGIONS = [...new Set(COUNTRIES.map((country) => country.region))] as [CountryRegion, ...CountryRegion[]];

const SuggestNextCountryReadoutSchema = z.object({
  tripsCounted: z.number().int(),
  visited: z.array(z.object({ code: z.string(), name: z.string(), region: z.enum(REGIONS) })),
  unvisited: z.array(z.object({ region: z.enum(REGIONS), countries: z.array(z.string()) })),
});

export type SuggestNextCountryReadout = z.infer<typeof SuggestNextCountryReadoutSchema>;

export const suggestNextCountryTool = defineTool({
  name: "suggest_next_country",
  description:
    "The countries the user has NOT been to yet, grouped by region, the regions they have already visited first — what to choose from when suggesting where to go next. Suggest only a country from `unvisited`. Pass `region` to see one region.",
  domain: "account",
  effect: "read",
  spend: "none",
  input: z.object({ region: z.enum(REGIONS).optional().describe("Only this region.") }),
  output: SuggestNextCountryReadoutSchema,
  needs: ["trips"] as const,
  minimumRole: "viewer",
  run: async (input, deps) => suggestNextCountry(await deps.trips.load(), deps.trips.userId, input),
});

const NAME_BY_CODE = new Map(COUNTRIES.map((country) => [country.code, country.name]));

/** A country's name, or its code when the list has no row for it. */
function countryName(code: string): string {
  return NAME_BY_CODE.get(code) ?? code;
}

export const ACROSS_TRIP_TOOLS = [spendByCategoryTool, placesVisitedTool, visitCountsTool, suggestNextCountryTool] as const;
