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
// that is genuinely about a fixed date; exactly one of the two.

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
    /** Days from *today*. See the header: a seeded trip has to stay upcoming. */
    startsInDays: z.number().int().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    days: z.array(BundleDay),
    /** Parked ideas — no day, no clock, no price. `AddActivity`'s documented "omitted = backlog". */
    backlog: z.array(BundleStop).default([]),
  })
  .refine((t) => (t.startsInDays === undefined) !== (t.startDate === undefined), {
    message: "give exactly one of startsInDays or startDate",
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
  stops: z.array(BundleStop).min(1),
});
export type BundlePlaybook = z.infer<typeof BundlePlaybook>;

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
