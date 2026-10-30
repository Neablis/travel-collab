import { z } from "zod";

// The wire shape of `GET /api/cities?q=` (M11b link 2), defined ONCE and read
// from both sides: the route validates what it is about to send, `apiClient`
// parses what it received.
//
// It lives in `src/lib` for `savedStops.ts`'s reason — the lint wall forbids UI
// importing `@/server/*`, and `src/server` may import `@/lib` — so one
// definition can serve both without either side hand-writing the other's type.
//
// **Where this really belongs is `packages/contracts`** (AGENTS.md invariant 5:
// cross-boundary types are Zod schemas there, with a changelog entry). It is
// here rather than there because M11b's contracts step was its own reviewed PR
// and had already landed; adding a schema to it from the server PR is exactly
// the drift that rule exists to stop. Flagged for the follow-up rather than
// done quietly — the shape below is deliberately trivial so that moving it is a
// cut and paste.

export const CityMatch = z.object({
  city: z.string().min(1),
  /**
   * How many **published** saved days touch this city. Private days are not
   * counted — a public index must not report a number only its author's data
   * explains (see `server/cities.ts`).
   */
  days: z.number().int().nonnegative(),
});
export type CityMatch = z.infer<typeof CityMatch>;

export const CitySearchResponse = z.object({ cities: z.array(CityMatch) });
export type CitySearchResponse = z.infer<typeof CitySearchResponse>;

/**
 * A place from outside the library (M56 D3): a vendor's autocomplete result,
 * offered to a signed-in searcher after the library's places. `id` is the
 * vendor's stable id, what a client commits; a typed string never becomes a
 * place (ADR-084 §7). Also the shape the server caches it in.
 */
export const WorldPlaceMatch = z.object({
  kind: z.literal("world"),
  id: z.string().min(1),
  name: z.string().min(1),
  detail: z.string(),
  countryCode: z.string().length(2).optional(),
  lat: z.number(),
  lng: z.number(),
  // A world place the library holds is offered as the library's instead
  // (`server/places.ts`), so this arm never has playbooks.
  hasPlaybooks: z.literal(false),
});
export type WorldPlaceMatch = z.infer<typeof WorldPlaceMatch>;

/**
 * One row of the place search (`GET /api/places?q=`, M12 link 7) — a city OR a
 * country, and the result says which.
 *
 * Discriminated rather than a flat list of names because the collision is real:
 * the library holds the city Mexico City and the country Mexico, and `Mexic`
 * must offer both as two things a click can tell apart. A country is its ISO
 * alpha-2 code, which is the stored truth; `name` is `Intl.DisplayNames` over
 * it, derived per request and never stored.
 *
 * `days` counts published days touching the place ONCE each, however many of
 * that country's cities a day visits — `CityMatch`'s "days, not city-hits".
 *
 * A signed-in searcher also gets `world` rows after the library's (M56 D3).
 */
export const PlaceMatch = z.discriminatedUnion("kind", [
  CityMatch.extend({ kind: z.literal("city"), hasPlaybooks: z.boolean() }),
  z.object({
    kind: z.literal("country"),
    countryCode: z.string().length(2),
    name: z.string().min(1),
    days: z.number().int().nonnegative(),
    /** Whether published days touch the place: the *has Playbooks* label (M56 D3). */
    hasPlaybooks: z.boolean(),
  }),
  WorldPlaceMatch,
]);
export type PlaceMatch = z.infer<typeof PlaceMatch>;

export const PlaceSearchResponse = z.object({ places: z.array(PlaceMatch) });
export type PlaceSearchResponse = z.infer<typeof PlaceSearchResponse>;
