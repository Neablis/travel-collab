import { z } from "zod";
import { Money } from "./money.ts";
import { described } from "./valueKind.ts";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const TimeWindow = z
  .object({ start: z.string().regex(HHMM), end: z.string().regex(HHMM) })
  .refine((w) => w.start < w.end, { message: "end must be after start" });
export type TimeWindow = z.infer<typeof TimeWindow>;

export const Weekday = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export type Weekday = z.infer<typeof Weekday>;

const ISO_DATE_A = /^\d{4}-\d{2}-\d{2}$/;

// Constraint on WHEN an activity may fall. All four ship in M3; the first three
// evaluate live (domain Task D3), publicHoliday is inert (permissive stub).
export const Anchor = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("dayOfWeek"), days: z.array(Weekday).min(1) }),
    z.object({ kind: z.literal("dateRange"), from: z.string().regex(ISO_DATE_A), to: z.string().regex(ISO_DATE_A) }),
    z.object({ kind: z.literal("timeOfDay"), window: TimeWindow }),
    z.object({ kind: z.literal("publicHoliday"), country: z.string().regex(/^[A-Z]{2}$/) }),
  ])
  .superRefine((a, ctx) => {
    if (a.kind === "dateRange" && a.from > a.to) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "from must be <= to" });
    }
  });
export type Anchor = z.infer<typeof Anchor>;

/**
 * What a `Location`'s coordinates DESCRIBE. Declared as its own schema so a
 * consumer needing the enum imports it, rather than reaching through
 * `Location.innerType().shape.precision.unwrap()` — `Location` carries a
 * `.refine()`, so every such reach has to know that and breaks if the refinement
 * moves. `read.ts` was doing exactly that before this existed.
 *
 * **`area` is currently unreachable at runtime, and that is honest rather than
 * aspirational.** `GeocodeResult` carries no granularity of its own, so
 * `enrichCommandLocations` can only ever write `venue` or `city`; the middle
 * tier exists because `scripts/geocode-content.py` already produces it offline
 * (docs/guidelines/content-bundles.md) and a runtime enum that could not
 * represent a bundle's own answer would make the two vocabularies different
 * again. Anything rendering these must treat `area` as possible.
 */
export const LocationPrecision = z.enum(["venue", "area", "city"]);
export type LocationPrecision = z.infer<typeof LocationPrecision>;

// **A postal address, structured the way the world actually writes them** —
// the model CLDR, libaddressinput and google.type.PostalAddress share, cut to
// what a travel stop needs. Never one free-text string, and never
// `street` + `houseNumber`: "Hauptstraße 5" puts the number after the street,
// and a Japanese address has block numbers and often no street name at all.
// `lines` holds the street-level part in the country's own order.
//
// **Caller-authored, never vendor-built.** Nominatim-family geocoders return
// address components with no per-country ordering, so assembling `lines` from
// them would mean shipping a formatter for each country. An address is stored
// exactly as its author wrote it; geocoding only ADDS coordinates to it.
//
// Optional on Location and on every field but `countryCode`/`lines`, because
// `trip_details.doc` is raw jsonb parsed on read (see location-address.test.ts).
// Deliberately absent, addable later without changing existing fields:
// sortingCode (FR CEDEX), languageCode/script, recipient, organisation.
export const PostalAddress = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/).describe("ISO 3166-1 alpha-2, uppercase. Decides how the other fields are read."),
  lines: z
    .array(z.string().trim().min(1).max(200))
    .min(1)
    .max(4)
    .describe("Street-level part, in the country's own order, e.g. [\"Hauptstraße 5\"] or [\"1-2-3 Nishi-Azabu\"]."),
  dependentLocality: z.string().trim().min(1).max(200).optional().describe("District, neighbourhood or suburb when it is part of the postal address."),
  locality: z.string().trim().min(1).max(200).optional().describe("City, town or post town."),
  administrativeArea: z.string().trim().min(1).max(200).optional().describe("State, province, prefecture or region."),
  postalCode: z.string().trim().min(1).max(20).optional().describe("A string: keeps leading zeros and letters."),
});
export type PostalAddress = z.infer<typeof PostalAddress>;

