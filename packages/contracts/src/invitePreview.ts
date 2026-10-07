import { z } from "zod";
import { LocationPrecision } from "./activity.ts";
import { AvatarKey, PersonColor } from "./identity.ts";
import { Money } from "./money.ts";
import type { SavedStop } from "./saved.ts";

// ── The invite preview (M38 part 4, decisions D4 and D6) ────────────────────
//
// What `GET /api/invites/:token/preview` answers to whoever holds a PENDING
// invite's link: enough of the trip to decide whether to join it, built as the
// inputs the shared widgets and the read-only map take (D6), and nothing else.
//
// **An explicit field list, every object `.strict()`, for ADR-027's reason**:
// this is a read for somebody the trip's people never chose, so a field has to
// be opted in here rather than arrive by a spread of `TripDetail`. D4 hides
// per-person amounts and per-stop costs, and the way that holds is that **no
// object below has a field that could carry one**. The trip's total is the one
// amount, and it is the trip's, not anyone's share of it. A filter can be
// forgotten; a field that does not exist cannot be filled in. The route's
// parse throws on a key this file does not name.
//
// **No user id anywhere**, as the landing (`InviteLanding`) carries none: a
// stranger's page has no use for one (ADR-027), and a Google account's id is
// its `sub`. `people` is in join order instead — the owner first, then the
// order invites were accepted — and each person's colour is already this
// trip's (D3, resolved on the server while it still had the ids).

/**
 * Where a stop is, as the read-only map draws it.
 *
 * The fields `SharedDayMap` reads off a stop's `location` (pins, the city
 * discs, the panel's title) and no more — no address, no country. `lat` and
 * `lng` are absent together for a place nobody has put on the map, the same
 * spelling as `Location`, so a stop here is assignable to the map's input
 * (`StopsTheMapCanDraw` below).
 */
export const PreviewPlace = z
  .object({
    name: z.string(),
    city: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    precision: LocationPrecision.optional(),
  })
  .strict();
export type PreviewPlace = z.infer<typeof PreviewPlace>;

/** One stop on a day: what it is called and where. Never what it costs (D4). */
export const PreviewStop = z
  .object({
    title: z.string(),
    location: PreviewPlace.nullable(),
  })
  .strict();
export type PreviewStop = z.infer<typeof PreviewStop>;

/**
 * One day of the route, in trip order. `city` is the day's city by the same
 * derivation the board's day chips use (`cityFor`), null when no stop names
 * one. No subtotal: a day's cost is a sum of stop costs.
 */
export const PreviewDay = z
  .object({
    date: z.string().nullable(),
    city: z.string().nullable(),
    stops: z.array(PreviewStop),
  })
  .strict();
export type PreviewDay = z.infer<typeof PreviewDay>;

/**
 * A person on the trip, as a persona (D2, D3). `name` is the trip-surface name
 * (`displayNameFor`) with the chain stopped before its email link — never an
 * address. `color` and `colorShifted` mean what they mean on `MemberPersona`:
 * this trip's colour, resolved on the server before the ids are dropped, since
 * without them a client could not resolve it at all.
 */
export const PreviewPerson = z
  .object({
    name: z.string(),
    avatar: AvatarKey.nullable(),
    color: PersonColor.nullable(),
    colorShifted: z.boolean().default(false),
    travelling: z.boolean(),
  })
  .strict();
export type PreviewPerson = z.infer<typeof PreviewPerson>;

export const TripPreview = z
  .object({
    name: z.string(),
    // The first and last days' dates, as the landing and the home cards read
    // them — null for an undated trip.
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    days: z.array(PreviewDay),
    people: z.array(PreviewPerson).min(1),
    // The trip's total in its currency: `TripDetail.tripCostTotal`, recosted
    // for the effective travellers exactly as the board shows it. The ONLY
    // amount in this object (D4).
    total: Money,
  })
  .strict();
export type TripPreview = z.infer<typeof TripPreview>;

// Part 5 hands these stops to `SharedDayMap`, which today takes `SavedStop`.
// This is the promise that the preview's stop is the part of one the map reads
// — break it, and this line names the file before the invite page does.
type Assert<T extends true> = T;
export type StopsTheMapCanDraw = Assert<PreviewStop extends Pick<SavedStop, "title" | "location"> ? true : false>;
