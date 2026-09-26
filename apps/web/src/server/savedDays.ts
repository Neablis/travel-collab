import { randomUUID } from "node:crypto";
import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import type { ZodIssue } from "zod";
import {
  KIND_DETAIL_FIELDS,
  SavedDayAuthorKind,
  SavedDayVisibility,
  SavedDaySequence,
  SavedStop,
  type BatchableCommand,
  type SavedDay,
  type SavedDayModeration,
  type TripDetail,
} from "@tc/contracts";
import { citiesOfSequence, countriesOfStops, foldEnvelopes } from "@tc/domain";
import { forgetCitySearches } from "./cities";
import { db } from "./db/client";
import { savedDays } from "./db/schema";
import { isUuid } from "./ids";
import { parseSavedDayColumns } from "./savedDayRow";
import { executeTripCommandBatch, type CommandResult } from "./commands";
import { readStream } from "./eventStore";
import { addCounts, recordAdd } from "./savedDayAdds";
import type { AccessError, AccessResult } from "./access/invites";
// Shared with the UI (the Keep-this-day dialog describes what it is about to
// save). Lives in src/lib because the lint wall forbids UI importing
// @/server/*, and two copies of "what's included" would be two chances to
// disagree in the one place a user is asked to trust a summary.
import { isDroppedFromPlaybook, stopsForDays } from "@/lib/savedStops";

// The Library: a person's saved day fragments (M11 link 6, ADR-029). CRUD,
// owned by a person rather than by a trip, and not event-sourced — the same
// boundary ADR-003 draws for Identity and Access.
//
// Authorization is NOT decided here. Saving reads a trip (the caller checks
// `viewer`), inserting writes one (the caller checks `editor`); this module
// only ever owns the library rows themselves.

type SavedDayRow = typeof savedDays.$inferSelect;

/**
 * The one place a stored instant becomes a `SavedDay`'s string. The column is
 * `mode: "date"` precisely so this conversion cannot be skipped on the write
 * path: a row built in memory carries a `Date` exactly like a row read back
 * does, so both paths render the same ISO-8601 string (KI-53).
 *
 * `stops` is passed in rather than read off the row, so that every path into a
 * `SavedDay` has had to produce a PARSED array first — see `fromRow` (KI-71).
 */
function toDto(row: SavedDayRow, stops: SavedStop[]): SavedDay {
  return {
    savedDayId: row.id,
    ownerId: row.ownerId,
    name: row.name,
    stops,
    dayCount: row.dayCount,
    cities: row.cities,
    visibility: row.visibility,
    authorKind: row.authorKind,
    adds: row.adds,
    sourceTripId: row.sourceTripId,
    sourceTripName: row.sourceTripName,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
    summary: row.summary,
  };
}

/**
 * The read boundary: a stored row becomes a `SavedDay`, or it becomes nothing.
 *
 * **The parsing itself lives in `parseSavedDayColumns`**, shared with
 * `playbooks.ts`'s `toDiscoverDay` (F-F05). It was duplicated here and there
 * with identical log strings until M23, and ADR-048 made the shared helper a
 * prerequisite rather than a cleanup: the sequence work adds a `dayIndex` sort
 * and a `dayCount` floor to this boundary, and a row that reads as three days
 * in a library and two on its Discover card is worse than either answer.
 *
 * What is left here is the mapping to the DTO. `toDto` still takes the parsed
 * stops as an argument rather than reading `row.stops`, so every path into a
 * `SavedDay` has had to produce a parsed array first (KI-71).
 */
function fromRow(row: SavedDayRow): SavedDay | null {
  const parsed = parseSavedDayColumns({
    savedDayId: row.id,
    stops: row.stops,
    visibility: row.visibility,
    authorKind: row.authorKind,
    dayCount: row.dayCount,
  });
  if (parsed === null) return null;
  return toDto(
    { ...row, visibility: parsed.visibility, authorKind: parsed.authorKind, dayCount: parsed.dayCount },
    parsed.stops,
  );
}

/**
 * Keep one or more of a trip's days as a Playbook (M23 link 2).
 *
 * **`dayIds` is an ordered SET of days and need not be contiguous in the trip.**
 * Mitchell, 2026-09-19: *"I would really prefer they don't have to be
 * sequential days in your trip ... you aren't selecting a range."* Keeping trip
 * days 1, 3 and 5 produces a three-day Playbook indexed {0, 1, 2}; the days you
 * skipped simply are not in it. `stopsForDays` owns that stamping.
 *
 * **`dayCount` is the number of days SELECTED, not the number that turned out
 * to have stops.** That is the whole of ADR-048 decision 2 in one assignment: a
 * selected day with no stops leaves a GAP in `dayIndex` when it is in the
 * middle, and leaves nothing at all when it is last — so the count has to come
 * from the selection, which is the only place that knows. Keep three days and
 * the Playbook is three days, whatever the third one holds.
 *
 * The two halves — `captureDays` and `storeSavedDay` — are exported because
 * `/v1/playbooks` runs a step between them (ADR-050, Pass A).
 *
 * **`dateAnchors: "strip"` is the app's keep** (KI-2026-09-24-c): it runs the
 * same `withoutDateAnchors` step `/v1/playbooks` does, so a Playbook kept in the
 * app no longer carries "only 3–5 May" into every trip it is added to. The
 * Keep dialog says which stops lose one before the button acts. The default is
 * `"keep"` only because `POST /v1/library` also calls this and its behaviour is
 * not changed here.
 */
export async function saveDay(
  input: { name: string; dayIds: readonly string[]; dateAnchors?: "keep" | "strip" },
  detail: TripDetail,
  ownerId: string,
  now: string = new Date().toISOString(),
): Promise<AccessResult<SavedDay>> {
  const captured = captureDays(detail, input.dayIds);
  if (!captured.ok) return captured;
  const stops = input.dateAnchors === "strip" ? withoutDateAnchors(captured.value).stops : captured.value;
  return storeSavedDay({
    ownerId,
    name: input.name,
    stops,
    dayCount: input.dayIds.length,
    sourceTripId: detail.tripId,
    sourceTripName: detail.name,
    now,
    context: { tripId: detail.tripId, dayIds: input.dayIds },
  });
}

