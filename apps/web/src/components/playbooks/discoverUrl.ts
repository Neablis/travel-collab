import type { z } from "zod";
import { DiscoverScope, DiscoverSort, LengthBand, RatingFloor } from "@/lib/playbooks";

// Discover's state as a URL, both directions, in one place — so the page that
// READS `?rating=4` and the screen that WRITES it cannot spell it two ways.
//
// **Budget is deliberately not in here.** Its bands are only offerable once the
// feed has answered with a shared currency, and `DiscoverScreen` clears an
// unofferable filter from state; a `?budget=` seeded before that first answer
// would be wiped by the first render, so persisting it would be a URL that
// silently does nothing. Everything else here is offerable from the start.
//
// Every value is parsed against its own enum and a bad one falls back to the
// default rather than failing the page: a hand-edited `?sort=best` is a typo,
// not an error the reader should see.

/** The part of Discover's state a URL carries. Defaults are omitted on write. */
export type DiscoverUrlState = {
  cities: string[];
  /** Uppercase ISO alpha-2 codes, the same form `?country=` sends to the server. */
  countries: string[];
  scope: DiscoverScope;
  sort: DiscoverSort;
  length: LengthBand;
  rating: RatingFloor;
};

export const DISCOVER_URL_DEFAULTS: DiscoverUrlState = {
  cities: [],
  countries: [],
  scope: "everyone",
  sort: "most-added",
  length: "any",
  rating: "any",
};

type RawParams = Record<string, string | string[] | undefined>;

const all = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const first = (value: string | string[] | undefined): string | undefined => all(value)[0];

function pick<T>(schema: z.ZodType<T>, raw: string | undefined, fallback: T): T {
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : fallback;
}

/** Discover's state from a page's `searchParams`; anything absent or unreadable is its default. */
export function parseDiscoverUrl(params: RawParams): DiscoverUrlState {
  return {
    cities: all(params.city).filter((c) => c !== ""),
    // Upper-cased because the stored codes are (`countriesOfStops`), and a
    // lower-case `?country=jp` typed by hand should mean Japan, not nothing.
    countries: all(params.country)
      .map((c) => c.toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c)),
    scope: pick(DiscoverScope, first(params.scope), DISCOVER_URL_DEFAULTS.scope),
    sort: pick(DiscoverSort, first(params.sort), DISCOVER_URL_DEFAULTS.sort),
    length: pick(LengthBand, first(params.length), DISCOVER_URL_DEFAULTS.length),
    rating: pick(RatingFloor, first(params.rating), DISCOVER_URL_DEFAULTS.rating),
  };
}

/**
 * The query string for `state`, without the leading `?` and with every default
 * left out — so an untouched Discover is `/playbooks`, not a URL full of `any`.
 */
export function discoverQueryString(state: DiscoverUrlState): string {
  const params = new URLSearchParams();
  // Repeated rather than comma-joined, as `searchPlaybooks` sends them: a city
  // name may contain a comma.
  for (const city of state.cities) params.append("city", city);
  for (const country of state.countries) params.append("country", country);
  if (state.scope !== DISCOVER_URL_DEFAULTS.scope) params.set("scope", state.scope);
  if (state.sort !== DISCOVER_URL_DEFAULTS.sort) params.set("sort", state.sort);
  if (state.length !== DISCOVER_URL_DEFAULTS.length) params.set("length", state.length);
  if (state.rating !== DISCOVER_URL_DEFAULTS.rating) params.set("rating", state.rating);
  return params.toString();
}