export const Location = z
  .object({
    name: z.string().min(1).max(200),
    lat: z.number().min(-90).max(90).optional().describe("Send with lng, or omit both. When omitted on a v1 write, the server geocodes `address`, then `name`."),
    lng: z.number().min(-180).max(180).optional().describe("Send with lat, or omit both."),
    countryCode: z.string().regex(/^[A-Z]{2}$/).optional(), // populated by the geocoder (ADR-007)
    // Populated by the geocoder from its structured address data (city, or
    // the nearest equivalent — town/village/hamlet), distinct from `name`
    // (the full place label, e.g. "National Museum of Play at The Strong,
    // Rochester, Monroe County, New York, 14607, USA"). Optional: manually-
    // entered locations, or a geocoder result with no city-level address
    // component, carry no city. cityFor() (DayChips.tsx) prefers this over
    // `name` for grouping/coloring by city; falls back to `name` when a
    // location predates this field or never had one.
    city: z.string().min(1).max(200).optional(),
    // The sub-settlement locality: neighbourhood, suburb, quarter, or city
    // district, populated by the geocoder from the same structured address
    // data as `city` and strictly finer-grained than it ("Nishi-Azabu" inside
    // "Tokyo"). Display-only: it is what shortPlace() (apps/web/src/lib/place.ts)
    // shows on a timeline route/place line so a day inside one city reads
    // "Nishi-Azabu → Ebisu" rather than "Tokyo → Tokyo", and it is
    // cityFor()'s (DayChips.tsx) fallback when there is no city, in place of
    // the venue name that stood in for one before (KI-35).
    //
    // Nothing groups or colours by it: the calendar's city cards and the day
    // accents group strictly on `city`, deliberately (see
    // components/lenses/calendarCityCards.ts).
    //
    // Optional, like `city` and for the same reasons: manually-entered
    // locations, geocoder results with no sub-settlement component, and every
    // location written before this field existed carry none. That optionality
    // is load-bearing, not tidiness — `trip_details.doc` is stored as raw
    // jsonb and parsed on read, so a projection written before this field must
    // still parse (see contracts/test/ki35-location-area.test.ts, and the M18
    // regression it exists to not repeat).
    area: z.string().min(1).max(200).optional(),
    // **What `lat`/`lng` DESCRIBE — not how good they are.** A city centroid is
    // not an imprecise coordinate; it is a precise coordinate for a city, and
    // naming the granularity keeps that a fact rather than a verdict.
    //
    // The three words are not new. `scripts/geocode-content.py` already tiers
    // its answers `venue` / `area` / `city` and refuses to write the third
    // (docs/guidelines/content-bundles.md), on the grounds that "putting every
    // stop of a day on one point draws a map that says something false about
    // the day". Runtime enrichment now writes city-level coordinates where the
    // vendor cannot corroborate a venue (KI-2026-08-30-f is why that is the
    // common case, not the rare one), so the map has to be able to say which
    // it is holding. Reusing the pipeline's vocabulary makes the offline
    // tiering and the runtime one the same concept instead of two that drift.
    //
    // **Absent means UNKNOWN, and that is load-bearing — it does not mean
    // `venue`.** Every location in the database predates this field: the
    // hand-authored Japan fixtures, everything a user typed, and every
    // coordinate the assistant has written so far. Claiming venue precision
    // for all of them would be exactly the laundering of a guess into a stored
    // fact that KI-15 is about. `trip_details.doc` is raw jsonb parsed on
    // read, so an absent key must also simply parse — the same guarantee
    // `area` carries, and the same one M18 broke by shipping a required field
    // into this shape (see contracts/test/location-precision.test.ts).
    //
    // NOT a fourth tier for the assistant's own unverified guess, which today
    // reaches the map indistinguishable from a vendor-verified venue. That is
    // a real gap and a deliberate omission: naming it is a product decision
    // about what the map should claim, not a shape this PR can settle.
    precision: LocationPrecision.optional(),
    // A structured postal address (see PostalAddress). Independent of
    // `city`/`area`, which are the geocoder's display/grouping fields: a post
    // town and the city a stop groups under legitimately differ. Only
    // `countryCode` is checked against it (refine below), because two country
    // fields that can disagree is a bug generator (activity.ts, ActivityTag).
    address: PostalAddress.optional(),
  })
  .refine((l) => (l.lat === undefined) === (l.lng === undefined), {
    message: "lat and lng must be provided together",
  })
  // `precision` describes the COORDINATES, so it cannot outlive them — a
  // location carrying `precision: "city"` and no lat/lng is a claim about a
  // value that is not there. `sanitizeCoords` (geocodeEnrichment.ts) already
  // treats that shape as incoherent and drops `precision` whenever it drops a
  // null-island pair; this makes the same rule structural instead of leaving
  // one writer to remember it. Raised by CodeRabbit on PR 169.
  //
  // Safe to add as a REFINEMENT rather than a migration concern: `precision`
  // ships in the same PR, so no stored document can carry it yet, and a
  // document with no `precision` is unaffected.
  .refine((l) => l.precision === undefined || l.lat !== undefined, {
    message: "precision requires coordinates",
    path: ["precision"],
  })
  .refine((l) => l.address === undefined || l.countryCode === undefined || l.countryCode === l.address.countryCode, {
    message: "countryCode must match address.countryCode",
    path: ["address", "countryCode"],
  });