/**
 * The stops a selection of a trip's days would keep, or the refusal.
 *
 * `keepOnly` narrows a day to some of its activities (ADR-050, Pass A) — the
 * app never passes it, so its keep is whole days exactly as before. A day named
 * there keeps only those activities, **in the trip's order, not the order
 * given**: a Playbook's day is the day as it ran, minus what you left out. An
 * id that is not on the day it was named with is refused by name, rather than
 * silently dropped — a caller who typed one wrong id would otherwise get a
 * Playbook quietly missing a stop.
 */
export function captureDays(
  detail: TripDetail,
  dayIds: readonly string[],
  keepOnly?: ReadonlyMap<string, readonly string[]>,
): AccessResult<SavedStop[]> {
  // A repeated day is a caller bug, not a repetition feature: two identical
  // `dayIndex` groups would be indistinguishable from one day's stops split
  // across two days, and no UI can produce it — the calendar toggles a day on
  // or off. Refused here rather than silently de-duplicated, because
  // de-duplicating would quietly save fewer days than the caller asked for.
  if (new Set(dayIds).size !== dayIds.length) {
    return { ok: false, error: { code: "invalid", message: "That list names the same day twice." } };
  }
  const filter = new Map<string, ReadonlySet<string>>();
  for (const [dayId, activityIds] of keepOnly ?? []) {
    const day = detail.days.find((d) => d.dayId === dayId);
    // A missing DAY is `stopsForDays`' refusal below, with its own words.
    if (day === undefined) continue;
    const onDay = new Set(day.activityIds);
    const foreign = activityIds.find((id) => !onDay.has(id));
    if (foreign !== undefined) {
      return {
        ok: false,
        error: { code: "invalid", message: `Activity ${foreign} is not on day ${dayId}.` },
      };
    }
    filter.set(dayId, new Set(activityIds));
  }
  const stops = stopsForDays(detail, dayIds, filter);
  if (stops === null) {
    return { ok: false, error: { code: "not-found", message: "That day is not in this trip." } };
  }
  return { ok: true, value: stops };
}

/**
 * What a refused `SavedDaySequence` answers with. A kind-detail field on a stop
 * of another kind (M24's travel leg, ADR-055's pending reason) is a rule the
 * caller broke and can fix in one stop, so it is named, with the stop's index,
 * in the contract's own words. Asked through `KIND_DETAIL_FIELDS`, so a new
 * detail field is named here without an edit. Every other refusal keeps the
 * bare sentence it always had; its detail is in the log.
 */
function sequenceRefusal(issues: readonly ZodIssue[], sentence: string): string {
  const named = issues.filter(
    (issue) =>
      issue.code === "custom" &&
      issue.path.length === 2 &&
      typeof issue.path[1] === "string" &&
      Object.hasOwn(KIND_DETAIL_FIELDS, issue.path[1]),
  );
  if (named.length === 0) return `${sentence}.`;
  return `${sentence}: ${named.map((issue) => `${issue.message} (stop ${issue.path[0]})`).join("; ")}.`;
}

/**
 * Validate a sequence and insert it as a new `saved_days` row — every write of
 * a new Playbook by a person goes through here, whether its stops came from a
 * trip or from the request body.
 */
export async function storeSavedDay(input: {
  ownerId: string;
  name: string;
  summary?: string | null;
  stops: SavedStop[];
  dayCount: number;
  sourceTripId: string;
  sourceTripName: string;
  /**
   * Who wrote the words — absent = a person. Only `POST /v1/playbooks/import`
   * passes it: a file declares its own `origin`, and an AI-written Playbook
   * uploaded by a person is still AI-written (ADR-050, Pass C).
   */
  authorKind?: SavedDayAuthorKind;
  now: string;
  /** What the refusal log names, so a bad write can be traced to its source. */
  context: Record<string, unknown>;
}): Promise<AccessResult<SavedDay>> {
  // A selection that holds nothing at all saves nothing worth reusing, and the
  // "Save" button is disabled for one — but the API is the boundary, so it says
  // so too. Note this is the WHOLE selection being empty: one empty day among
  // three is a rest day, and it is kept.
  if (input.stops.length === 0) {
    return { ok: false, error: { code: "invalid", message: "Those days have no stops to save." } };
  }
  // Trimmed BEFORE the emptiness check, not after: `SavedDay.name` requires
  // at least one character, and "   " passes the route's Zod parse on length
  // 3 and then trims to "" — a row that violates its own contract and throws
  // on the next read (CodeRabbit, PR #71).
  const name = input.name.trim();
  if (name === "") {
    return { ok: false, error: { code: "invalid", message: "Give this day a name." } };
  }
  // Checked BEFORE the insert, deliberately (KI-71's write-path half). The
  // stops come from `stopsForDays` over a `TripDetail` the caller was handed —
  // which is exactly the value that used to be an unparsed `trip_details.doc`,
  // and copied `undefined` into a required `SavedStop.kind` so the response
  // threw AFTER the library row had already been inserted (PR #71 review §2).
  // Refusing here means the failure mode is "nothing was saved", not "an
  // unreadable row is in your library and the request 500ed".
  //
  // **`SavedDaySequence`, not `SavedStop.array()`** — this is the one site that
  // enforces `dayIndex` monotonicity (ADR-048 decision 3). The two READ
  // boundaries must not: they sort and keep, because dropping a row whose stops
  // are each valid is how a library empties itself (KI-20260905-l).
  const validated = SavedDaySequence.safeParse(input.stops);
  if (!validated.success) {
    console.error("refused to save a day whose stops do not match SavedStop", {
      ...input.context,
      issues: validated.error.issues,
    });
    return {
      ok: false,
      error: { code: "invalid", message: sequenceRefusal(validated.error.issues, "This day cannot be saved") },
    };
  }
  const row = newSavedDayRow({
    ownerId: input.ownerId,
    name,
    summary: input.summary,
    stops: validated.data,
    dayCount: input.dayCount,
    sourceTripId: input.sourceTripId,
    sourceTripName: input.sourceTripName,
    ...(input.authorKind !== undefined ? { authorKind: input.authorKind } : {}),
    createdAt: new Date(input.now),
  });
  await db.insert(savedDays).values(row);
  return { ok: true, value: toDto(row, validated.data) };
}

/**
 * **The columns a sequence's stops decide** — stored snapshots, never authored.
 *
 * One function because two writers need it: `newSavedDayRow` on insert, and
 * `updatePlaybookContent` when a Playbook's days are replaced (ADR-050, Pass A).
 * A replace that recomputed `cities` and forgot `countries` would leave a
 * Playbook findable by a country it no longer visits.
 */
