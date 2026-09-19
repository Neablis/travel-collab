import { z } from "zod";
import {
  ActivityKind,
  ActivityTag,
  Anchor,
  Location,
  Money,
  PageDoc,
  SavedDayAuthorKind,
  SavedDayVisibility,
  TimeWindow,
} from "@tc/contracts";

// `travel-collab/content-bundle/v1` — one JSON file that can carry trips,
// playbook days and notebook templates, so content can be authored, reviewed
// and imported without being code.
//
// --- Why this is a FIXTURE format and not a contract ---
// `seedSchema.ts` next door made the same call for `trip-seed/v1` and the
// reasoning carries over: this describes a FILE, not a request or response
// shape crossing a module boundary. Nothing in `packages/contracts` gains a
// consumer from it, and putting it there would make every content edit a
// contracts change with a changelog entry (AGENTS.md invariant 5).
//
// --- What it does NOT do: restate the rules ---
// Every field that has a home in `@tc/contracts` is that contract's schema,
// imported. A stop's `kind` is `ActivityKind`, its cost is `Money`, its place
// is `Location`, a notebook's body is `PageDoc`. So a bundle cannot describe a
// stop the command API would refuse, and adding a fifth `ActivityTag` reaches
// this format with no edit here. The only shapes declared locally are the ones
// that exist nowhere else — the envelope, and the day/trip grouping.
//
// --- Dates ---
// A trip carries `startsInDays`, not a calendar date. Every seeded trip in this
// repo is dated relative to *today* for one reason (`japanTripCommands`'
// `startDate`, `isoDateInDays` in the reset route): a demo trip with a fixed
// start date is an expired trip three months later, and the homepage hero has
// nothing upcoming to show. An absolute `startDate` is available for content
// that is genuinely about a fixed date, and a trip may give NEITHER — which
// means it is dateless and its days are addressed by position (M25). At most
// one of the two; the refine on `BundleTrip` carries what changed and why.

// ---------------------------------------------------------------------------
// A stop
// ---------------------------------------------------------------------------

/**
 * One stop, in a trip's day or in a playbook.
 *
 * This is `AddActivity` minus the three ids the importer mints (`tripId`,
 * `activityId`, `dayId`) — deliberately the same field set and the same
 * schemas, so "what can a bundle say about a stop" and "what can a user do to a
 * stop" are one question. A field that appears on `AddActivity` and not here is
 * a gap to close, not a design.
 */
export const BundleStop = z.object({
  title: z.string().min(1).max(200),
  /** Omitted = unscheduled: the backlog in a trip, a stop with no clock in a playbook. */
  timeWindow: TimeWindow.optional(),
  location: Location.optional(),
  notes: z.string().max(2000).optional(),
  anchors: z.array(Anchor).optional(),
  /** Omitted = "planned", exactly as `AddActivity` documents it. */
  kind: ActivityKind.optional(),
  tags: z.array(ActivityTag).optional(),
  cost: Money.optional(),
});
export type BundleStop = z.infer<typeof BundleStop>;

// ---------------------------------------------------------------------------
// A trip
// ---------------------------------------------------------------------------

export const BundleDay = z.object({
  /**
   * What this day is FOR, in a few words ("Arrival and Ari at night").
   *
   * It is not stored — Trip Planning has no day title — so the importer folds
   * it nowhere. It exists because a 14-day itinerary written as an unlabelled
   * array of stop arrays is unreviewable, and the thing a content bundle is
   * for is being reviewed by a person before it becomes rows.
   */
  label: z.string().min(1).max(200).optional(),
  stops: z.array(BundleStop),
});
export type BundleDay = z.infer<typeof BundleDay>;

export const BundleTrip = z
  .object({
    /** Stable slug. The trip's id is derived from it, so re-import updates rather than duplicates. */
    key: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
    name: z.string().min(1).max(200),
    /** One line for a human reading the file. Not stored. */
    summary: z.string().max(500).optional(),
    /** ISO-4217. Omitted = the domain's own default (USD). */
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    budget: Money.optional(),
    /**
     * Days from *today*. See the header: a seeded trip has to stay upcoming.
     *
     * **Bounded, because the arithmetic downstream is not total.**
     * `addDays` builds a `Date` and calls `toISOString()`, which THROWS on the
     * out-of-range date a large enough offset produces — and the import route
     * turns a throw into a 500 rather than the 400 a caller could act on.
     * ±100 years refuses nothing anyone would write and keeps the conversion
     * inside the range `Date` can represent. (CodeRabbit, PR #191.)
     */
    startsInDays: z.number().int().min(-36_500).max(36_500).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    days: z.array(BundleDay),
    /** Parked ideas — no day, no clock, no price. `AddActivity`'s documented "omitted = backlog". */
    backlog: z.array(BundleStop).default([]),
  })
  // **At most one anchor, and NEITHER is a legitimate trip** (M25 question 2).
  //
  // It used to be *exactly* one, which meant a shipped, ordinary state could
  // not be expressed as a bundle at all: `TripDetail.startDate` is nullable and
  // a trip with no dates set is something the product creates on purpose. A
  // format that cannot say "this trip has no dates" cannot export one.
  //
  // **Neither anchor means the days are addressed by POSITION** — day 1, day 2,
  // not January 15th. Mitchell, 2026-09-18: *"The collection of days bundle can
  // exist, we just have offsets, day 1, not January 15th."* The format was
  // already shaped for it: `BundleDay` carries no date field of any kind, so
  // the trip anchor is the only date-bearing thing in the document and removing
  // it leaves a structure that is already complete — which is what a playbook
  // has been since ADR-041.
  //
  // **Purely widening**: all four bundles under `content/` give `startsInDays`,
  // so nothing that already exists becomes invalid, and `lint.ts` states no
  // rule about either field.
  //
  // **This relaxation is NOT sufficient on its own**, and the other half lives
  // in `toCommands.ts`: `tripStartDate`'s old `?? 0` resolved a missing anchor
  // to *starting today*, so a dateless bundle would have imported as a trip
  // silently dated to the day it was uploaded. Loosening this line alone would
  // have turned a refusal into a wrong answer.
  .refine((t) => !(t.startsInDays !== undefined && t.startDate !== undefined), {
    message: "give at most one of startsInDays or startDate",
  });