export type Location = z.infer<typeof Location>;

// Where a stop sits in the planning workflow. Exactly one per activity, and
// never absent: "planned" is the zero value, which is why the field defaults
// rather than being nullable.
//
// Three values since M28 (ADR-054, Mitchell 2026-09-25): `planned` is the
// default, `pending` is anything not settled yet (it absorbed `idea` and
// `hold`), and `transit` is travel. `booked` went too: it was folded into
// `planned`, because the difference was too small to be worth a badge, a
// picker option and a rule. `needsBooking` (@tc/pages) counts `pending`.
//
// This is the WRITE vocabulary: commands, the editor and the assistant only
// ever produce these three. Stored data is read through `StoredActivityKind`.
export const ActivityKind = z.enum(["planned", "pending", "transit"]);
export type ActivityKind = z.infer<typeof ActivityKind>;

/**
 * The kinds retired by M28, and the kind each is read back as (ADR-054).
 * Never written again, and never offered, but every event, `trip_details`
 * row, saved day and content file written before M28 still says them, and
 * the event log is replayed forever (invariants 1 and 2).
 */
export const RETIRED_ACTIVITY_KINDS = {
  idea: "pending",
  hold: "pending",
  booked: "planned",
} as const satisfies Record<string, ActivityKind>;
export type RetiredActivityKind = keyof typeof RETIRED_ACTIVITY_KINDS;

/** A retired kind's replacement; anything else is returned untouched for the enum to judge. */
export function readActivityKind(value: unknown): unknown {
  return typeof value === "string" && Object.hasOwn(RETIRED_ACTIVITY_KINDS, value)
    ? RETIRED_ACTIVITY_KINDS[value as RetiredActivityKind]
    : value;
}

/**
 * `ActivityKind` for a value read back from storage: a retired kind is
 * translated on the way in, so everything past the parse sees only the three.
 *
 * Used exactly where a stored shape is parsed — the event payloads (through
 * `ActivitySnapshot`), `trip_details.doc` (`ActivityView`), `saved_days`
 * (`SavedStop`) and content bundles. Commands keep the strict enum: a command
 * is never stored, so a retired kind on one is a caller that has not moved,
 * and refusing it says so.
 */
export const StoredActivityKind = z.preprocess(readActivityKind, ActivityKind);