function sequenceColumns(
  stops: SavedStop[],
  dayCount: number | undefined,
): Pick<SavedDayRow, "stops" | "dayCount" | "cities" | "countries"> {
  return {
    stops,
    // The floor when the caller did not say — see `newSavedDayRow`'s
    // `dayCount`. Never below it either way: a count that cannot hold its own
    // stops is the one value `parseSavedDayColumns` has to repair on every read.
    dayCount: Math.max(
      dayCount ?? 1,
      stops.reduce((max, s) => (s.dayIndex + 1 > max ? s.dayIndex + 1 : max), 1),
    ),
    // Derived HERE, once, at save time — the snapshot ADR-029 already takes of
    // `sourceTripName`, for the reason link 1 gives: `stops` is jsonb because a
    // saved day is never queried into, and Discover has to search on cities.
    //
    // `citiesOfSequence` is the domain's single rule FOLDED PER DAY (M23,
    // ADR-048 decision 4) — `citiesOfStops` itself sorts timed stops into time
    // order across everything it is handed, which is right for one day and
    // silently wrong for three: day 3's 08:00 stop would sort ahead of day 1's
    // 14:00 one, and this snapshot would be in an order the sequence never runs
    // in. Over a one-day sequence the two are byte-identical.
    //
    // `citiesOfStops` is the domain's single rule, the same one `citiesOfDay`
    // folds for the trip readout. A second implementation over `SavedStop[]`
    // would be free to drift, and a profile whose cities disagree with
    // Discover's is a gate box, not a rounding error.
    cities: citiesOfSequence(stops),
    // `cities`' sibling (M12 link 7), snapshotted here for the same reason.
    // `countriesOfStops` rather than a per-day fold: a country set's order
    // means nothing, and this is the exact call the backfill makes through
    // `savedDayCountries.ts`, so the two writers agree byte-for-byte.
    countries: countriesOfStops(stops),
  };
}

/**
 * The one construction of a `saved_days` row — every derived and defaulted
 * field decided in exactly one place.
 *
 * Exported because the demo seed writes rows too (`POST /api/dev/saved-days`),
 * and the point of routing it through here is that it exercises the same
 * derivation a real save does. A seed that hand-wrote `cities` beside the stops
 * it declares would be a second source of truth that agreed only until somebody
 * edited a stop — which is the thing `packages/fixtures/japan/savedDays.ts`
 * already refuses to do on the fixture side.
 */
export function newSavedDayRow(input: {
  ownerId: string;
  name: string;
  /** Authored, or absent — stored as null. Only a person or a bundle writes one. */
  summary?: string | null;
  stops: SavedStop[];
  sourceTripId: string;
  sourceTripName: string;
  createdAt: Date;
  /** Defaults to private — see below. Only the seed ever passes anything else. */
  visibility?: SavedDayVisibility;
  /**
   * Defaults to "human". Only the content importer passes anything else, and it
   * passes it explicitly — see `SavedDayAuthorKind`. A route that forgets this
   * argument is claiming a person wrote the day, which is what every route
   * except the importer is in fact doing.
   */
  authorKind?: SavedDayAuthorKind;
  /**
   * The bundle this row was imported from, or absent for a day a person saved.
   * Only the content importer sets it, and `--prune` only ever considers rows
   * where it IS set — so leaving it off is what keeps a person's saved day
   * outside the importer's reach.
   */
  sourceBundle?: string;
  /** The seed declares its own ids so re-seeding is idempotent. */
  savedDayId?: string;
  /**
   * How many days this sequence spans. **Defaults to the stops' own floor**
   * (`max(dayIndex) + 1`), which is what a caller holding only stops can know —
   * the content importer and the demo seed are both in that position, because a
   * bundle declares stops and not a selection. A caller that knows the
   * selection passes it — `storeSavedDay`, and the content importer from a
   * bundle's authored `days:` — because the count of days SELECTED is the one
   * fact that distinguishes a three-day keep whose last day is empty from a
   * two-day keep (ADR-048 decision 2).
   */
  dayCount?: number;
}): SavedDayRow {
  const visibility = input.visibility ?? SavedDayVisibility.enum.private;
  return {
    id: input.savedDayId ?? randomUUID(),
    ownerId: input.ownerId,
    name: input.name,
    summary: input.summary ?? null,
    // Never edited. Only `updatePlaybookContent` moves it, and only by one.
    version: 1,
    ...sequenceColumns(input.stops, input.dayCount),
    // Private until its author says otherwise (M11b link 3). Spelled through
    // the contract's enum rather than as the literal "private", so the set of
    // visibilities has exactly one definition — the rule M11a set for
    // `AdmissionRefusal`.
    visibility,
    // Nobody has taken this day yet. It is only ever moved by `recordAdd`,
    // which writes the ledger row in the same statement pair; see the schema
    // note on `saved_days.adds`.
    adds: 0,
    // Nobody has reviewed it either; the review write path recomputes both
    // from `saved_day_reviews` (see the schema note on `saved_days.rating`).
    rating: null,
    reviewCount: 0,
    // Not moderated. Only an operator action moves these.
    moderatedAt: null,
    moderationNote: null,
    // Moves with `visibility` and only with it (see `setSavedDayVisibility`):
    // a row that is public has a publish time, a row that is private has none.
    publishedAt: visibility === SavedDayVisibility.enum.public ? input.createdAt : null,
    // Never deleted. Only `deleteSavedDay` ever moves this, and nothing moves
    // it back yet — the restore path the column exists for is a future button,
    // not a code path (see the schema note).
    deletedAt: null,
    // A person wrote it unless the caller says otherwise. See the column's own
    // note: the default IS the guarantee, not a convention every writer has to
    // remember.
    authorKind: input.authorKind ?? SavedDayAuthorKind.enum.human,
    sourceBundle: input.sourceBundle ?? null,
    sourceTripId: input.sourceTripId,
    sourceTripName: input.sourceTripName,
    createdAt: input.createdAt,
  };
}

/**
 * Newest first — what you just saved is what you are most likely to reach for.
 *
 * `deleted_at is null`, like every other read of this table: a soft-deleted day
 * is gone from its owner's own library too. "It just removes it here" is the
 * whole of what the button promises, and a day that reappeared in the one list
 * its owner deletes from would make the promise false.
 */