export type BundleTrip = z.infer<typeof BundleTrip>;

// ---------------------------------------------------------------------------
// A playbook day
// ---------------------------------------------------------------------------

/**
 * One row of a playbook's adds ledger — a trip that took this day, and who took
 * it (M11b link 4).
 *
 * `tripId` is optional and derived from the key plus the index when absent: the
 * ledger's trips are declared history, not rows this database has (the demo
 * library's own note says so), so a content author has no id to supply and
 * should not be asked to invent one.
 */
export const BundleAdd = z.object({
  tripId: z.string().uuid().optional(),
  addedBy: z.string().min(1),
});
export type BundleAdd = z.infer<typeof BundleAdd>;

export const BundlePlaybook = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(200),
  summary: z.string().max(500).optional(),
  /** A `users.id` — `dev-carlos` and friends in a seeded library. */
  ownerId: z.string().min(1),
  /** Private is the default everywhere else (M11b link 3); a bundle says so out loud. */
  visibility: SavedDayVisibility.default("private"),
  /**
   * Who wrote it (`saved_days.author_kind`). Defaults to the bundle's own
   * `origin`, applied by `parseBundle` rather than here so one honest
   * declaration at the top of a generated file covers every day in it.
   */
  origin: SavedDayAuthorKind.optional(),
  /**
   * When it entered the library — `saved_days.created_at`, which is what
   * Discover's season filter buckets from. Seed a set with one timestamp and
   * three quarters of that control returns nothing.
   */
  keptOn: z.string().optional(),
  /** The trip it was lifted out of: a SNAPSHOT of a name, never a row (ADR-028). */
  sourceTrip: z.object({ id: z.string().uuid().optional(), name: z.string().min(1).max(200) }),
  addedBy: z.array(BundleAdd).default([]),
  /**
   * A ONE-DAY playbook's stops. The original shape, and still the ordinary one.
   *
   * Exactly one of `stops` and `days` — see the refine below.
   */
  stops: z.array(BundleStop).min(1).optional(),
  /**
   * A MULTI-DAY playbook, as days (M23, ADR-048).
   *
   * **`BundleDay`, the same shape a bundle trip's days already use**, rather
   * than a per-stop `dayIndex`. A content bundle exists to be REVIEWED by a
   * person before it becomes rows (this file's own header), and a flat list of
   * forty stops each carrying `dayIndex: 2` is not reviewable — which is
   * precisely the argument `BundleDay.label` already makes one type up. The
   * stored form is flat and indexed (that is ADR-048's migration-cost
   * decision); the AUTHORED form does not have to be, and these two shapes have
   * opposite constraints. Nothing parses old bundle bytes out of a database.
   *
   * A day with an empty `stops` array is a deliberate rest day and is kept as
   * one — it becomes a gap in the stored `dayIndex`, and `dayCount` counts it.
   * That is the one thing the flat form cannot express by itself.
   */
  days: z.array(BundleDay).min(1).optional(),
})
  .refine((p) => (p.stops === undefined) !== (p.days === undefined), {
    message: "A playbook declares either `stops` (one day) or `days` (a sequence), not both and not neither.",
    path: ["stops"],
  });
export type BundlePlaybook = z.infer<typeof BundlePlaybook>;

/**
 * Every stop in a playbook, whichever shape it was authored in.
 *
 * The checks that read a playbook's stops — currency mixing, pricing, the city
 * census — ask about the whole playbook and not about a day within it, so they
 * should not each have to know that `stops` and `days` are two spellings of one
 * thing. Added with `days` (M23): before it, `playbook.stops` was simply always
 * there.
 */
export function playbookStops(playbook: BundlePlaybook): BundleStop[] {
  return playbook.days === undefined ? (playbook.stops ?? []) : playbook.days.flatMap((d) => d.stops);
}

