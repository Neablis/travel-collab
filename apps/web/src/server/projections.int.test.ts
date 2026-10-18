import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { executeTripCommand } from "./commands";
import { getTripDetail, listTripSummaries, listTripSummariesPage, listTripSummariesVisibleTo, rebuildProjections } from "./projections";
import { db } from "./db/client";
import { events, tripDetails, tripMemberships, tripSummaries } from "./db/schema";

// Per run rather than the fixed "u1" (KI-69), so this file's events cannot be
// confused with another suite's or a developer's own.
const actor = `u1-${randomUUID().slice(0, 8)}`;

// The beforeEach that deleted every row of trip_details, trip_summaries and
// events is gone (KI-69). The three `listTripSummaries()` reads below already
// filter by this test's tripId; the rebuild comparison is now scoped to it too.
describe("trip_summaries tracks lifecycle events", () => {

  it("tracks rename, delete, and restore, and rebuild reproduces them", async () => {
    const tripId = crypto.randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Old" }, actor);
    await executeTripCommand({ type: "SetTripName", tripId, name: "New" }, actor);

    let rows = await listTripSummaries();
    expect(rows.find((r) => r.tripId === tripId)!.name).toBe("New");

    await executeTripCommand({ type: "DeleteTrip", tripId }, actor);
    rows = await listTripSummaries();
    expect(rows.find((r) => r.tripId === tripId)).toBeUndefined();

    await executeTripCommand({ type: "RestoreTrip", tripId }, actor);
    rows = await listTripSummaries();
    expect(rows.find((r) => r.tripId === tripId)!.status).toBe("active");

    // The golden guarantee: projections are disposable (Invariant 2).
    //
    // Scoped to this trip's row (KI-69). Unscoped, this compared every row in
    // trip_summaries before and after — and with neither select carrying an
    // `orderBy`, more than one row made the comparison order-dependent on the
    // heap, since `rebuildProjections` deletes and re-inserts. It passed only
    // because the truncation guaranteed exactly one row existed.
    //
    // The length assertion is what keeps this honest: a filtered comparison of
    // two empty arrays would pass while proving nothing.
    const where = eq(tripSummaries.tripId, tripId);
    const before = await db.select().from(tripSummaries).where(where);
    expect(before).toHaveLength(1);
    await rebuildProjections();
    const after = await db.select().from(tripSummaries).where(where);
    expect(after).toEqual(before);
  });
});

/**
 * KI-034. Home's hero is "the next trip", and it could only be chosen by date
 * once the list carried one. Two halves: the summary follows the start date
 * through every event that moves it (and a rebuild agrees), and the list comes
 * back in one stated order rather than whatever the heap held.
 */
describe("trip summaries carry the start date, in a stated order", () => {
  it("follows the start date, rebuilds it, and lists newest-created first", async () => {
    // Its own member, so the list below holds exactly these two trips.
    const member = `ki034-${randomUUID().slice(0, 8)}`;
    const older = randomUUID();
    const newer = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId: older, name: "Older" }, member);
    await executeTripCommand({ type: "CreateTrip", tripId: newer, name: "Newer draft" }, member);
    await executeTripCommand(
      {
        type: "SetTripDates",
        tripId: older,
        startDate: "2099-03-01",
        endDate: "2099-03-02",
        newDayIds: [randomUUID(), randomUUID()],
      },
      member,
    );
    // Touched LAST on purpose: an UPDATE writes a new tuple at the heap's end,
    // so without an ORDER BY the rows would now come back Older, Newer — the
    // heap order this test exists to rule out.
    await executeTripCommand({ type: "SetTripName", tripId: newer, name: "Newer" }, member);

    const listed = await listTripSummariesVisibleTo(member);
    expect(listed.map((r) => [r.name, r.startDate, r.endDate])).toEqual([
      ["Newer", null, null],
      // KI-2026-09-24-e: the end is the document's last day.
      ["Older", "2099-03-01", "2099-03-02"],
    ]);

    await executeTripCommand({ type: "SetTripStartDate", tripId: older, startDate: "2099-04-01" }, member);
    const where = eq(tripSummaries.tripId, older);
    const before = await db.select().from(tripSummaries).where(where);
    expect(before.map((r) => r.startDate)).toEqual(["2099-04-01"]);
    // The end moves with the start, in both queries that list trips.
    const paged = await listTripSummariesPage(member, { limit: 10, after: null });
    expect(paged.map((r) => [r.name, r.endDate])).toEqual([
      ["Newer", null],
      ["Older", "2099-04-02"],
    ]);
    await rebuildProjections();
    expect(await db.select().from(tripSummaries).where(where)).toEqual(before);

    await executeTripCommand({ type: "SetTripStartDate", tripId: older, startDate: null }, member);
    expect((await db.select().from(tripSummaries).where(where))[0]!.startDate).toBeNull();
  });
});

