import { z } from "zod";
import { ActivityMode, StoredActivityKind, ActivityTag, Anchor, Location, TimeWindow, travelLegFieldsOffTransit } from "./activity.ts";
import { Money } from "./money.ts";

// Saved parts (M11 link 6, ADR-029) — "select parts of my trip and save them
// for reuse".
//
// A saved day is a personal, reusable FRAGMENT: an ordered list of stops with
// their times, places, costs and notes, and deliberately no dates. It is not
// planning state — it belongs to a person, not to a trip — so it is ordinary
// CRUD in its own module, the same shape the module map gives Identity and
// Access. Nothing here is event-sourced (ADR-003).

/**
 * One stop inside a saved sequence.
 *
 * `ActivityView` minus `activityId`: an id would tie the fragment to the
 * activity it was copied from, and inserting the same saved day into two
 * trips would then put the same id in two streams — the KI-1 hazard, and the
 * same reason `cloneTrip` remaps ids (ADR-028). Ids are minted fresh at insert
 * time instead.
 *
 * **EVERY FIELD ADDED TO THIS OBJECT FROM 2026-09-19 ONWARDS CARRIES
 * `.default()`.** This is a rule, not a style note, and `KI-20260905-l` is the
 * entry that asked for it. `saved_days.stops` is jsonb with a compile-time
 * `$type` cast and no version wrapper, read through a strict
 * `SavedStop.array().safeParse` that DROPS the row on failure — so one required
 * field added here removes every previously-saved Playbook from its owner's
 * library and from Discover, silently, at read time, on data the user already
 * saved. A defaulted field is additive: an old row parses, and the default is
 * what it always meant. `dayIndex` below is the first field to adopt the rule.
 *
 * **The rule is enforced, not remembered.** `test/saved.test.ts` parses
 * `test/fixtures/savedStopV0.ts` — frozen copies of the oldest stops ever
 * stored — through `SavedStop.array()`, and fails on a new required field here
 * or in anything nested (`Location`, `Money`, …). The fix for that red is a
 * `.default()`, never an edit to the fixture.
 *
 * **There is no `{ v, stops }` wrapper, deliberately** (KI-2026-09-05-l,
 * resolved 2026-09-25). An additive change needs only the default. A change a
 * default cannot express — a rename, a type change, a money-model change — is
 * the moment to build the wrapper and a migration on read, and ADR-048 says the
 * first such change pays for it. The guard makes sure that moment is a red
 * contract test rather than empty libraries.
 */