export async function listSavedDays(ownerId: string): Promise<SavedDay[]> {
  const rows = await db
    .select()
    .from(savedDays)
    .where(and(eq(savedDays.ownerId, ownerId), isNull(savedDays.deletedAt)));
  return rows
    .map(fromRow)
    // A row this server can no longer read is left out rather than allowed to
    // fail the whole library (see `fromRow`); it is logged, never silent.
    .filter((day): day is SavedDay => day !== null)
    // The `savedDayId` tie-break is what makes this order a total one. Without
    // it two days saved in the same millisecond compare equal, the SELECT above
    // has no ORDER BY to fall back on, and the pair can swap between two reads
    // — which a keyset pager turns from "cosmetic" into a day it never returns.
    .sort((a, b) =>
      a.createdAt < b.createdAt
        ? 1
        : a.createdAt > b.createdAt
          ? -1
          : a.savedDayId < b.savedDayId
            ? 1
            : a.savedDayId > b.savedDayId
              ? -1
              : 0,
    );
}

/**
 * Owner-scoped: your own day, whatever its visibility. Nobody else's, ever.
 *
 * And not a deleted one — the `deleted_at is null` clause is in the WHERE for
 * the same reason the owner clause is, so a deleted day is "no row" rather than
 * a row a caller has to remember to check.
 */
export async function getSavedDay(savedDayId: string, ownerId: string): Promise<SavedDay | null> {
  // `saved_days.id` is a uuid column (KI-2026-09-05-x). "No row" is the answer
  // to a day that is not yours, was deleted, or never existed — and it is the
  // answer to an id that could never have named one. Anything else here is a
  // `22P02` from the driver, which the routes turned into a 500.
  if (!isUuid(savedDayId)) return null;
  const rows = await db
    .select()
    .from(savedDays)
    .where(
      and(
        eq(savedDays.id, savedDayId),
        eq(savedDays.ownerId, ownerId),
        isNull(savedDays.deletedAt),
      ),
    );
  return rows[0] === undefined ? null : fromRow(rows[0]);
}

/**
 * The read rule the public library rests on: **your own day, or anybody's
 * published one.** The access seam over it, and the reasoning for why it is a
 * seam of its own rather than a role on `requireTripAccess`, is
 * `access/saved-day-access.ts`.
 *
 * Expressed in the WHERE clause rather than as a check after the read, which is
 * the same construction `getSavedDay` and `deleteSavedDay` already use: a
 * private day belonging to somebody else comes back as "no row", so it is
 * indistinguishable from one that never existed. That is the right answer to
 * both, and it is what stops a caller enumerating ids to discover what people
 * have kept to themselves.
 */
export async function readableSavedDay(
  savedDayId: string,
  readerId: string,
): Promise<SavedDay | null> {
  // `getSavedDay`'s reason. This one also covers `insertSavedDay`, which reads
  // through here — so `POST /api/trips/:id/saved-days/not-a-uuid` answers 404
  // without the route learning that uuids exist.
  if (!isUuid(savedDayId)) return null;
  const rows = await db
    .select()
    .from(savedDays)
    .where(
      and(
        eq(savedDays.id, savedDayId),
        // A deleted day is not readable by ANYONE, its author included, and it
        // is refused the same way a private one is: by producing no row, so the
        // route's 404 cannot tell the two apart. `saved-day-access.ts` records
        // why that indistinguishability is load-bearing.
        isNull(savedDays.deletedAt),
        or(
          eq(savedDays.ownerId, readerId),
          // Published AND not moderated (M12 link 6). The author keeps their
          // moderated day — this is also their direct read and the insert path
          // into their own trips — while everyone else gets the same no-row a
          // private day produces: nobody else can open,
          // insert or report a moderated day.
          and(eq(savedDays.visibility, SavedDayVisibility.enum.public), isNull(savedDays.moderatedAt)),
        ),
      ),
    );
  return rows[0] === undefined ? null : fromRow(rows[0]);
}

/**
 * When a day was last published, as an ISO string, or null when it is not.
 *
 * Read beside the shared day rather than carried on the `SavedDay` contract:
 * it is what a review held offline remembers as `seenPublishedAt`, so §15's
 * conflict banner can say the author changed the day after the review was
 * written (M12 D4). Callers have already passed the read seam; this answers
 * nothing about access.
 */
export async function publishedAtOf(savedDayId: string): Promise<string | null> {
  if (!isUuid(savedDayId)) return null;
  const rows = await db
    .select({ publishedAt: savedDays.publishedAt })
    .from(savedDays)
    .where(eq(savedDays.id, savedDayId));
  return rows[0]?.publishedAt?.toISOString() ?? null;
}

/**
 * Whether an operator hid this day from the library, and the note they left
 * its author — or null when it is not hidden (KI-2026-09-23-i).
 *
 * **Author-only by its caller, not by this query.** Like `publishedAtOf` it
 * answers nothing about access; the shared-day route asks it only when
 * `isAuthor`, and `SavedDayModeration`'s note says why it is not on `SavedDay`.
 * `reports.ts` is the only writer of both columns, and clears them together.
 */
export async function moderationOf(savedDayId: string): Promise<SavedDayModeration | null> {
  if (!isUuid(savedDayId)) return null;
  const rows = await db
    .select({ moderatedAt: savedDays.moderatedAt, moderationNote: savedDays.moderationNote })
    .from(savedDays)
    .where(eq(savedDays.id, savedDayId));
  const row = rows[0];
  if (row?.moderatedAt == null) return null;
  return { moderatedAt: row.moderatedAt.toISOString(), moderationNote: row.moderationNote };
}

/**
 * Write coordinates the server looked up into a day's stops (M27 link 10;
 * `savedDayPins.ts` decides what they are and why a reader may trigger it).
 *
 * **Not owner-scoped, unlike every other write here**, and that is the point of
 * the function rather than an oversight: `pin` may only ADD coordinates to
 * stops that had none, which is not an authored change, and `savedDayPins.ts`
 * is its only caller. It is still refused for a deleted day.
 *
 * **Written only over the exact stops it read.** The UPDATE compares the stored
 * jsonb with what `pin` was handed, so a second pass that overlapped this one
 * (two readers, two instances) loses cleanly as `"raced"` rather than writing
 * over whatever the first pass wrote.
 *
 * The result is parsed before it is written, because the read boundary drops a
 * whole row whose stops fail `SavedStop` (KI-71): a bad coordinate must cost
 * this write, never the Playbook.
 */
