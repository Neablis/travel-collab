import { z } from "zod";
import { DiscoverScope, DiscoverSort, LengthBand, normalizeCities, RatingFloor, TagFilter } from "@/lib/playbooks";

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
  tag: TagFilter;
  /**
   * Where this page starts: the last card id of the page before, or null for
   * page one. A link carries it, so a crawler reaches page two (M42 part 5).
   */
  after: string | null;
};

type RawParams = Record<string, string | string[] | undefined>;

/**
 * **Every field of Discover's URL, with its query name and both directions**
 * (Mitchell, 2026-10-28: one table carrying the names, so a new filter works
 * everywhere or fails to compile). Keyed by the state's own fields: a field
 * added to `DiscoverUrlState` and missing here is a type error, and the
 * parse, the query string and the back link's `?discover=` all walk this
 * table, so none of them can know a name the others do not.
 *
 * A const object, not a TypeScript `enum`: `erasableSyntaxOnly`
 * (`tsconfig.base.json`) rejects an `enum`, and this checks the same thing.
 *
 * `read` takes every value the name carries, none if it is absent; `write`
 * gives the values to put back, none for the default, so an untouched
 * Discover is `/playbooks`. The table's order is the query string's.
 */
const FIELDS: { [K in keyof DiscoverUrlState]: Field<DiscoverUrlState[K]> } = {
  // Repeated rather than comma-joined, as `searchPlaybooks` sends them: a city
  // name may contain a comma.
  cities: { param: "city", read: (values) => normalizeCities(values), write: (cities) => cities },
  // Upper-cased because the stored codes are (`countriesOfStops`), and a
  // lower-case `?country=jp` typed by hand should mean Japan, not nothing.
  // Trimmed and deduped as `GET /api/playbooks` does, so the page's first
  // paint is the list the API would give.
  countries: {
    param: "country",
    read: (values) => [
      ...new Set(values.map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c))),
    ],
    write: (countries) => countries,
  },
  scope: one("scope", DiscoverScope, "everyone"),
  sort: one("sort", DiscoverSort, "most-added"),
  length: one("length", LengthBand, "any"),
  rating: one("rating", RatingFloor, "any"),
  // Ticketed and Lodging are no value of it (ADR-070 §2, §4), so they read as no filter.
  tag: one("tag", TagFilter, "any"),
  // Last, so a page link reads as the search and then where in it.
  after: {
    param: "after",
    read: (values) => z.string().guid().safeParse(values[0]).data ?? null,
    write: (after) => (after === null ? [] : [after]),
  },
};

type Field<T> = { param: string; read: (values: string[]) => T; write: (value: T) => string[] };

/** A one-valued field read against its own enum: a bad value is the default, and the default is not written. */
function one<T extends string>(param: string, schema: z.ZodType<T>, fallback: T): Field<T> {
  return {
    param,
    read: (values) => {
      const parsed = schema.safeParse(values[0]);
      return parsed.success ? parsed.data : fallback;
    },
    write: (value) => (value === fallback ? [] : [value]),
  };
}

const KEYS = Object.keys(FIELDS) as (keyof DiscoverUrlState)[];

/** What each field reads as when the URL does not name it: the table's own defaults, so they are spelled once. */
export const DISCOVER_URL_DEFAULTS: DiscoverUrlState = readFields(() => []);

/** Discover's state from its query values by name; anything absent or unreadable is its default. */
function readFields(valuesOf: (param: string) => string[]): DiscoverUrlState {
  // A field at a time through a generic, so each `read` answers for its own key.
  const read = <K extends keyof DiscoverUrlState>(key: K) => FIELDS[key].read(valuesOf(FIELDS[key].param));
  return Object.fromEntries(KEYS.map((key) => [key, read(key)])) as DiscoverUrlState;
}

/** Discover's state from a page's `searchParams`; anything absent or unreadable is its default. */
export function parseDiscoverUrl(params: RawParams): DiscoverUrlState {
  return readFields((param) => {
    const value = params[param];
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
  });
}

/**
 * `parseDiscoverUrl` for a raw query string, `?` or not, every repeated value
 * kept. Only the table's names are read, never a key the query chose, so a
 * `__proto__` in a pasted `?discover=` reaches no object (CodeQL, PR 628).
 */
export function parseDiscoverQuery(query: string): DiscoverUrlState {
  const params = new URLSearchParams(query);
  return readFields((param) => params.getAll(param));
}

/**
 * The query string for `state`, without the leading `?` and with every default
 * left out — so an untouched Discover is `/playbooks`, not a URL full of `any`.
 */
export function discoverQueryString(state: DiscoverUrlState): string {
  const params = new URLSearchParams();
  const write = <K extends keyof DiscoverUrlState>(key: K) => {
    for (const value of FIELDS[key].write(state[key])) params.append(FIELDS[key].param, value);
  };
  for (const key of KEYS) write(key);
  return params.toString();
}