export const SavedStop = z.object({
  title: z.string(),
  timeWindow: TimeWindow.nullable(),
  location: Location.nullable(),
  notes: z.string().nullable(),
  anchors: z.array(Anchor),
  // A retired kind in a day saved before M28 reads as its replacement
  // (ADR-054): `saved_days` is jsonb read back on every request.
  kind: StoredActivityKind,
  tags: z.array(ActivityTag),
  cost: Money.nullable(),
  /**
   * **Which day of the sequence this stop is on. 0-based** (ADR-048 decision 1).
   *
   * The whole of M23 rests on this one field: a saved day generalises into a
   * saved SEQUENCE by giving each stop a day, rather than by nesting the array
   * or growing a second object type.
   *
   * **It is a RELATIVE OFFSET INSIDE THE SEQUENCE, never an absolute trip
   * day**, and the name invites exactly the wrong reading, so: a three-day
   * playbook stores `{0, 1, 2}` and stores it once. Appended to a trip that
   * already has five days it becomes that trip's days 6, 7 and 8; used to
   * start a new trip it becomes that trip's days 1, 2 and 3. **The same stored
   * value, a different base — and the base belongs to the insert, not to the
   * playbook.** (Mitchell, 2026-09-19, confirming the model.) A `dayIndex` that
   * had absorbed the trip's numbering would be a fragment that only fits where
   * it came from — the same mistake ADR-029 refused when it dropped the day's
   * calendar DATE, and for the same reason.
   *
   * What travels with it: the stops of one day stay together on one day, in
   * their stored order, with their times unchanged. A 09:00 stop on the
   * playbook's day 2 is a 09:00 stop on trip day 7. Nothing is re-timed and
   * nothing is redistributed.
   *
   * **0-based, because that is already this codebase's spelling.**
   * `citiesOfDay(detail, dayIndex)` indexes `detail.days` from zero and every
   * surface that renders a day label already adds one — `TripBoardScreen`
   * (`Day ${askScope.dayIndex + 1}`), `DayChips`, `KeepDayDialog`,
   * `KeepDayFlag`, `SharedTripScreen`. A 1-based field spelled `dayIndex`
   * sitting beside a 0-based one spelled `dayIndex` is how off-by-ones get
   * written, and the saving would have been one `+ 1` at a label.
   *
   * The cost of 0 is that it is FALSY: `stop.dayIndex || 1` and
   * `if (!stop.dayIndex)` are both silent bugs that pass every test written
   * against a sequence whose first day is not the interesting one. Nothing
   * should read this ad hoc — `citiesOfSequence` and `groupByDay` are the
   * readers, and M23's gate has a test that fails if a second grouping appears.
   *
   * **`.default(0)` is the entire additive property**, per the rule above:
   * every row written before this field existed parses, with every stop on day
   * one, which is exactly what those rows have always meant.
   *
   * **A GAP IN THIS INDEX IS AN EMPTY DAY** (ADR-048 decision 2), and that is
   * load-bearing rather than incidental. Indices are dense over the days the
   * author SELECTED, not over the days that turned out to have stops: keep
   * trip days [A, B, C] with B empty and the stored indices are {0, 2}, which
   * is a three-day sequence whose middle day is deliberately empty. Compacting
   * gaps on read would silently turn it into a two-day sequence — so nothing
   * compacts them, anywhere.
   *
   * **Monotonic non-decreasing over the array is a WRITE-path invariant, never
   * a read-path one** (ADR-048 decision 3). The refinement lives on
   * `SavedDaySequence` below, which only the write path uses. Putting it here
   * would reach the two read boundaries that share this schema and drop rows
   * whose stops are every one of them valid — `KI-20260905-l`'s hazard,
   * re-created on purpose.
   */
  dayIndex: z.number().int().nonnegative().default(0),
  // M24's travel leg, defaulted per the rule above: every saved row predates
  // them. Not refined to transit-only here, for the reason `dayIndex`'s
  // monotonicity is not — this schema is the read boundary too. A saved stop
  // is only ever copied from an activity the decider already accepted, and
  // becomes one again through `AddActivity`, which checks it.
  mode: ActivityMode.nullable().default(null),
  endLocation: Location.nullable().default(null),
});
export type SavedStop = z.infer<typeof SavedStop>;

/**
 * The stops of a sequence, as the WRITE PATH alone validates them.
 *
 * `SavedStop.array()` plus the one invariant a reader must not enforce:
 * `dayIndex` is monotonic non-decreasing, so the array is in sequence order as
 * stored. ADR-048 decision 3 in one schema — **the enforcement is here and the
 * tolerance is at the read boundary**, because the two have opposite
 * consequences for a row already on disk. A write that violates this is a
 * caller bug, caught before it becomes bytes, at the parse `savedDays.ts`
 * already runs on what it is about to insert (KI-71's write-path half). A READ
 * that enforced it would drop the row.
 *
 * Deliberately a separate schema rather than a `.superRefine` on
 * `SavedStop.array()`: that array is the shared parse at `fromRow` and
 * `toDiscoverDay` too, and a refinement added there would empty libraries. This
 * is the single most mis-implementable line in M23 — it would pass every test
 * written against freshly-written rows.
 */
export const SavedDaySequence = z
  .array(SavedStop)
  .superRefine((stops, ctx) => {
    // M24's travel-leg rule, here for the same reason as the order rule below:
    // a write that breaks it is refused before it becomes bytes, and a stored
    // row is never dropped for it. A stop that broke it could never be applied
    // — `AddActivity` refuses it — so a Playbook holding one is a dead end.
    for (const [i, stop] of stops.entries()) {
      for (const field of travelLegFieldsOffTransit(stop)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, field], message: `${field} is only allowed on a transit stop` });
      }
    }
    for (let i = 1; i < stops.length; i += 1) {
      if (stops[i]!.dayIndex < stops[i - 1]!.dayIndex) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, "dayIndex"],
          message: `dayIndex must not decrease: stop ${i} is on day ${stops[i]!.dayIndex} after a stop on day ${stops[i - 1]!.dayIndex}.`,
        });
        return;
      }
    }
  });