// What sort of thing a stop IS — orthogonal to where it is in the workflow.
// A closed vocabulary, never freeform: the design attaches behaviour to each
// tag ("power"), and a free string can't carry one.
//
// The handoff lists six; `considering` and `travel` are deliberately absent
// because ActivityKind already answers those (`pending` and `transit`). Two
// fields that can disagree about one fact is a bug generator: a stop tagged
// `considering` while its kind said `booked` (a kind M28 retired) would have
// rendered dashed under a "Booked" badge with its cost outside the committed
// total, and no surface would own the contradiction.
// See docs/milestones/M18-stop-kind.md.
export const ActivityTag = z.enum(["meal", "lodging", "ticketed", "outdoors"]);
export type ActivityTag = z.infer<typeof ActivityTag>;

// HOW a transit stop travels — `kind: "transit"` says THAT it is travel, this
// says by what (M24, ADR-053). Closed for the reason `ActivityTag` is: each
// value gets behaviour (a map style, a legend key), and a free string cannot
// carry one. Taxi and rental fold into `car`; metro and tram into `train`.
export const ActivityMode = z.enum(["walk", "bus", "train", "flight", "ferry", "car", "bike"]);
export type ActivityMode = z.infer<typeof ActivityMode>;

/** The two fields that describe a journey, and so are legal only on a transit stop. */
export type TravelLegField = "mode" | "endLocation";

/**
 * Which travel-leg fields a stop carries while NOT being a transit stop — empty
 * when the stop is legal.
 *
 * **One rule, two places it is asked.** The command unions (`trip.ts`) refuse
 * a command that states the contradiction outright; `decideTripCommand` refuses
 * an `UpdateActivity` whose RESULT would hold it (a patch that sets
 * `kind: "pending"` and leaves an earlier `mode` behind), which no schema can see
 * because it depends on the stored stop. Both call this, so they cannot drift.
 *
 * This is what makes `mode` beside `kind` safe where a second workflow field
 * was not (the `ActivityTag` note above): `mode`'s presence is a function of
 * `kind`, so the two can never assert competing answers
 * (docs/milestones/M24-travel-legs.md, "Two decisions").
 *
 * Deliberately NOT applied to the event payloads or the read models. An event
 * is a fact already decided, and replay must never refuse one; `trip_details`
 * and `saved_days` are jsonb read back on every request, where a refinement
 * drops or 500s a stored row (KI-20260905-l).
 */
export function travelLegFieldsOffTransit(stop: {
  kind: ActivityKind;
  mode?: ActivityMode | null;
  endLocation?: Location | null;
}): TravelLegField[] {
  if (stop.kind === "transit") return [];
  const off: TravelLegField[] = [];
  if (stop.mode != null) off.push("mode");
  if (stop.endLocation != null) off.push("endLocation");
  return off;
}

// ---- Commands ----

export const AddActivity = z.object({
  type: z.literal("AddActivity"),
  tripId: z.string().uuid(),
  activityId: z.string().uuid(),
  // M13 link 5. Both optional: a stop added without saying who it is for is
  // the ordinary case, and the zero values are "nobody" and "everybody's
  // business", not "unknown".
  bookedBy: z.string().nullable().optional(),
  participants: z.array(z.string()).optional(),
  dayId: z.string().uuid().optional(), // omitted = backlog
  title: z.string().min(1).max(200),
  timeWindow: TimeWindow.optional(),
  location: Location.optional(),
  // A CITATION, not a place: the number of one candidate the assistant's place
  // search returned this turn, which the server resolves into `location` (the
  // vendor's name and its coordinates) before the command reaches the domain.
  // That is the whole of M9's grounding — a stored place becomes one the vendor
  // returned rather than one the model wrote (KI-81). `nonnegative` rather than
  // `positive` because the numbering the search tool prints is that tool's to
  // choose, and a schema that forbade 0 would decide it from here.
  //
  // Transport only, which is why it is absent from `ActivitySnapshot` below:
  // what is worth storing forever is the resolved place, never the index the
  // model used to name it, and a ref outlives nothing (the candidates are a
  // per-turn server-side cache).
  //
  // **Optional on purpose.** A location a *user* typed arrives as free text with
  // no ref at all, and the best-effort geocoding fallback still runs for it —
  // grounding replaces the model's guess, not the user's words. That is what
  // closes KI-15's remaining half rather than deleting it.
  placeRef: z.number().int().nonnegative().optional(),
  notes: z.string().max(2000).optional(),
  anchors: z.array(Anchor).optional(),
  kind: ActivityKind.optional(),         // omitted = "planned"
  tags: z.array(ActivityTag).optional(), // omitted = none
  cost: Money.optional(), // omitted = no cost
  // M24. Legal only with `kind: "transit"` — refused on the command unions in
  // trip.ts and again by the decider (see `travelLegFieldsOffTransit`).
  mode: ActivityMode.optional(),        // omitted = no mode
  endLocation: Location.optional(),     // omitted = no destination; `location` is where the leg starts
});
export type AddActivity = z.infer<typeof AddActivity>;