export async function backfillSavedDayStops(
  savedDayId: string,
  pin: (stops: readonly SavedStop[]) => Promise<SavedStop[] | null>,
): Promise<"nothing-to-do" | "written" | "unchanged" | "gone" | "raced"> {
  if (!isUuid(savedDayId)) return "gone";
  const rows = await db
    .select()
    .from(savedDays)
    .where(and(eq(savedDays.id, savedDayId), isNull(savedDays.deletedAt)));
  const row = rows[0];
  const day = row === undefined ? null : fromRow(row);
  if (row === undefined || day === null) return "gone";
  const next = await pin(day.stops);
  if (next === null) return "nothing-to-do";
  if (JSON.stringify(next) === JSON.stringify(day.stops)) return "unchanged";
  const validated = SavedStop.array().safeParse(next);
  if (!validated.success) {
    console.error("refused to write pinned stops that do not match SavedStop", {
      savedDayId,
      issues: validated.error.issues,
    });
    return "unchanged";
  }
  const updated = await db
    .update(savedDays)
    .set({ stops: validated.data })
    .where(
      and(
        eq(savedDays.id, savedDayId),
        isNull(savedDays.deletedAt),
        sql`${savedDays.stops} = ${JSON.stringify(row.stops)}::jsonb`,
      ),
    )
    .returning({ id: savedDays.id });
  return updated.length === 0 ? "raced" : "written";
}

/**
 * Publish or unpublish one of your own days (M11b link 3).
 *
 * Owner-scoped in the WHERE clause, for `getSavedDay`'s reason: somebody else's
 * day is "no row", so publishing is never something you can do to another
 * person's library and the refusal does not confirm the day exists. Unpublish
 * is here rather than in M12 because it is the author's control over their own
 * content — a publish button with no way back is not a thing to ship.
 *
 * `published_at` moves with `visibility` and only here. Publishing an
 * already-public day is a no-op on the timestamp (`COALESCE`) so that a
 * double-click, a retry or an idempotent client cannot quietly reorder
 * Discover's "newest" — unpublishing clears it, so a genuine republish does
 * take a new date, which is the honest answer for a day that was withdrawn and
 * put back.
 *
 * Returns the updated day, or null when there is no such row of yours.
 */
export async function setSavedDayVisibility(
  savedDayId: string,
  ownerId: string,
  visibility: SavedDayVisibility,
  now: string = new Date().toISOString(),
): Promise<SavedDay | null> {
  // `getSavedDay`'s reason: `null` here already means "no such row of yours",
  // and the publish route turns it into a 404 (KI-2026-09-05-x).
  if (!isUuid(savedDayId)) return null;
  const at = new Date(now);
  const updated = await db
    .update(savedDays)
    .set({
      visibility,
      publishedAt:
        visibility === SavedDayVisibility.enum.public
          ? sql`coalesce(${savedDays.publishedAt}, ${at})`
          : null,
    })
    // `deleted_at is null` as well as owner-scoped: a deleted day cannot be
    // published back into Discover. Without this an author could delete a day
    // and then publish it — the row is still there and the publish route only
    // ever knew "is it yours" — putting a day nobody can open onto the front of
    // the library.
    .where(
      and(
        eq(savedDays.id, savedDayId),
        eq(savedDays.ownerId, ownerId),
        isNull(savedDays.deletedAt),
      ),
    )
    .returning();
  if (updated[0] === undefined) return null;
  // Committed (no transaction here): the city index just gained or lost a day.
  forgetCitySearches();
  const day = fromRow(updated[0]);
  if (day === null) {
    // `null` from here means "no such row of yours", and the route turns it
    // into a 404. It must not also mean "the row is unreadable", because by
    // this point the UPDATE has ALREADY COMMITTED — the author would be told
    // the day does not exist while it sits published. `fromRow` returns null
    // for a row whose `stops` or `visibility` fail their schema, and both
    // columns are compile-time `$type` casts with no runtime guarantee, so
    // that is reachable for a row written before the contract moved.
    //
    // Failing loudly keeps the reported state and the stored state agreeing.
    // Raised in review on pull request 101.
    throw new Error(`saved day ${savedDayId} is unreadable after a committed visibility change`);
  }
  return day;
}

/**
 * An edit to one of your Playbooks (ADR-050, Pass A). Every field optional; the
 * route refuses an empty one.
 *
 * `name`, `summary` and `days` are CONTENT, and need `expectedVersion`.
 * `visibility` is not — it changes who can see the content, not what it says.
 */
export type PlaybookEdit = {
  name?: string;
  summary?: string | null;
  /** Replaces every stop. `dayCount` is the number of days authored, empty ones included. */
  days?: { stops: SavedStop[]; dayCount: number };
  visibility?: SavedDayVisibility;
  expectedVersion?: number;
};

export type PlaybookEditOutcome =
  | { ok: true; value: SavedDay }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "invalid"; message: string }
  /** `expectedVersion` was not the stored one. Nothing was written. */
  | { ok: false; reason: "stale"; currentVersion: number }
  /** `days` on a published Playbook. Nothing was written. */
  | { ok: false; reason: "published" };

/**
 * Edit one of your own Playbooks — its content, its visibility, or both.
 *
 * **One UPDATE, and the precondition is in its WHERE clause.** A content edit
 * matches only `version = expectedVersion` and sets `version = version + 1` in
 * the same statement, so two editors holding version 3 cannot both write: the
 * second matches no row. A read-then-write would let both pass the read.
 *
 * **Days only while private**, as a predicate on the same UPDATE. Reviews rate
 * the published content (M12), so replacing the stops under them would leave a
 * five-star rating on a day nobody reviewed. The author unpublishes, edits and
 * republishes — and the check is against the STORED visibility, so an edit
 * that also publishes (`{ days, visibility: "public" }`) on a private Playbook
 * is one atomic step. Name and summary may change while published: they
 * describe the content rather than being it.
 *
 * **A visibility-only edit bumps nothing**, and moves `published_at` exactly as
 * `setSavedDayVisibility` does. `expectedVersion`, if sent with one, is still
 * honoured as a precondition.
 *
 * When nothing matched, the row is re-read under the same owner scope to say
 * why — a diagnosis only; the decision was the UPDATE's. Somebody else's day
 * is still "no row" here, so the re-read cannot disclose one. A stale version
 * is reported before "published": whoever holds a stale version has to re-read
 * the Playbook before anything else they send can succeed.
 */