export type SavedDaySequence = z.infer<typeof SavedDaySequence>;

/**
 * Who can see a saved day. **Private is the default** (M11b link 3): a day
 * becomes findable only when its author publishes it, and unpublishing puts it
 * straight back.
 *
 * A named enum rather than an `isPublic` boolean, which is the obvious
 * alternative for two states. Three reasons, heaviest first:
 *
 *   1. **A third state is already on the roadmap.** M12 quarantines reporting
 *      and moderation, and a day withdrawn by a moderator is neither the
 *      author's `private` (they did not choose it, and their own unpublish/
 *      publish must not silently undo it) nor `public`. Adding a member here
 *      is a contract change with an exhaustiveness typecheck behind it — the
 *      property `AdmissionRefusal` was chosen for; widening a boolean is a
 *      column rewrite plus a re-reading of every site that said `!isPublic`.
 *   2. **The stored and wire values say what they mean.** `visibility:
 *      "public"` reads the same in a row, a JSON body and a log line;
 *      `is_public: false` has to be decoded against a field name.
 *   3. It is what this repo already does for a small closed state set —
 *      `trip_invites.status`, `TripStatus`.
 *
 * ADR-029 decision 3 deleted the shell's three-option select ("Only me / Trip
 * collaborators / Anyone with the link") and is explicit that "anyone with the
 * link" returns as a bearer token on its own table (ADR-027's shape), NOT as a
 * member here. This enum is about discoverability in the public library and
 * nothing else.
 */
export const SavedDayVisibility = z.enum(["private", "public"]);
export type SavedDayVisibility = z.infer<typeof SavedDayVisibility>;

/**
 * **Who wrote this day** — a person keeping a day out of their own trip, or a
 * generated seed.
 *
 * Mitchell, 2026-09-06: *"we will need to indicate in the database when its a
 * human playbook or a AI seed data"*. It is a column rather than a naming
 * convention or a reserved owner id for the same reason `visibility` is an
 * enum: the question gets asked by surfaces that have a row and nothing else,
 * and "is the owner one of the five dev-* accounts" is a rule that stops being
 * true the first time a real person signs up with a seeded day in their name.
 *
 * `"human"` is the DEFAULT, in the contract and in the column, and that
 * direction is deliberate: everything written before this field existed was
 * written by a person through `POST /api/saved-days`, and everything written
 * after it by that same route still is. Only the content importer says
 * otherwise, and it says so explicitly.
 *
 * `"ai"`, not `"seed"`: the distinction Mitchell asked for is about *who wrote
 * the content*, not about how it got into the database. A day a person wrote
 * that ships in the starter library is a human playbook that happens to be
 * seeded, and the two must not collapse into one word.
 *
 * What it is NOT: a moderation state. `visibility` owns discoverability and
 * `deleted_at` owns removal; this says only where the words came from.
 *
 * **Named `authorKind`, not `origin`.** `Origin` is already taken, one file
 * over in `history.ts`, for the provenance of a batch of EVENTS — user, undo,
 * redo, revert — and `events.origin` is a real jsonb column carrying it. Two
 * columns called `origin` on two tables, meaning two unrelated things, is the
 * kind of ambiguity this codebase pays down rather than adds to. `authorKind`
 * also refuses the other misreading: it holds a KIND, never a `users.id` —
 * `owner_id` is who owns the day, and this is what sort of author wrote it.
 */
export const SavedDayAuthorKind = z.enum(["human", "ai"]);
export type SavedDayAuthorKind = z.infer<typeof SavedDayAuthorKind>;