/**
 * The visibility predicate, case by case, through both listing queries. It is
 * a UNION of two sources now (the log's member list and `trip_memberships`),
 * so each leg has to be seen to count, and the outer filter and order to still
 * apply to rows that arrive from either. `/api/trips`' route test covers the
 * sources one trip at a time; this one puts them in a single list, where a
 * dropped leg, a lost `status` filter or an order applied per leg shows.
 */
describe("both listing queries see the caller's trips from either source, newest first", () => {
  it("lists log-member and membership-row trips once each, never a stranger's or a deleted one", async () => {
    const reader = `vis-${randomUUID().slice(0, 8)}`;
    const other = `vis-other-${randomUUID().slice(0, 8)}`;
    const [ownOld, shared, both, ownNew, strangers, deleted] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    // Created in this order, so newest-first is the reverse; the log's own
    // timestamps decide it, and the expectation is computed from them below.
    await executeTripCommand({ type: "CreateTrip", tripId: ownOld, name: "Own, older" }, reader);
    await executeTripCommand({ type: "CreateTrip", tripId: shared, name: "Shared" }, other);
    await executeTripCommand({ type: "CreateTrip", tripId: both, name: "Both" }, reader);
    await executeTripCommand({ type: "CreateTrip", tripId: strangers, name: "Not mine" }, other);
    await executeTripCommand({ type: "CreateTrip", tripId: deleted, name: "Gone" }, reader);
    await executeTripCommand({ type: "CreateTrip", tripId: ownNew, name: "Own, newer" }, reader);
    expect((await executeTripCommand({ type: "DeleteTrip", tripId: deleted }, reader)).ok).toBe(true);
    // Rows written directly: the predicate reads only the row, and how an
    // invite becomes one is the Access module's test. `both` names the reader
    // in the log AND in a row, which must list it once, not twice.
    const createdAt = new Date().toISOString();
    await db.insert(tripMemberships).values([
      { tripId: shared, userId: reader, role: "editor", invitedBy: other, createdAt },
      { tripId: both, userId: reader, role: "editor", invitedBy: reader, createdAt },
    ]);

    const visible = [ownOld, shared, both, ownNew];
    const stamped = await db
      .select({ tripId: tripSummaries.tripId, createdAt: tripSummaries.createdAt })
      .from(tripSummaries)
      .where(inArray(tripSummaries.tripId, visible));
    // The stated order, `created_at desc, trip_id desc`, worked out here
    // rather than assumed from creation order: two commands can land in the
    // same millisecond, and then `trip_id` decides.
    const expected = stamped
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.tripId < b.tripId ? 1 : -1))
      .map((r) => r.tripId);
    expect(expected).toHaveLength(4);

    const ids = (rows: { tripId: string }[]) => rows.map((r) => r.tripId);
    expect(ids(await listTripSummariesVisibleTo(reader))).toEqual(expected);
    expect(ids(await listTripSummariesPage(reader, { limit: 10, after: null }))).toEqual(expected);
  });
});

/**
 * M37 D5: the card reads a trip's length and whether it has a plan from the
 * list itself, never from a per-card detail read. Both counts come off the
 * document in the listing query, so both listing queries are asserted.
 */
