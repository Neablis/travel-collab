import { z } from "zod";
import { ActivityKind, ActivityTag, Location } from "./activity.ts";

// Nearby stops (M34): stops from other people's published days, offered in
// the add-stop sheet under "What or where". A pick fills the form; nothing here
// is planning state, and nothing is written.
//
// **Named "nearby stops", never "suggestions"** (M34 D14). A suggestion is
// already a suggester's pending change (ADR-064, `suggestion.ts`), and two
// meanings of one word in one codebase is how a grep finds the wrong half.

/** The most a response carries (M34 D5): enough for typing to narrow, small enough to fetch once per sheet. */
export const NEARBY_STOPS_MAX = 40;

/**
 * One stop from the public library, ranked for the day it would be added to.
 *
 * What a pick copies (D2) is `title`, `location`, `kind`, `tags` and the
 * length. The start time and cost are deliberately absent: the day decides the
 * one, and the other can be stale or in another currency.
 */
export const NearbyStop = z.object({
  title: z.string(),
  // A candidate always has a place (D1): a stop with none cannot be "nearby".
  location: Location,
  // The CURRENT kind enum, not `StoredActivityKind`: the server read the row
  // through `SavedStop`, which has already mapped retired kinds (ADR-054). In
  // practice `planned` or `pending` — transit is never offered (D7) — but the
  // schema does not narrow it, so a transit row is the ranking's bug to catch
  // in its tests rather than a parse failure on a reader's sheet.
  kind: ActivityKind,
  tags: z.array(ActivityTag),
  // End minus start of the stored window, with 23:59 read as midnight; null
  // when the stop had no time window. A pick keeps a length outside the five
  // "How long" options as it is (D11).
  lengthMinutes: z.number().int().positive().nullable(),
  // The published day it was taken from, and its name (D10). Where duplicates
  // collapsed (D9), the first day's copy.
  savedDayId: z.string().uuid(),
  savedDayName: z.string(),
  // How many published days carry the same stop — same title and place name,
  // compared case-insensitively (D9).
  playbookCount: z.number().int().positive(),
  // Null when the stop was not ranked by distance: no anchor, no coordinates,
  // or coordinates that are only a city centre (D1).
  distanceKm: z.number().nonnegative().nullable(),
});
export type NearbyStop = z.infer<typeof NearbyStop>;

/** `GET /api/trips/:tripId/nearby-stops`, ranked closest first. */
export const NearbyStopsResponse = z.object({ stops: z.array(NearbyStop).max(NEARBY_STOPS_MAX) });
export type NearbyStopsResponse = z.infer<typeof NearbyStopsResponse>;