export async function updatePlaybookContent(
  savedDayId: string,
  ownerId: string,
  edit: PlaybookEdit,
  now: string = new Date().toISOString(),
): Promise<PlaybookEditOutcome> {
  if (!isUuid(savedDayId)) return { ok: false, reason: "not-found" };
  const content = edit.name !== undefined || edit.summary !== undefined || edit.days !== undefined;
  if (content && edit.expectedVersion === undefined) {
    return { ok: false, reason: "invalid", message: "Send expectedVersion to change a Playbook's content." };
  }

  const set: { [K in keyof SavedDayRow]?: SavedDayRow[K] | SQL } = {};
  if (edit.name !== undefined) {
    // `storeSavedDay`'s reason: "   " is 3 characters and then no name at all.
    const name = edit.name.trim();
    if (name === "") return { ok: false, reason: "invalid", message: "Give this Playbook a name." };
    set.name = name;
  }
  if (edit.summary !== undefined) {
    // Blank is "no summary", not an empty paragraph a card would render.
    set.summary = edit.summary === null || edit.summary.trim() === "" ? null : edit.summary.trim();
  }
  if (edit.days !== undefined) {
    if (edit.days.stops.length === 0) {
      return { ok: false, reason: "invalid", message: "A Playbook needs at least one stop." };
    }
    // The write path's parse, `storeSavedDay`'s reason (KI-71, ADR-048 decision 3).
    const validated = SavedDaySequence.safeParse(edit.days.stops);
    if (!validated.success) {
      console.error("refused to replace a playbook's stops that do not match SavedStop", {
        savedDayId,
        issues: validated.error.issues,
      });
      return { ok: false, reason: "invalid", message: sequenceRefusal(validated.error.issues, "These days cannot be saved") };
    }
    Object.assign(set, sequenceColumns(validated.data, edit.days.dayCount));
  }
  if (edit.visibility !== undefined) {
    set.visibility = edit.visibility;
    set.publishedAt =
      edit.visibility === SavedDayVisibility.enum.public
        ? sql`coalesce(${savedDays.publishedAt}, ${new Date(now)})`
        : null;
  }
  if (content) set.version = sql`${savedDays.version} + 1`;

  const updated = await db
    .update(savedDays)
    .set(set)
    .where(
      and(
        eq(savedDays.id, savedDayId),
        eq(savedDays.ownerId, ownerId),
        isNull(savedDays.deletedAt),
        edit.expectedVersion === undefined ? undefined : eq(savedDays.version, edit.expectedVersion),
        edit.days === undefined ? undefined : eq(savedDays.visibility, SavedDayVisibility.enum.private),
      ),
    )
    .returning();
  if (updated[0] !== undefined) {
    // Only visibility can move the city index: `days` is refused on a public day.
    if (edit.visibility !== undefined) forgetCitySearches();
    const day = fromRow(updated[0]);
    // `setSavedDayVisibility`'s reason: the UPDATE has committed, so "not
    // found" would be a lie about a row that is there.
    if (day === null) throw new Error(`saved day ${savedDayId} is unreadable after a committed edit`);
    return { ok: true, value: day };
  }

  const rows = await db
    .select({ version: savedDays.version, visibility: savedDays.visibility })
    .from(savedDays)
    .where(and(eq(savedDays.id, savedDayId), eq(savedDays.ownerId, ownerId), isNull(savedDays.deletedAt)));
  const current = rows[0];
  if (current === undefined) return { ok: false, reason: "not-found" };
  if (edit.expectedVersion !== undefined && current.version !== edit.expectedVersion) {
    return { ok: false, reason: "stale", currentVersion: current.version };
  }
  if (edit.days !== undefined && current.visibility !== SavedDayVisibility.enum.private) {
    return { ok: false, reason: "published" };
  }
  // Both held on the re-read, so something moved between the two statements.
  // That is a concurrent edit, and the caller's answer to it is a re-read.
  return { ok: false, reason: "stale", currentVersion: current.version };
}

/** An absolute-date anchor taken off a stop on its way into a Playbook. */
export type RemovedDateAnchor = { stopIndex: number; title: string; from: string; to: string };

/**
 * A sequence with every **calendar-date** anchor removed, and a list of what
 * went (ADR-050, Pass A).
 *
 * A Playbook has no dates — ADR-029 dropped the day's date so a fragment fits
 * any trip — and a `dateRange` anchor is a date by another name: "only 3–5 May"
 * carried into October is a conflict on every stop it touched. Weekday,
 * time-of-day and public-holiday anchors describe the place rather than the
 * trip, and are kept.
 *
 * `/v1/playbooks` applies this, and so does the app's keep (`saveDay` with
 * `dateAnchors: "strip"`, KI-2026-09-24-c); `POST /v1/library` does not.
 */
export function withoutDateAnchors(stops: readonly SavedStop[]): {
  stops: SavedStop[];
  removed: RemovedDateAnchor[];
} {
  const removed: RemovedDateAnchor[] = [];
  const kept = stops.map((stop, stopIndex) => {
    const anchors = stop.anchors.filter((anchor) => {
      if (!isDroppedFromPlaybook(anchor)) return true;
      removed.push({ stopIndex, title: stop.title, from: anchor.from, to: anchor.to });
      return false;
    });
    return anchors.length === stop.anchors.length ? stop : { ...stop, anchors };
  });
  return { stops: kept, removed };
}

/**
 * What `deleteSavedDay` answered with. Three outcomes, because two of them are
 * different refusals and the route owes them different words.
 *
 *   * `deleted` — the row is soft-deleted and gone from every read;
 *   * `published` — the day is public, so it must be unpublished first;
 *   * `not-found` — there is no such day of yours, and this is deliberately
 *     also the answer for somebody else's day and for one already deleted.
 */
export type SavedDayDeletion = "deleted" | "published" | "not-found";