// ---------------------------------------------------------------------------
// A notebook template
// ---------------------------------------------------------------------------

export const BundleNotebook = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  title: z.string().min(1).max(200),
  /** The gallery card's second line. Required: a template card with no description is a title twice. */
  description: z.string().min(1).max(300),
  /**
   * Whether every new trip gets this one planted in it, or it is only offered
   * in "Start from a template".
   *
   * Default false, and the default is the point: a library that seeds itself
   * into every trip stops being a library at about four entries.
   */
  seedIntoNewTrips: z.boolean().default(false),
  /**
   * The document itself — `PageDoc`, the same schema the write path enforces
   * (ADR-038 decision 4). A template that cannot be saved losslessly is a
   * template that must not be imported.
   *
   * Widget PARAMS are not validated here: their schemas live in the registry
   * (`@tc/pages`), which this package may not import. `packages/pages`'
   * own test resolves every built-in template's widgets instead.
   */
  content: PageDoc,
});
export type BundleNotebook = z.infer<typeof BundleNotebook>;

// ---------------------------------------------------------------------------
// The envelope
// ---------------------------------------------------------------------------

export const BundleMeta = z.object({
  /** Slug for the file. Namespaces every derived id, so two bundles cannot collide. */
  id: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  /**
   * **Who wrote the content in this file**, and the reason the field exists at
   * all: a library that mixes days people kept out of their own trips with days
   * a model wrote has to be able to say which is which — in the database, not
   * just in a commit message. Every playbook in the file inherits it unless it
   * overrides.
   */
  origin: SavedDayAuthorKind,
  /** Free-form provenance: the itineraries or guides the content was built from. */
  sources: z.array(z.string()).default([]),
  generatedAt: z.string().optional(),
});
export type BundleMeta = z.infer<typeof BundleMeta>;

export const ContentBundleV1 = z.object({
  $schema: z.literal("travel-collab/content-bundle/v1"),
  bundle: BundleMeta,
  trips: z.array(BundleTrip).default([]),
  playbooks: z.array(BundlePlaybook).default([]),
  notebooks: z.array(BundleNotebook).default([]),
  /**
   * Loose stops, belonging to no day and no playbook — a wishlist.
   *
   * The smallest thing the format carries, and the reason it is a section of
   * its own rather than "a playbook with one stop": a playbook is a DAY, with
   * an order and a shape somebody chose, and calling a list of unrelated ideas
   * one would be lying about what it is. These land in a trip's backlog, which
   * is where an idea with no slot yet already lives (`AddActivity`'s documented
   * "omitted = backlog").
   *
   * They need a trip to land in, so the importer only writes them when `--trip`
   * names one — the same rule notebooks follow, for the same reason.
   */
  activities: z.array(BundleStop).default([]),
});
export type ContentBundleV1 = z.infer<typeof ContentBundleV1>;

/**
 * **What a USER UPLOAD is read as** (M25 link 3) — the same document, narrowed
 * to the sections an upload actually writes.
 *
 * **Not a second format.** Same `$schema` literal, same `BundleMeta`, same
 * `BundleTrip`. A file that satisfies `ContentBundleV1` satisfies this, and the
 * ignored sections are simply not carried through — zod strips an unknown key
 * rather than refusing it, so a bundle with playbooks and notebooks still
 * imports its trip.
 *
 * **It exists because the published reference must not promise what the
 * endpoint does not do.** Declared as the full `ContentBundleV1`, the import
 * endpoint's generated `requestBody` was 26 KB, most of it the recursive
 * `PageDoc` AST under `notebooks` — telling an integrator they may send
 * notebook documents to an endpoint that discards them without a word. Exactly
 * the same objection as `TripExportBundle`'s, on the other side of the wire.
 *
 * **What is NOT given up by narrowing.** The correctness boundary an upload
 * needs is over the trip it writes, and `BundleTrip` here is the same schema
 * `parseBundle` applies — so a malformed stop, an impossible time window or a
 * fractional cost is still a 400 naming the path that is wrong. The sections
 * this drops are ones nothing reads.
 */
export const TripImportBundle = z.object({
  $schema: z.literal("travel-collab/content-bundle/v1"),
  bundle: BundleMeta,
  trips: z.array(BundleTrip).default([]),
});
export type TripImportBundle = z.infer<typeof TripImportBundle>;

/**
 * Validates raw JSON against `content-bundle/v1` and resolves the two things
 * the file is allowed to leave implicit: a playbook's `origin` (inherited from
 * the bundle) and nothing else.
 *
 * Ids are deliberately NOT resolved here — see `toCommands.ts` and
 * `toPlaybooks.ts`. Parsing answers "is this a bundle"; minting ids is what a
 * particular import does with it, and a caller that wants to read a bundle
 * without writing anything should not be handed uuids it has no use for.
 */
export function parseBundle(json: unknown): ContentBundleV1 {
  const parsed = ContentBundleV1.parse(json);
  return {
    ...parsed,
    playbooks: parsed.playbooks.map((p) => ({ ...p, origin: p.origin ?? parsed.bundle.origin })),
  };
}