// Omitted field = unchanged; null = cleared. Title cannot be cleared.
export const UpdateActivity = z.object({
  type: z.literal("UpdateActivity"),
  tripId: z.string().uuid(),
  activityId: z.string().uuid(),
  // M13 link 5. Omitted = unchanged; `null` clears `bookedBy`. `participants`
  // is replaced wholesale rather than added to — the editor hands back the
  // whole list, and a partial add/remove command would need its own conflict
  // story the moment two people edit the same stop's list.
  bookedBy: z.string().nullable().optional(),
  participants: z.array(z.string()).optional(),
  title: z.string().min(1).max(200).optional(),
  timeWindow: TimeWindow.nullable().optional(),
  location: Location.nullable().optional(),
  // The same citation as on AddActivity, and NOT nullable for the same reason
  // it is not stored: clearing a location is `location: null`, which says what
  // it means — a ref to nothing says only that the model lost its place.
  placeRef: z.number().int().nonnegative().optional(),
  notes: z.string().max(2000).nullable().optional(),
  anchors: z.array(Anchor).optional(),
  kind: ActivityKind.optional(),         // omitted = unchanged; no null (set "planned" to clear)
  tags: z.array(ActivityTag).optional(), // omitted = unchanged; whole-array replace, like anchors
  cost: Money.nullable().optional(), // omitted = unchanged, null = cleared
  // M24. Omitted = unchanged, null = cleared. Whether the RESULT is legal
  // depends on the stored `kind`, so the decider checks it, not this schema.
  // Nothing clears these for you: moving a stop off `transit` while it keeps
  // a mode is refused, and the caller sends `mode: null` alongside.
  mode: ActivityMode.nullable().optional(),
  endLocation: Location.nullable().optional(),
});
export type UpdateActivity = z.infer<typeof UpdateActivity>;

export const MoveActivity = z.object({
  type: z.literal("MoveActivity"),
  tripId: z.string().uuid(),
  activityId: z.string().uuid(),
  toDayId: z.string().uuid().nullable(), // null = backlog
  position: z.number().int().nonnegative(),
});
export type MoveActivity = z.infer<typeof MoveActivity>;

export const RemoveActivity = z.object({
  type: z.literal("RemoveActivity"),
  tripId: z.string().uuid(),
  activityId: z.string().uuid(),
});
export type RemoveActivity = z.infer<typeof RemoveActivity>;

// ---- The stored activity field set ----