describe("trip summaries carry the day, stop and idea counts", () => {
  it("counts days, the stops on them, and the backlog apart, in both listing queries", async () => {
    const member = `m37-${randomUUID().slice(0, 8)}`;
    const planned = randomUUID();
    const empty = randomUUID();
    const [day1, day2] = [randomUUID(), randomUUID()];
    await executeTripCommand({ type: "CreateTrip", tripId: planned, name: "Planned" }, member);
    await executeTripCommand(
      { type: "SetTripDates", tripId: planned, startDate: "2099-05-01", endDate: "2099-05-02", newDayIds: [day1, day2] },
      member,
    );
    for (const dayId of [day1, day1, day2, undefined, undefined]) {
      await executeTripCommand(
        { type: "AddActivity", tripId: planned, activityId: randomUUID(), dayId, title: "Stop" },
        member,
      );
    }
    // Created last, so it heads both newest-first lists.
    await executeTripCommand({ type: "CreateTrip", tripId: empty, name: "Empty" }, member);

    const counts = (rows: { name: string; dayCount: number; stopCount: number; ideaCount: number }[]) =>
      rows.map((r) => [r.name, r.dayCount, r.stopCount, r.ideaCount]);
    // Three stops on two days; the other two activities are in the backlog.
    const expected = [
      ["Empty", 0, 0, 0],
      ["Planned", 2, 3, 2],
    ];
    expect(counts(await listTripSummariesVisibleTo(member))).toEqual(expected);
    expect(counts(await listTripSummariesPage(member, { limit: 10, after: null }))).toEqual(expected);

    // A `days` or `backlog` that is not an array — only a corrupt or past
    // server could write one — counts as nothing rather than failing every
    // trip on the list.
    await db
      .update(tripDetails)
      .set({ doc: sql`jsonb_set(jsonb_set(${tripDetails.doc}, '{days}', '{}'::jsonb), '{backlog}', '{}'::jsonb)` })
      .where(eq(tripDetails.tripId, planned));
    expect(counts(await listTripSummariesVisibleTo(member))).toEqual([
      ["Empty", 0, 0, 0],
      ["Planned", 0, 0, 0],
    ]);
  });
});

/**
 * M42 D8: a card says what kind of trip it is, worked out from the stops in
 * the listing query and stored nowhere. Every activity, the backlog's too.
 */
describe("trip summaries carry a description of the trip", () => {
  it("describes the trip from all its activities in both listing queries, and survives a malformed stop", async () => {
    const member = `m42-${randomUUID().slice(0, 8)}`;
    const tripId = randomUUID();
    const day = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Coast" }, member);
    await executeTripCommand(
      { type: "SetTripDates", tripId, startDate: "2099-06-01", endDate: "2099-06-01", newDayIds: [day] },
      member,
    );
    const add = (tags: ("beach" | "outdoors" | "museum")[], dayId?: string) =>
      executeTripCommand({ type: "AddActivity", tripId, activityId: randomUUID(), dayId, title: "Stop", tags }, member);
    for (const tags of [["beach"], ["beach"], ["beach"], ["beach", "outdoors"], ["outdoors"]] as const) await add([...tags], day);
    // The backlog counts: alone, the days would read "Beach & outdoors".
    for (let i = 0; i < 6; i++) await add(["museum"]);

    const described = (rows: { name: string; description: string | null }[]) => rows.map((r) => [r.name, r.description]);
    expect(described(await listTripSummariesVisibleTo(member))).toEqual([["Coast", "Museums & beach"]]);
    expect(described(await listTripSummariesPage(member, { limit: 10, after: null }))).toEqual([["Coast", "Museums & beach"]]);

    // A stop whose tags are not an array reads as untagged, and the rest of the
    // trip is still described, rather than failing every trip on Home.
    const firstStop = sql`(${tripDetails.doc} #>> '{days,0,activityIds,0}')`;
    await db
      .update(tripDetails)
      .set({ doc: sql`jsonb_set(${tripDetails.doc}, ARRAY['activities', ${firstStop}, 'tags'], '"beach"'::jsonb)` })
      .where(eq(tripDetails.tripId, tripId));
    const [corrupted] = await db
      .select({ tags: sql`${tripDetails.doc} -> 'activities' -> ${firstStop} -> 'tags'` })
      .from(tripDetails)
      .where(eq(tripDetails.tripId, tripId));
    expect(corrupted?.tags).toBe("beach");
    expect(described(await listTripSummariesVisibleTo(member))).toEqual([["Coast", "Museums & beach"]]);
  });
});

/**
 * KI-2026-09-05-r. `trip_details.doc` is `jsonb(...).$type<TripDetail>()` — a
 * Drizzle CAST, checked by nothing at runtime — and `getTripDetail` handed that
 * column straight back under a `Promise<TripDetail | null>` signature. Every
 * caller inherited a claim no code had verified; `requireTripAccess` was the
 * one that re-parsed downstream (KI-74) and the other six did not.
 *
 * These two tests are the two halves of the claim, asserted against
 * `getTripDetail` itself rather than a route, because the source is where the
 * lie was.
 */