export const SavedDay = z.object({
  savedDayId: z.string().uuid(),
  ownerId: z.string().min(1),
  name: z.string().min(1).max(200),
  stops: z.array(SavedStop),
  /**
   * **How many days this sequence spans** (ADR-048 decision 2).
   *
   * `1` for every playbook saved before M23, and the default says so: an
   * existing playbook is a sequence of length one, not a special case with its
   * own branch. That is the entire migration story for this field.
   *
   * **Stored rather than derived from `max(stops[].dayIndex) + 1`**, and the
   * reasoning is worth keeping because the derived version looks free:
   *
   *   1. **A gap in `dayIndex` already expresses an INTERIOR empty day** — keep
   *      days [A, B, C] with B empty and the indices are {0, 2}. What a gap
   *      cannot reach is a TRAILING empty day, and "your rest day survived but
   *      your departure day vanished" is an asymmetry no user can state.
   *   2. **An insert promises this number before it acts.** "A 3-day bundle
   *      becomes days 6, 7, 8" (Mitchell, 2026-09-19) is a promise about a
   *      count; a derived count quietly delivers days 6 and 7 whenever the
   *      bundle's last day is empty.
   *   3. **Discover filters on length in SQL, and can only do that against a
   *      COLUMN.** `stops` is jsonb precisely so it is never queried into
   *      (ADR-029), so a derived length could only be applied in application
   *      code over the truncated 200-row candidate window — which is exactly
   *      how the budget band's chip counts came to disagree with the page below
   *      them (KI-2026-08-31). A length filter has to be a real predicate.
   *
   * **It is not a denormalisation, so the `adds` argument does not apply.**
   * `saved_days.adds` caches a `count(*)` over a ledger that is the authority.
   * This has no authority to drift from: it is the only home for the
   * trailing-empty fact. What `stops` does impose is a FLOOR —
   * `dayCount >= max(dayIndex) + 1` — and the read boundary repairs upward to
   * it rather than dropping the row, so no stop is ever rendered into a day the
   * count says does not exist.
   */
  dayCount: z.number().int().min(1).default(1),
  /**
   * The cities this day touches, derived from `stops[].location.city` at SAVE
   * time and stored — a snapshot, on the same terms as `sourceTripName` below
   * (M11b link 1).
   *
   * Stored rather than derived per read because `stops` is jsonb precisely so
   * it is never queried into (ADR-029); deriving this per Discover query would
   * be querying into the value that ADR says is a value. `[]`, never null,
   * when no stop carries a city — so "how many cities does this day touch" is
   * always a length.
   *
   * The derivation is `citiesOfStops` in `@tc/domain`, and only that: time
   * order, `location.city` with no name/area fallback, duplicates collapsed to
   * the first occurrence. It is the same function `citiesOfDay` folds, so a
   * profile's cities cannot disagree with Discover's.
   */
  cities: z.array(z.string().min(1)),
  visibility: SavedDayVisibility,
  /** Who wrote it — see `SavedDayAuthorKind`. Defaulted so a row written before the column existed reads as human. */
  authorKind: SavedDayAuthorKind.default("human"),
  /**
   * How many times this day has been added to a trip — the denormalised
   * counter over the adds ledger (M11b link 4), and what the leaderboard
   * ranks on.
   *
   * A count rather than a list because every surface that shows it shows a
   * number. The ledger is the authority: an add counts once per trip, only
   * after the trip has dates, and never when the author copies their own day
   * into their own trip. **A build that counts raw inserts produces a
   * different and gameable order** — which is the whole reason the ledger
   * exists rather than an `adds++`.
   */
  adds: z.number().int().nonnegative(),
  // Where it came from, on the same terms as a trip's lineage (ADR-028): the
  // trip's name is a SNAPSHOT taken at save time, so the credit survives the
  // source being renamed, deleted, or becoming unreadable.
  sourceTripId: z.string().uuid(),
  sourceTripName: z.string().min(1).max(200),
  createdAt: z.string(),
  /**
   * **The content revision, starting at 1** (ADR-050, Pass A). A change to
   * `name`, `summary` or the days moves it by exactly one; publishing and
   * unpublishing do not, because they change who can see the content and not
   * what it says. An editor sends the number it read as `expectedVersion`, and
   * a stale one is refused rather than written over (409).
   *
   * **Defaulted, per `SavedStop`'s rule, and for the same reason.** A DTO
   * produced before the column existed, or by a consumer that never heard of
   * it, parses — and "never edited" is exactly what version 1 means.
   */
  version: z.number().int().min(1).default(1),
  /**
   * One authored paragraph saying what this Playbook is for, or null. Written
   * by the author (or a content bundle); never derived from the stops.
   * Defaulted to null so old bytes parse, per the rule above.
   */
  summary: z.string().max(500).nullable().default(null),
});
export type SavedDay = z.infer<typeof SavedDay>;

