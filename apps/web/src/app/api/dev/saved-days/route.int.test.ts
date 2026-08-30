import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JAPAN_SAVED_DAYS } from "@tc/fixtures";
import { db } from "@/server/db/client";
import { savedDayAdds, savedDays } from "@/server/db/schema";

// The cities each fixture day covers, read off its stops by hand. The seeder
// derives these through the domain's rule; this table is the independent
// answer that makes the comparison mean something.
const EXPECTED_CITIES: Record<string, string[]> = {
  "Kyoto temples on foot": ["Kyoto"],
  "Tokyo to Hakone, slowly": ["Tokyo", "Hakone"],
  "Nakameguro, unhurried": ["Tokyo"],
  "Kyoto, then an evening in Osaka": ["Kyoto", "Osaka"],
  "Naoshima in one day": ["Naoshima"],
};

// The demo library's seeder — what `pnpm --filter web db:seed` calls so the
// demo DATABASE carries the same saved days the demo FIXTURE declares.
//
// This is the one file here that legitimately touches fixed ids: the fixture
// names them, and re-seeding over them is the idempotency the route provides.
// Every assertion is scoped to exactly those five rows.

let currentUserId: string | null = `seed-caller-${randomUUID()}`;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { POST } = await import("./route");

const ORIGINAL_ENV = { ...process.env };
const IDS = JAPAN_SAVED_DAYS.map((day) => day.savedDayId);
const EXPECTED_ADDS = JAPAN_SAVED_DAYS.reduce((n, day) => n + day.addedBy.length, 0);

function openGate() {
  process.env.AUTH_DEV_LOGIN = "true";
  delete process.env.VERCEL_ENV;
}

beforeEach(() => {
  currentUserId = `seed-caller-${randomUUID()}`;
  delete process.env.AUTH_DEV_LOGIN;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("POST /api/dev/saved-days", () => {
  it("404s when dev login is off, without saying the route exists", async () => {
    const res = await POST();
    expect(res.status).toBe(404);
  });

  it("404s on a production deployment even with the opt-in set", async () => {
    process.env.AUTH_DEV_LOGIN = "true";
    process.env.VERCEL_ENV = "production";
    expect((await POST()).status).toBe(404);
  });

  it("401s an unauthenticated caller", async () => {
    openGate();
    currentUserId = null;
    expect((await POST()).status).toBe(401);
  });

  it("writes every fixture day with its cities DERIVED, not authored", async () => {
    openGate();
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ savedDays: IDS.length, adds: EXPECTED_ADDS });

    const rows = await db.select().from(savedDays).where(inArray(savedDays.id, IDS));
    expect(rows).toHaveLength(IDS.length);

    for (const fixture of JAPAN_SAVED_DAYS) {
      const row = rows.find((r) => r.id === fixture.savedDayId);
      expect(row, `no row for ${fixture.name}`).toBeDefined();
      expect(row!.ownerId).toBe(fixture.ownerId);
      expect(row!.visibility).toBe(fixture.visibility);
      // Written out, NOT computed with `citiesOfStops`. Deriving the expected
      // value with the same function the seeder uses makes the assertion a
      // tautology: get the rule wrong and both sides move together while the
      // test stays green. These are the answers a person read off the stops.
      //
      // The interesting ones are the last two. "Kyoto, then an evening in
      // Osaka" has an un-citied Shinkansen stop in the middle, which must be
      // skipped rather than ending the list; and every day here must be in
      // TIME order with duplicates collapsed to first occurrence.
      // Raised in review on pull request 101.
      expect(row!.cities, `cities for ${fixture.name}`).toEqual(EXPECTED_CITIES[fixture.name]);
      // A public day carries a publish time; a private one does not.
      expect(row!.publishedAt === null).toBe(fixture.visibility === "private");
    }
  });

  it("writes the ledger, and the counter agrees with it row for row", async () => {
    openGate();
    expect((await POST()).status).toBe(200);

    for (const fixture of JAPAN_SAVED_DAYS) {
      const ledger = await db
        .select()
        .from(savedDayAdds)
        .where(eq(savedDayAdds.savedDayId, fixture.savedDayId));
      expect(ledger).toHaveLength(fixture.addedBy.length);
      expect(ledger.map((r) => r.tripId).sort()).toEqual(
        fixture.addedBy.map((a) => a.tripId).sort(),
      );

      const row = await db
        .select({ adds: savedDays.adds })
        .from(savedDays)
        .where(eq(savedDays.id, fixture.savedDayId));
      expect(row[0]!.adds).toBe(fixture.addedBy.length);
    }
  });

  // Re-seeding is what `db:reseed` does, and a seeder that doubled its own
  // ledger on the second run would double `adds` with it — the exact
  // counter-versus-ledger disagreement the whole link exists to prevent.
  it("is idempotent: a second run leaves the same rows and the same counts", async () => {
    openGate();
    expect((await POST()).status).toBe(200);
    expect((await POST()).status).toBe(200);

    expect(await db.select().from(savedDays).where(inArray(savedDays.id, IDS))).toHaveLength(
      IDS.length,
    );
    expect(
      await db.select().from(savedDayAdds).where(inArray(savedDayAdds.savedDayId, IDS)),
    ).toHaveLength(EXPECTED_ADDS);
    for (const fixture of JAPAN_SAVED_DAYS) {
      const row = await db
        .select({ adds: savedDays.adds })
        .from(savedDays)
        .where(eq(savedDays.id, fixture.savedDayId));
      expect(row[0]!.adds).toBe(fixture.addedBy.length);
    }
  });
});