/**
 * **The fields an activity carries in state and on the wire, declared
 * once.** Both event payloads below and the domain's `ActivityState` are
 * derived from this object, so a ninth field is a *compile error* at every site
 * that has to handle it rather than a silent no-op at twenty-odd. The read
 * model's `ActivityView` is the one deliberate exception — it is not derived,
 * it is held to this shape by a key-parity assertion in `detail.ts`, and that
 * file says why. That is the whole point: the class of bug has shipped
 * three times — KI-1 (day order), KI-54 (`city`/`countryCode` invisible to
 * equality, so a city-only edit was rejected as a no-op) and M18's editor sheet
 * dropping `kind`/`tags` — every time as a field nothing compared. See
 * KI-2026-09-05-o, and `equality.ts`'s `FIELD_EQUAL`, which is where the
 * compile error actually lands.
 *
 * Shaped the way an event payload has to be, because that is the constraint
 * with no escape hatch: explicit null instead of omission, and a `.default()`
 * on every field added after v1 shipped so a payload written before that field
 * existed still parses off jsonb. `ActivityAddedV1` and `ActivityUpdatedV1`
 * both `.extend()` it rather than listing it twice (they were verbatim copies
 * until 2026-08-28). The duplication was a live hazard, not just noise: a
 * `.default()` added to one payload and missed on the other corrupts replay for
 * *updated* activities only, and nothing would surface it until someone
 * replayed an old log. `.extend()` after the ids keeps the shape's key order —
 * and therefore the serialised payload — unchanged.
 *
 * **`placeRef` is deliberately not a member** — see `AddActivity.placeRef`
 * above. It is a per-turn citation the server resolves into `location`, not
 * something an activity carries.
 *
 * **`saved.ts`'s `SavedStop` is deliberately NOT derived from this.** It looks
 * like the same fields, but its header states a different rule about
 * `.default()` and its `kind`/`tags` are required, not defaulted; deriving it
 * would silently change how already-saved `saved_days.stops` jsonb parses.
 *
 * **`described()` marks what a page may print** (the attribute manifest's
 * `stop` root, M14 field widget). Opt-in, so a field added here is unpublished
 * until someone labels it. `bookedBy` and `participants` hold user ids and stay
 * unlabelled: a page is a shared document. `anchors` and `timeWindow` have no
 * value kind that prints them yet. `HIDDEN_STOP_FIELDS` (manifest.ts) hides a
 * labelled one without touching this file.
 */
