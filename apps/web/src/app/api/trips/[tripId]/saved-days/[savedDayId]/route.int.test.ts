import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeTripCommand } from "@/server/commands";
import { db } from "@/server/db/client";
import { savedDayAdds, savedDays } from "@/server/db/schema";
import { insertSavedDay } from "@/server/savedDays";

// The adds ledger (M11b link 4). The design's rule, verbatim: *an add only
// counts once per trip, and only after the trip has dates; copying your own day
// into your own trip does not count.*
//
// **Every assertion below is against the LEDGER**, which is the exit gate's own
// wording, and it is not a formality: the counter is what a build that got this
// wrong would still get right by accident (increment once, forget the row), and
// the ledger is the thing the leaderboard is supposed to rank on. The counter is
// checked too, but as the *derived* number — `adds` is asserted to equal
// `count(*)` over the ledger rather than to equal a literal.
//
// Per-run ids (KI-57): nothing truncates between runs.
const RUN = randomUUID();
const AUTHOR = `adds-author-${RUN}`;
const TAKER = `adds-taker-${RUN}`;

let currentUserId = AUTHOR;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { POST: INSERT } = await import("./route");
const { POST: SAVE } = await import("../../../../saved-days/route");
const { POST: PUBLISH } = await import("../../../../saved-days/[savedDayId]/publish/route");

/** A trip with dates, owned by whoever is signed in. */
async function datedTrip(): Promise<string> {
  const tripId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Target" }, currentUserId);
  const result = await executeTripCommand(
    {
      type: "SetTripDates",
      tripId,
      startDate: "2027-04-01",
      endDate: "2027-04-02",
      newDayIds: [randomUUID(), randomUUID()],
    },
    currentUserId,
  );
  if (!result.ok) throw new Error(`could not date the trip: ${result.error.message}`);
  return tripId;
}

/** A trip with no dates — the wishlist state the rule refuses to count. */
async function undatedTrip(): Promise<string> {
  const tripId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Someday" }, currentUserId);
  return tripId;
}

/** A published saved day belonging to AUTHOR. */
async function publishedDay(): Promise<string> {
  const was = currentUserId;
  currentUserId = AUTHOR;
  const tripId = randomUUID();
  const dayId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Source" }, AUTHOR);
  await executeTripCommand({ type: "AddDay", tripId, dayId }, AUTHOR);
  await executeTripCommand(
    {
      type: "AddActivity",
      tripId,
      activityId: randomUUID(),
      dayId,
      title: "Nishiki Market",
      location: { name: "Nishiki Market", city: "Kyoto" },
    },
    AUTHOR,
  );
  const saved = await SAVE(
    new Request("http://test/x", {
      method: "POST",
      body: JSON.stringify({ name: "Kyoto, on foot", tripId, dayId }),
    }),
  );
  expect(saved.status).toBe(201);
  const savedDayId = ((await saved.json()) as { savedDay: { savedDayId: string } }).savedDay
    .savedDayId;
  const published = await PUBLISH(new Request("http://test/x", { method: "POST" }), {
    params: Promise.resolve({ savedDayId }),
  });
  expect(published.status).toBe(200);
  currentUserId = was;
  return savedDayId;
}

const insert = (tripId: string, savedDayId: string) =>
  INSERT(new Request("http://test/x", { method: "POST" }), {
    params: Promise.resolve({ tripId, savedDayId }),
  });

/** The ledger itself — one row per (day, trip). */
async function ledgerRows(savedDayId: string) {
  return db.select().from(savedDayAdds).where(eq(savedDayAdds.savedDayId, savedDayId));
}

async function counter(savedDayId: string): Promise<number> {
  const rows = await db
    .select({ adds: savedDays.adds })
    .from(savedDays)
    .where(eq(savedDays.id, savedDayId));
  return rows[0]!.adds;
}

/**
 * The invariant the denormalised counter exists under: it is `count(*)` over
 * the ledger, and nothing else may move it. Asserted after every case below
 * rather than in one test of its own — a counter that agrees on the happy path
 * and drifts on a refusal is exactly the failure this pairing is for.
 */
async function expectCounterMatchesLedger(savedDayId: string): Promise<number> {
  const rows = await ledgerRows(savedDayId);
  expect(await counter(savedDayId)).toBe(rows.length);
  return rows.length;
}

beforeEach(() => {
  currentUserId = AUTHOR;
});

describe("an add that counts", () => {
  it("writes one ledger row when somebody else takes a published day into a dated trip", async () => {
    const savedDayId = await publishedDay();
    currentUserId = TAKER;
    const tripId = await datedTrip();

    expect((await insert(tripId, savedDayId)).status).toBe(200);

    const rows = await ledgerRows(savedDayId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tripId).toBe(tripId);
    expect(rows[0]!.addedBy).toBe(TAKER);
    expect(await expectCounterMatchesLedger(savedDayId)).toBe(1);
  });

  it("counts twice when the same day goes into two different dated trips", async () => {
    const savedDayId = await publishedDay();
    currentUserId = TAKER;
    const first = await datedTrip();
    const second = await datedTrip();

    expect((await insert(first, savedDayId)).status).toBe(200);
    expect((await insert(second, savedDayId)).status).toBe(200);

    expect(await expectCounterMatchesLedger(savedDayId)).toBe(2);
  });
});