/**
 * Delete one of your own days — a SOFT delete (Mitchell, 2026-09-01: *"for now
 * we can even just add a new db column deletedAt and set the deleted at date,
 * and set a filter to not return deletedAt activities so we have a way to
 * restore in the future"*).
 *
 * **What this does not touch, and must never touch.** The adds ledger
 * (`saved_day_adds`) is a record of what happened, not a grant, so no row is
 * removed from it — the same reasoning `scopePredicate` already records for the
 * `saved` scope. And a day somebody has already taken stays in their trip:
 * `insertCommands` mints fresh ids and appends real events into THAT trip's
 * stream, so the copy is a value with nothing pointing back here (ADR-029).
 * *"It doesn't remove it from anyone, it just removes it here."*
 *
 * **Published days are refused rather than silently unpublished.** Deleting a
 * day that is out in the library is two decisions — withdraw it, then remove
 * it — and doing both off one button would take a day out of everyone's
 * Discover results as a side effect of an action whose stated scope is "just
 * removes it here". The author unpublishes first, deliberately, and the refusal
 * says so.
 *
 * **Owner-scoped in the WHERE clause**, the construction every other write on
 * this table uses: somebody else's day is "no row", so a refusal never confirms
 * that an id names something. The published check is expressed as a predicate
 * on the same UPDATE rather than as a read-then-write, so a publish landing
 * between the two cannot slip a public day past it.
 *
 * Idempotent by omission: deleting an already-deleted day matches nothing and
 * answers `not-found`, which is what every read of it already says.
 */
export async function deleteSavedDay(
  savedDayId: string,
  ownerId: string,
  now: string = new Date().toISOString(),
): Promise<SavedDayDeletion> {
  // `getSavedDay`'s reason. `not-found` and not `published`: an id that is not
  // a uuid names nothing, so there is nothing to unpublish first
  // (KI-2026-09-05-x).
  if (!isUuid(savedDayId)) return "not-found";
  const deleted = await db
    .update(savedDays)
    .set({ deletedAt: new Date(now) })
    .where(
      and(
        eq(savedDays.id, savedDayId),
        eq(savedDays.ownerId, ownerId),
        isNull(savedDays.deletedAt),
        eq(savedDays.visibility, SavedDayVisibility.enum.private),
      ),
    )
    .returning({ id: savedDays.id });
  if (deleted.length > 0) return "deleted";

  // Nothing moved. Two reasons are possible and the caller needs to tell them
  // apart, so the row is re-read under the SAME owner scope — a day that is not
  // yours still comes back as no row here, so this second query cannot turn a
  // non-disclosure into a disclosure. Only a day that is genuinely yours, still
  // present, and public can produce "published".
  const rows = await db
    .select({ visibility: savedDays.visibility })
    .from(savedDays)
    .where(
      and(
        eq(savedDays.id, savedDayId),
        eq(savedDays.ownerId, ownerId),
        isNull(savedDays.deletedAt),
      ),
    );
  return rows[0]?.visibility === SavedDayVisibility.enum.public ? "published" : "not-found";
}

/**
 * **The one construction of "materialise a saved sequence into trip days"**
 * (M23 link 3) — N days at the end of the trip, then every stop onto the day it
 * belongs to, as ONE batch.
 *
 * **Exactly one implementation, and that is a gate box rather than a
 * preference.** Three callers need this: adding a Playbook to an existing trip,
 * starting a new trip from one day, and starting a new trip from N days. The
 * milestone answers "does starting a trip reuse the fork path or get its own?"
 * with *neither and both* — one primitive, called three times. The precedent it
 * cites is this repo's own: `citiesOfDay` folds `citiesOfStops` so a profile's
 * cities cannot disagree with Discover's, and `rollupCosts` is read by both
 * `detail.ts` and `conflicts.ts` rather than being summed twice. A second
 * construction of `AddDay` from saved stops is the drift those exist to
 * prevent, and `insertCommands.contract.test.ts` fails if one appears.
 *
 * One batch, not N commands, for the reason `executeTripCommandBatch` exists:
 * it appends under a single batchId, so the whole insert is one history entry
 * and one undo (ADR-005-adjacent). **That property now has to hold over N days,
 * not just over one day's stops** — ADR-029's "half an inserted day is not a
 * state anyone should be able to land in" reads the same for half a sequence,
 * and a three-day Playbook that landed as two days and a bit would be worse.
 *
 * **Every day comes first, then every stop.** A stop cannot be added to a day
 * that does not exist yet, and emitting them interleaved would make the batch's
 * correctness depend on an ordering nobody stated.
 *
 * **The day count is floored by the stops, here as well as at the read
 * boundary.** `parseSavedDayColumns` already guarantees
 * `dayCount >= max(dayIndex) + 1` for anything read from the database, so this
 * is belt and braces — but the alternative is indexing past the end of `dayIds`
 * and silently dropping a day's stops on the floor, which is not a failure mode
 * worth leaving to a caller's discipline.
 *
 * **`dayCount` days, not "as many days as have stops".** A Playbook kept with a
 * blank rest day in the middle or at the end appends that day too, empty —
 * which is the whole reason the count is stored (ADR-048 decision 2) and the
 * only way "a 3 day bundle becomes days 6, 7, 8" can be true of every 3-day
 * bundle.
 *
 * Ids are minted here, fresh per insert, so the same Playbook can go into two
 * trips — or twice into one — without ever putting the same id in two streams
 * (the KI-1 hazard; `cloneTrip` remaps for the same reason).
 */
/**
 * **`onto` merges instead of appending** (ADR-050, Pass B): the sequence's day
 * `k` lands on `onto[k]`, a day the trip already has, and only the days that run
 * past the end of `onto` are minted with `AddDay` — still at the end of the
 * trip, because the domain has no positioned `AddDay` and this does not invent
 * one. The default, `[]`, is "merge onto nothing": every day new, which is the
 * append every existing caller gets.
 */
export function insertCommands(
  saved: SavedDay,
  tripId: string,
  onto: readonly string[] = [],
): BatchableCommand[] {
  const days = sequenceLength(saved);
  const dayIds = Array.from({ length: days }, (_, k) => onto[k] ?? randomUUID());
  return [
    ...dayIds
      .slice(onto.length)
      .map((dayId): BatchableCommand => ({ type: "AddDay", tripId, dayId })),
    ...saved.stops.map(
      (stop): BatchableCommand => ({
        type: "AddActivity",
        tripId,
        activityId: randomUUID(),
        dayId: dayIds[stop.dayIndex]!,
        title: stop.title,
        // The event payloads use explicit null for "unset"; AddActivity uses
        // .optional() for the same fields, so null must become undefined
        // before it will pass validation (same normalization cloneTrip does).
        timeWindow: stop.timeWindow ?? undefined,
        location: stop.location ?? undefined,
        notes: stop.notes ?? undefined,
        anchors: stop.anchors,
        kind: stop.kind,
        tags: stop.tags,
        cost: stop.cost ?? undefined,
        mode: stop.mode ?? undefined,
        endLocation: stop.endLocation ?? undefined,
        pendingReason: stop.pendingReason ?? undefined,
      }),
    ),
  ];
}