/**
 * **An operator hid this day from the library** (M12 link 6), as its AUTHOR is
 * told it — `hide-day`'s `saved_days.moderated_at` and `moderation_note`, the
 * note being "the one line the author's copy can show about why it left the
 * library" (`AdminReportAction`). KI-2026-09-23-i.
 *
 * **Deliberately not a field on `SavedDay`.** `SavedDay` is what every reader
 * gets — the shared-day read, `/v1/playbooks`, `/v1/library` — and a note
 * written to the author is not for any of them. It rides beside the day on
 * `GET /api/saved-days/:id`'s envelope, as `publishedAt` does, and the route
 * sends it only when `isAuthor`; everyone else's envelope carries `null`. A
 * field on `SavedDay` would instead need every future non-author read path to
 * remember to blank it.
 *
 * `moderationNote` is defaulted to null so a payload that predates it parses.
 */
export const SavedDayModeration = z.object({
  /** When the operator hid it (ISO-8601). Kept, not re-stamped, by a second hide. */
  moderatedAt: z.string().min(1),
  /** The operator's note to the author, or null when they left none. */
  moderationNote: z.string().nullable().default(null),
});
export type SavedDayModeration = z.infer<typeof SavedDayModeration>;

/**
 * The client names a day and points at it; the SERVER reads the stops.
 *
 * Deliberately not `{ name, stops }`: letting a client post the plan content
 * would make this an unvalidated write path into a person's library, and the
 * server has to read the trip to authorize the save anyway.
 */
export const CreateSavedDayInput = z.object({
  name: z.string().min(1).max(200),
  tripId: z.string().uuid(),
  /**
   * **The days to keep, in the order they will run in the sequence** (M23 link
   * 2). Their position in THIS array becomes each stop's `dayIndex`, so the
   * source trip's own numbering is not carried over: keeping trip days 1, 3 and
   * 5 produces a three-day playbook, not a five-day one with holes punched in
   * it.
   *
   * **An array, and a one-element array is the ordinary case.** Deliberately
   * not `dayId | dayIds`, and not an optional second field beside the old one:
   * two shapes is a branch at every call site forever, and the milestone's
   * requirement is that the single-day call not get HARDER, not that it keep
   * its old spelling. `[dayId]` is not harder.
   *
   * **Bounded at 366, reusing the number the repo already picked** for an
   * imported trip (`api/v1/trips/import/route.ts`). A trip you may import is a
   * trip you should be able to keep days from, and a second, smaller number
   * here would only invent a trip whose days cannot all be saved. The bound is
   * on the INPUT — a cheap refusal at the write path — and deliberately not on
   * a stored `dayCount` read back out: amputating a stored value on read is how
   * a library empties itself (`KI-20260905-l`).
   *
   * A day that appears twice is a caller bug rather than a repetition feature,
   * and the write path refuses it: two identical `dayIndex` groups would be
   * indistinguishable from one day's stops split across two days.
   */
  dayIds: z.array(z.string().uuid()).min(1).max(366),
});
export type CreateSavedDayInput = z.infer<typeof CreateSavedDayInput>;

/**
 * **How many located stops a saved day needs before a map beats the list.**
 *
 * SPEC §16: below two, a canvas adds nothing the list does not already say —
 * one pin is an illustration of a single address, and zero is a blank square.
 *
 * It lives HERE, rather than beside `worthDrawing` in `apps/web`, because two
 * packages have to agree on it and one of them cannot import the other.
 * `packages/fixtures` asserts that the seeded Playbook library contains a day
 * that actually draws; with a private copy of this number that assertion went
 * green whenever the app's copy moved out from under it, which is exactly the
 * drift it exists to catch (CodeRabbit, PR #196).
 */
export const MIN_POINTS_TO_DRAW = 2;
