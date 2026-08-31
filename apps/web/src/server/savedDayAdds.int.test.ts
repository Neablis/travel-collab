import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";

import { backfillSavedDayCities } from "../../scripts/backfill-saved-day-cities.mjs";
import { executeTripCommand } from "./commands";
import { getTripDetail } from "./projections";
import { db } from "./db/client";
import { savedDayAdds, savedDays } from "./db/schema";
import { getSavedDay, listSavedDays, saveDay } from "./savedDays";

// Fresh identities per TEST (KI-69) — these tests read rows back by owner and
// by id, and a sibling process writing `saved_days` must not be able to change
// what they see.
let OWNER = "";

beforeEach(() => {
  OWNER = `adds-owner-${randomUUID().slice(0, 8)}`;
});

function ledgerRow(overrides: Partial<typeof savedDayAdds.$inferInsert> = {}) {
  return {
    savedDayId: randomUUID(),
    tripId: randomUUID(),
    addedBy: OWNER,
    createdAt: new Date("2026-08-30T00:00:00.000Z"),
    ...overrides,
  };
}

/** Postgres's unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

describe("the adds ledger's (day, trip) key", () => {
  // The rule is *an add only counts once per trip*. This asserts it is true by
  // CONSTRUCTION — enforced by the database — rather than by an application
  // read-then-write that a later caller could forget or lose a race with. A
  // type cannot make this claim; only the table can.
  it("refuses a second row for the same day and trip", async () => {
    const row = ledgerRow();
    await db.insert(savedDayAdds).values(row);

    // Caught rather than `.rejects.toThrow()`: any thrown error satisfies that,
    // including a connection failure, and the whole point is WHICH error.
    // Drizzle wraps the driver error, so the SQLSTATE is on `cause`; the
    // constraint name is asserted too, so this cannot pass on some other unique
    // index happening to fire.
    let cause: { code?: string; constraint?: string } | undefined;
    try {
      await db.insert(savedDayAdds).values({ ...row, addedBy: "someone-else" });
    } catch (error) {
      cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
    }
    expect(cause?.code).toBe(UNIQUE_VIOLATION);
    expect(cause?.constraint).toBe("saved_day_adds_saved_day_id_trip_id_pk");

    const stored = await db
      .select()
      .from(savedDayAdds)
      .where(and(eq(savedDayAdds.savedDayId, row.savedDayId), eq(savedDayAdds.tripId, row.tripId)));
    expect(stored).toHaveLength(1);
    // The loser did not overwrite the winner: the first add is the one on
    // record, which is what makes "who took this day, and when" answerable.
    expect(stored[0]!.addedBy).toBe(OWNER);
  });

  // The other half of "once per TRIP" — the constraint has to be narrow enough
  // that taking the same day into a second trip still counts. A unique index on
  // `saved_day_id` alone would pass the test above and break the product.
  it("allows the same day in a different trip", async () => {
    const row = ledgerRow();
    await db.insert(savedDayAdds).values(row);
    await db.insert(savedDayAdds).values({ ...row, tripId: randomUUID() });

    const stored = await db
      .select()
      .from(savedDayAdds)
      .where(eq(savedDayAdds.savedDayId, row.savedDayId));
    expect(stored).toHaveLength(2);
  });

  it("allows a different day in the same trip", async () => {
    const row = ledgerRow();
    await db.insert(savedDayAdds).values(row);
    await db.insert(savedDayAdds).values({ ...row, savedDayId: randomUUID() });

    const stored = await db.select().from(savedDayAdds).where(eq(savedDayAdds.tripId, row.tripId));
    expect(stored).toHaveLength(2);
  });
});

async function tripWithCities(): Promise<{ tripId: string; dayId: string }> {
  const tripId = randomUUID();
  const dayId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Kansai" }, OWNER);
  await executeTripCommand({ type: "AddDay", tripId, dayId }, OWNER);
  // Stored Kyoto-first, scheduled Osaka-first, and Kyoto twice — so the stored
  // `cities` can only be right if it came from the real rule (time order,
  // duplicates collapsed) rather than from a map over the stop list.
  for (const [title, start, end, city] of [
    ["Kiyomizu-dera", "18:00", "19:00", "Kyoto"],
    ["Dotonbori", "12:00", "13:00", "Osaka"],
    ["Nishiki Market", "09:00", "10:00", "Kyoto"],
  ] as const) {
    await executeTripCommand(
      {
        type: "AddActivity",
        tripId,
        activityId: randomUUID(),
        dayId,
        title,
        timeWindow: { start, end },
        location: { name: title, city },
      },
      OWNER,
    );
  }
  return { tripId, dayId };
}

describe("saveDay's new columns", () => {
  // Every assertion in this block reads the row BACK out of Postgres rather
  // than trusting `saveDay`'s return value. `toDto` builds that value from the
  // same in-memory object the insert was built from, so asserting on it would
  // pass even if the column were dropped from the insert or renamed — while
  // the test title still claimed persistence. Caught in review on pull request 100.
  async function storedRow(savedDayId: string) {
    const [row] = await db.select().from(savedDays).where(eq(savedDays.id, savedDayId));
    return row;
  }

  it("stores the cities the domain's rule derives, in time order", async () => {
    const { tripId, dayId } = await tripWithCities();
    const detail = await getTripDetail(tripId);
    const saved = await saveDay({ name: "A Kansai day", dayId }, detail!, OWNER);

    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.cities).toEqual(["Kyoto", "Osaka"]);

    const stored = await storedRow(saved.value.savedDayId);
    expect(stored?.cities).toEqual(["Kyoto", "Osaka"]);
  });

  // ADR-029's decision 3 says a saved day is private; M11b link 3 keeps that as
  // the DEFAULT rather than as the only option. A day that arrived public
  // because a writer forgot the field is the failure this asserts against.
  it("saves a day private, with nobody having added it", async () => {
    const { tripId, dayId } = await tripWithCities();
    const detail = await getTripDetail(tripId);
    const saved = await saveDay({ name: "A Kansai day", dayId }, detail!, OWNER);

    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.visibility).toBe("private");
    expect(saved.value.adds).toBe(0);

    const stored = await storedRow(saved.value.savedDayId);
    expect(stored?.visibility).toBe("private");
    expect(stored?.adds).toBe(0);
  });
});

describe("the 0012 cities backfill", () => {
  /** A row as 0011 would have left it: real stops, and the column's default. */
  async function rowSavedBeforeTheColumnExisted(): Promise<string> {
    const id = randomUUID();
    await db.insert(savedDays).values({
      id,
      ownerId: OWNER,
      name: "Saved before 0012",
      stops: [
        {
          title: "Kiyomizu-dera",
          timeWindow: { start: "18:00", end: "19:00" },
          location: { name: "Kiyomizu-dera", city: "Kyoto" },
          notes: null,
          anchors: [],
          kind: "planned",
          tags: [],
          cost: null,
        },
        {
          title: "Dotonbori",
          timeWindow: { start: "12:00", end: "13:00" },
          location: { name: "Dotonbori", city: "Osaka" },
          notes: null,
          anchors: [],
          kind: "planned",
          tags: [],
          cost: null,
        },
      ],
      cities: [],
      sourceTripId: randomUUID(),
      sourceTripName: "Kansai",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    return id;
  }

  const citiesOf = async (id: string) =>
    (await db.select().from(savedDays).where(eq(savedDays.id, id)))[0]?.cities;

  it("fills a row written before the column existed", async () => {
    const id = await rowSavedBeforeTheColumnExisted();
    const result = await backfillSavedDayCities(db);

    expect(result.updated).toBeGreaterThan(0);
    // Time order, not stored order — the same rule `saveDay` writes with, which
    // is the property that makes running this once safe rather than a second
    // opinion about what a day's cities are.
    expect(await citiesOf(id)).toEqual(["Osaka", "Kyoto"]);
  });

  it("is safe to run twice", async () => {
    const id = await rowSavedBeforeTheColumnExisted();
    await backfillSavedDayCities(db);
    const afterFirst = await citiesOf(id);
    await backfillSavedDayCities(db);

    // Asserted on THIS row rather than on the second run's `updated` count: the
    // backfill scans the whole table, so another test — or a concurrent e2e
    // run against the same database — can legitimately give it work to do.
    expect(await citiesOf(id)).toEqual(afterFirst);
    expect(afterFirst).toEqual(["Osaka", "Kyoto"]);
  });

  it("leaves a row whose stops are not an array alone, and names it", async () => {
    const id = randomUUID();
    await db.insert(savedDays).values({
      id,
      ownerId: OWNER,
      // `$type` is a compile-time cast, so the bytes can be anything (KI-71).
      stops: { not: "an array" } as never,
      name: "Corrupt",
      cities: [],
      sourceTripId: randomUUID(),
      sourceTripName: "Kansai",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    const result = await backfillSavedDayCities(db);

    // Reported, not guessed at: writing `[]` here would be indistinguishable
    // from a day that genuinely visits nowhere.
    expect(result.unreadable).toContain(id);
    expect(await citiesOf(id)).toEqual([]);

    // The one test here that cleans up after itself. Every other row it leaves
    // behind is inert, but this one makes `pnpm --filter web db:backfill-cities`
    // exit non-zero for anyone who runs it on a machine that has run the
    // integration suite — a real failure signal, spent on a fixture.
    await db.delete(savedDays).where(eq(savedDays.id, id));
  });
});

// A `text` column with a `$type<SavedDayVisibility>()` cast is typed at compile
// time and unconstrained at runtime, so the only thing standing between a bad
// stored value and a typed contract value is `fromRow`'s parse. Written with
// raw SQL because every write path in the app goes through the enum — the row
// this guards against is one the app cannot currently create, which is exactly
// why a test has to make one.
describe("a saved day whose stored visibility is not a visibility", () => {
  it("is dropped on read rather than handed out as a typed value", async () => {
    const { tripId, dayId } = await tripWithCities();
    const detail = await getTripDetail(tripId);
    const saved = await saveDay({ name: "A Kansai day", dayId }, detail!, OWNER);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const id = saved.value.savedDayId;

    // Readable while the stored value is legitimate — so the assertion below
    // is about the corruption, not about the row being unreachable anyway.
    expect(await getSavedDay(id, OWNER)).not.toBeNull();

    await db.execute(sql`update saved_days set visibility = 'everyone' where id = ${id}`);

    expect(await getSavedDay(id, OWNER)).toBeNull();
    expect((await listSavedDays(OWNER)).map((d) => d.savedDayId)).not.toContain(id);

    await db.delete(savedDays).where(eq(savedDays.id, id));
  });
});