/** How many days a sequence occupies: its `dayCount`, floored by its stops. */
function sequenceLength(saved: SavedDay): number {
  return Math.max(
    saved.dayCount,
    saved.stops.reduce((max, s) => (s.dayIndex + 1 > max ? s.dayIndex + 1 : max), 1),
  );
}

/**
 * What a `v1` apply may ask of an insert beyond "append it" (ADR-050, Pass B).
 * Every field is optional and the app's internal route passes none of them.
 */
export interface InsertOptions {
  readonly now?: string;
  /** Refuse unless the Playbook is still at this `version`. */
  readonly version?: number;
  /** Merge onto the trip's days from this one on, rather than appending. */
  readonly startingAt?: string;
  /** Refuse unless the trip's stream still stands at this seq — checked by the batch itself. */
  readonly expectedSeq?: number;
}

/** A refusal only an insert with `InsertOptions` can produce. */
export type InsertRefusal =
  | { code: "version-mismatch"; message: string; currentVersion: number }
  | { code: "unknown-day"; message: string };

/**
 * Insert a saved day into a trip, and — when the design's rule says it counts —
 * write the adds ledger row in the SAME transaction (M11b link 4).
 *
 * Two things changed here in M11b, both load-bearing:
 *
 * **The day no longer has to be yours.** It is read through
 * `readableSavedDay`, so a day somebody published can be taken into your trip —
 * which is what link 6's "Add to a trip" is, and what makes the counter mean
 * anything. A private day of somebody else's is still "no such day", the same
 * 404 as before.
 *
 * **The ledger row rides the command pipeline's own transaction.** It is
 * written through `executeTripCommandBatch`'s `alsoInSameTransaction` hook
 * rather than after the call returns, because the two writes have to be one
 * fact: an add recorded against a batch that then failed its optimistic-
 * concurrency check would be an add of a day that is not in the trip, and a
 * batch that committed while the ledger write failed would be an add nobody is
 * credited for. `recordAdd` moves the denormalised counter in the same
 * transaction again, so `saved_days.adds` and `count(*)` over the ledger cannot
 * come apart at any point a reader could observe.
 *
 * An uncounted add is SILENT — the insert still succeeds and the response is
 * unchanged. Both of the surviving clauses describe perfectly ordinary things to
 * do (adding the same day twice, reusing your own template); neither is an error
 * to report to the person doing it. What must not happen is the number moving.
 *
 * **A success also carries `minted`** — the ids this insert gave the new days
 * and stops. `POST /v1/trips/:id/playbook-applications` publishes them; the
 * internal route picks its own fields and does not.
 */
export async function insertSavedDay(
  savedDayId: string,
  tripId: string,
  actorId: string,
  options: InsertOptions = {},
): Promise<
  | (Extract<CommandResult, { ok: true }> & { minted: InsertedIds; playbookVersion: number })
  | Extract<CommandResult, { ok: false }>
  | { ok: false; error: AccessError | InsertRefusal }
> {
  const now = options.now ?? new Date().toISOString();
  const saved = await readableSavedDay(savedDayId, actorId);
  if (saved === null) {
    return { ok: false, error: { code: "not-found", message: "That saved day does not exist." } };
  }
  if (options.version !== undefined && options.version !== saved.version) {
    return {
      ok: false,
      error: {
        code: "version-mismatch",
        message: `This playbook is at version ${saved.version}, not ${options.version}.`,
        currentVersion: saved.version,
      },
    };
  }

  // **Merging needs the trip's days, and they have to be the days the batch
  // decides against.** So they are read with the stream's head, and the batch
  // is pinned to that head: a day added or removed between this read and the
  // append makes the batch refuse rather than land day `k` somewhere else. A
  // caller's own `expectedSeq` is the stricter pin and wins.
  let onto: string[] = [];
  let expectedSeq = options.expectedSeq;
  if (options.startingAt !== undefined) {
    const envelopes = await readStream(db, tripId);
    // A caller's stale pin is answered first: the day it names may be gone
    // because the trip moved, and "unknown day" would hide that it did.
    if (options.expectedSeq !== undefined && options.expectedSeq !== envelopes.length) {
      return {
        ok: false,
        error: {
          code: "concurrency-conflict",
          message: `This trip has changed since revision ${options.expectedSeq}; it is at ${envelopes.length}. Re-read it and retry.`,
          currentSeq: envelopes.length,
        },
      };
    }
    const days = foldEnvelopes(envelopes)?.days ?? [];
    const at = days.findIndex((d) => d.dayId === options.startingAt);
    if (at === -1) {
      return { ok: false, error: { code: "unknown-day", message: "That day is not in this trip." } };
    }
    onto = days.slice(at).map((d) => d.dayId);
    expectedSeq ??= envelopes.length;
  }

  const commands = insertCommands(saved, tripId, onto);
  const result = await executeTripCommandBatch(
    commands,
    actorId,
    async (tx) => {
      if (!addCounts({ authorId: saved.ownerId, actorId })) return;
      await recordAdd(tx, {
        savedDayId: saved.savedDayId,
        tripId,
        addedBy: actorId,
        createdAt: new Date(now),
      });
    },
    { expectedSeq },
  );
  if (!result.ok) return result;
  // Read back out of the batch rather than minted a second time, so these are
  // by construction the ids that landed. `insertCommands` emits every AddDay
  // in sequence order and then one AddActivity per stop in `stops[]` order.
  const createdDayIds = commands.flatMap((c) => (c.type === "AddDay" ? [c.dayId] : []));
  return {
    ...result,
    playbookVersion: saved.version,
    minted: {
      dayIds: [...onto, ...createdDayIds].slice(0, sequenceLength(saved)),
      createdDayIds,
      activityIds: commands.flatMap((c) => (c.type === "AddActivity" ? [c.activityId] : [])),
    },
  };
}

/**
 * The ids an insert minted — `dayIds` in the saved sequence's day order,
 * `activityIds` in the order of its `stops[]`. Positional because a `SavedStop`
 * has no id of its own to key a map by (ADR-050).
 *
 * `dayIds` is where each day LANDED, so on a merge it names days the trip
 * already had; `createdDayIds` is only the new ones. On an append they are the
 * same list.
 */
export interface InsertedIds {
  readonly dayIds: string[];
  readonly createdDayIds: string[];
  readonly activityIds: string[];
}