// The three negative cases the exit gate names, each proven against the ledger.
describe("an add that does not count", () => {
  it("counts the same day added twice to ONE trip only once", async () => {
    const savedDayId = await publishedDay();
    currentUserId = TAKER;
    const tripId = await datedTrip();

    expect((await insert(tripId, savedDayId)).status).toBe(200);
    // The second insert still succeeds — putting a day into a trip twice is a
    // perfectly reasonable thing to do, and the rule is about the NUMBER, not
    // about refusing the person.
    expect((await insert(tripId, savedDayId)).status).toBe(200);

    const rows = await ledgerRows(savedDayId);
    expect(rows).toHaveLength(1);
    expect(await expectCounterMatchesLedger(savedDayId)).toBe(1);
  });

  it("does not count an add to a trip with no dates", async () => {
    const savedDayId = await publishedDay();
    currentUserId = TAKER;
    const tripId = await undatedTrip();

    expect((await insert(tripId, savedDayId)).status).toBe(200);

    expect(await ledgerRows(savedDayId)).toHaveLength(0);
    expect(await expectCounterMatchesLedger(savedDayId)).toBe(0);
  });

  it("does not count the author adding their own day to their own trip", async () => {
    const savedDayId = await publishedDay();
    // currentUserId is AUTHOR — their own day, their own dated trip.
    const tripId = await datedTrip();

    expect((await insert(tripId, savedDayId)).status).toBe(200);

    expect(await ledgerRows(savedDayId)).toHaveLength(0);
    expect(await expectCounterMatchesLedger(savedDayId)).toBe(0);
  });

  // The undated trip is a *deferral*, not a permanent refusal in disguise: the
  // same day into the same trip counts as soon as the trip has dates... except
  // that it does not, and that is worth pinning rather than discovering. The
  // composite primary key has no notion of "the earlier one did not count", so
  // a day added while a trip was undated is never credited later.
  it("still does not count after the trip is dated, because the insert was the only chance", async () => {
    const savedDayId = await publishedDay();
    currentUserId = TAKER;
    const tripId = await undatedTrip();
    await insert(tripId, savedDayId);

    await executeTripCommand(
      {
        type: "SetTripDates",
        tripId,
        startDate: "2027-04-01",
        endDate: "2027-04-02",
        newDayIds: [randomUUID(), randomUUID()],
      },
      TAKER,
    );

    expect(await ledgerRows(savedDayId)).toHaveLength(0);
    expect(await expectCounterMatchesLedger(savedDayId)).toBe(0);
  });
});

describe("what a taker may reach for", () => {
  it("lets somebody else insert a PUBLISHED day", async () => {
    const savedDayId = await publishedDay();
    currentUserId = TAKER;
    const tripId = await datedTrip();
    const res = await insert(tripId, savedDayId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { detail: { days: unknown[] } };
    // Two dated days plus the inserted one.
    expect(body.detail.days).toHaveLength(3);
  });

  it("404s somebody else's PRIVATE day, and writes no ledger row", async () => {
    const savedDayId = await publishedDay();
    // Back to private.
    const { DELETE: UNPUBLISH } = await import("../../../../saved-days/[savedDayId]/publish/route");
    expect(
      (
        await UNPUBLISH(new Request("http://test/x", { method: "DELETE" }), {
          params: Promise.resolve({ savedDayId }),
        })
      ).status,
    ).toBe(200);

    currentUserId = TAKER;
    const tripId = await datedTrip();
    expect((await insert(tripId, savedDayId)).status).toBe(404);
    expect(await ledgerRows(savedDayId)).toHaveLength(0);
  });
});

// The ledger row and the trip write are one fact, which is why the ledger write
// rides `executeTripCommandBatch`'s own transaction rather than following the
// call. What is observable from outside is the half of that claim that matters:
// no refused insert may leave an add behind. (The other half — a committed
// batch whose ledger write threw takes the batch down with it — is by
// construction, since both statements are in the one transaction and there is
// no seam to make `recordAdd` fail on demand without mocking the thing under
// test.)
describe("the ledger and the insert are one fact", () => {
  it("writes no ledger row when the route refuses the trip", async () => {
    const savedDayId = await publishedDay();
    const strangersTrip = await (async () => {
      const was = currentUserId;
      currentUserId = `outsider-${RUN}`;
      const tripId = await datedTrip();
      currentUserId = was;
      return tripId;
    })();

    currentUserId = TAKER;
    expect((await insert(strangersTrip, savedDayId)).status).toBe(403);

    expect(
      await db
        .select()
        .from(savedDayAdds)
        .where(and(eq(savedDayAdds.savedDayId, savedDayId), eq(savedDayAdds.tripId, strangersTrip))),
    ).toHaveLength(0);
    expect(await expectCounterMatchesLedger(savedDayId)).toBe(0);
  });

  // Past the route's access check and into the pipeline, which is where the
  // hook lives: a batch the domain rejects must not have credited an add.
  // Driven through the server function directly, because the route's own
  // 404 for an unknown trip would stop short of the transaction.
  it("writes no ledger row when the command batch itself is rejected", async () => {
    const savedDayId = await publishedDay();
    const noSuchTrip = randomUUID();

    const result = await insertSavedDay(savedDayId, noSuchTrip, TAKER);
    expect(result.ok).toBe(false);

    expect(await ledgerRows(savedDayId)).toHaveLength(0);
    expect(await expectCounterMatchesLedger(savedDayId)).toBe(0);
  });
});