export const ActivitySnapshot = z.object({
  title: described("text", "Name", z.string().min(1).max(200)),
  timeWindow: TimeWindow.nullable(),
  location: described("location", "Place", Location).nullable(),
  notes: described("text", "Notes", z.string().max(2000)).nullable(),
  anchors: z.array(Anchor).default([]),
  // `kind` and `tags` are DEFAULTED rather than required, and on the event
  // payload that is what lets a pre-M18 payload replay off jsonb at all.
  // `ActivityView` carries the same two defaults for the same reason on the
  // read side — `trip_details.doc` is stored jsonb, and since KI-2026-09-05-r
  // `getTripDetail` parses it at the source rather than handing it back raw —
  // but it states them itself, because it is not derived from this shape.
  // Every document written before M18 added these two fields has neither key,
  // and a row is only rewritten when its trip next changes, so a required
  // `kind` 500s the board for any trip nobody has touched since. That is
  // exactly what it did on the #71 preview (GET /api/trips/… → ZodError,
  // `kind` Required). The defaults are what lets an untouched pre-M18 row be
  // read back at all.
  //
  // They are also the zero values the rest of the stack already agrees on:
  // `AddActivity.kind` is optional and documented "omitted = planned", and
  // `state.ts` calls "planned" the zero value outright.
  // `StoredActivityKind`: this shape IS the event payload, so a retired kind
  // written before M28 must still replay (ADR-054).
  kind: described("enum", "Status", StoredActivityKind).default("planned"), // never null — "planned" is the zero value
  tags: described("enum", "Tags", z.array(ActivityTag)).default([]), // never null — [] is the zero value
  cost: described("money", "Cost", Money).nullable().default(null),
  // ---- Per-stop attribution (M13 link 5) ----
  //
  // **Two relations, not one.** Mitchell, 2026-09-03 (recorded in
  // `M19-cost-model.md` link 3): *"we need activities to have owners (and i
  // think participants that are going to that activity)"*. Who **booked** a
  // stop is not who is **going** to it, and M19's splits need the participants,
  // not the owner — so a single `assignee` would satisfy `add-stop-who`'s
  // wording and still be wrong for every split later built on it.
  //
  // Named `bookedBy` rather than `owner` deliberately: `owner` is already a
  // `TripRole` and the `saved_days.owner_id` column, and an activity-level
  // `owner` would read as "the trip's owner" at every call site. `bookedBy`
  // names the distinction M19 actually draws.
  //
  // Both are member user ids, and **nothing in the domain validates them
  // against the member list** — deliberately, and not as an omission. Two
  // reasons: a trip whose member later leaves must still replay, and the
  // AUTHORITATIVE member list is not in the log at all. `TripState.members` is
  // only what the log produced (the creator); invited members live in
  // `trip_memberships` and are overlaid at the read boundary by
  // `effectiveMembers`. A decider checking `state.members` would therefore
  // reject a legitimately invited editor. Validation, where it is wanted,
  // belongs on the server where that overlay exists — and the UI only ever
  // offers current members, so an id from nowhere is not reachable through
  // the product.
  //
  // Defaulted, never required, for exactly the reason `kind` and `tags` are:
  // every payload and every `trip_details.doc` written before this field
  // existed has no such key, and a row is only rewritten when its trip next
  // changes. A required field here 500s the board for any trip nobody has
  // touched since — which is what it did to the #71 preview.
  bookedBy: z.string().nullable().default(null),
  participants: z.array(z.string()).default([]),
  // ---- The travel leg (M24, ADR-053) ----
  //
  // By what (`mode`), and to where (`endLocation`). `location` keeps meaning
  // exactly what it meant before: on a transit stop, where the leg STARTS — so
  // no existing reader of `location` changes meaning.
  //
  // Defaulted to null for the reason `bookedBy` is: every stored payload and
  // `trip_details.doc` predates them. Legal only on a transit stop, and not
  // refined here — see `travelLegFieldsOffTransit` for why an event must parse
  // regardless. Unlabelled (no `described()`), so no page prints them yet.
  mode: ActivityMode.nullable().default(null),
  endLocation: Location.nullable().default(null),
});
export type ActivitySnapshot = z.infer<typeof ActivitySnapshot>;

// ---- Events (payloads use explicit null — they are stored as jsonb forever) ----

export const ActivityAddedV1 = z.object({
  type: z.literal("ActivityAdded"),
  version: z.literal(1),
  payload: z
    .object({
      tripId: z.string().uuid(),
      activityId: z.string().uuid(),
      dayId: z.string().uuid().nullable(),
    })
    .extend(ActivitySnapshot.shape),
});
export type ActivityAddedV1 = z.infer<typeof ActivityAddedV1>;

// Snapshot of the full field set AFTER the update — replay never merges patches.
export const ActivityUpdatedV1 = z.object({
  type: z.literal("ActivityUpdated"),
  version: z.literal(1),
  payload: z
    .object({
      tripId: z.string().uuid(),
      activityId: z.string().uuid(),
    })
    .extend(ActivitySnapshot.shape),
});
export type ActivityUpdatedV1 = z.infer<typeof ActivityUpdatedV1>;

export const ActivityMovedV1 = z.object({
  type: z.literal("ActivityMoved"),
  version: z.literal(1),
  payload: z.object({
    tripId: z.string().uuid(),
    activityId: z.string().uuid(),
    toDayId: z.string().uuid().nullable(),
    position: z.number().int().nonnegative(),
  }),
});
export type ActivityMovedV1 = z.infer<typeof ActivityMovedV1>;

export const ActivityRemovedV1 = z.object({
  type: z.literal("ActivityRemoved"),
  version: z.literal(1),
  payload: z.object({
    tripId: z.string().uuid(),
    activityId: z.string().uuid(),
  }),
});
export type ActivityRemovedV1 = z.infer<typeof ActivityRemovedV1>;