describe("getTripDetail parses the stored document", () => {
  async function seedDay(): Promise<string> {
    const tripId = randomUUID();
    const dayId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Parsed" }, actor);
    await executeTripCommand({ type: "AddDay", tripId, dayId }, actor);
    await executeTripCommand(
      { type: "AddActivity", tripId, activityId: randomUUID(), dayId, title: "Ramen" },
      actor,
    );
    return tripId;
  }

  /** Overwrite a trip's stored doc, the way only a past version of this server could. */
  async function rewriteDoc(
    tripId: string,
    mutate: (doc: Record<string, unknown>) => void,
  ): Promise<void> {
    const rows = await db.select().from(tripDetails).where(eq(tripDetails.tripId, tripId));
    const doc = JSON.parse(JSON.stringify(rows[0]!.doc)) as Record<string, unknown>;
    mutate(doc);
    await db
      .update(tripDetails)
      // The `as` is the cast under test: the column's `$type<TripDetail>()` lets
      // anything at all be stored under that name.
      .set({ doc: doc as unknown as TripDetail })
      .where(eq(tripDetails.tripId, tripId));
  }

  // Rewriting the row is the only faithful way to get a pre-M18 doc: a doc is
  // re-written only when its trip next changes, so the real rows in this shape
  // are the ones nobody has touched since.
  it("supplies the contract's defaults for a doc written before the fields existed", async () => {
    const tripId = await seedDay();
    await rewriteDoc(tripId, (doc) => {
      const activities = doc.activities as Record<string, Record<string, unknown>>;
      for (const activity of Object.values(activities)) {
        delete activity.kind;
        delete activity.tags;
      }
      delete doc.forkedFrom;
    });

    const detail = await getTripDetail(tripId);
    expect(detail).not.toBeNull();
    const activities = Object.values(detail!.activities);
    expect(activities).toHaveLength(1);
    // Returned raw, these three are `undefined` while the signature says
    // otherwise — the defaults exist only inside a parse.
    expect(activities[0]!.kind).toBe("planned");
    expect(activities[0]!.tags).toEqual([]);
    expect(detail!.forkedFrom).toBeNull();
  });

  // M28 (ADR-054): `idea`, `hold` and `booked` are retired, and every trip
  // older than M28 still holds them — in its log and in its stored doc. The
  // contract translates them on read; these two assert it at the two places a
  // real old trip is read from, rather than at the schema alone.
  it("reads a doc stored with a retired kind as its replacement", async () => {
    const tripId = await seedDay();
    await rewriteDoc(tripId, (doc) => {
      const activities = doc.activities as Record<string, Record<string, unknown>>;
      for (const activity of Object.values(activities)) activity.kind = "booked";
    });

    const detail = await getTripDetail(tripId);
    expect(Object.values(detail!.activities).map((a) => a.kind)).toEqual(["planned"]);
  });

  it("rebuilds a trip whose log holds a retired kind, with the kind translated", async () => {
    const tripId = await seedDay();
    // The log is append-only in the product; only a test (standing in for a
    // pre-M28 server) writes an old kind back into a stored payload.
    await db
      .update(events)
      .set({ payload: sql`jsonb_set(${events.payload}, '{kind}', '"hold"')` })
      .where(and(eq(events.streamId, tripId), eq(events.type, "ActivityAdded")));

    await rebuildProjections();
    const detail = await getTripDetail(tripId);
    expect(Object.values(detail!.activities).map((a) => a.kind)).toEqual(["pending"]);
  });

  it("refuses a stored doc that is not a TripDetail, rather than returning it", async () => {
    const tripId = await seedDay();
    // `members` is `.min(1)`: an empty list is a document this server could only
    // have written by being wrong, and no `.default()` can rescue it.
    await rewriteDoc(tripId, (doc) => {
      doc.members = [];
    });

    // Throwing, not `null`: `null` is this function's word for "no such trip",
    // and a trip whose row is broken is not a trip that does not exist.
    await expect(getTripDetail(tripId)).rejects.toThrow();
  });
});
