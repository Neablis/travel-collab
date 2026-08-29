import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SavedDay, type TripDetail } from "@tc/contracts";
import { db } from "../db/client";
import { tripDetails } from "../db/schema";
import { executeTripCommand } from "../commands";
import { saveDay } from "../savedDays";

const OWNER = "trip-access-owner";
const STRANGER = "trip-access-stranger";

let currentUserId = OWNER;

vi.mock("../auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { requireTripAccess } = await import("./trip-access");

// No DB truncation: every test seeds its own randomUUID() trip and reads back
// through it — the convention the sibling route int tests use.
async function seedDay(): Promise<{ tripId: string; dayId: string }> {
  const tripId = randomUUID();
  const dayId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Access" }, OWNER);
  await executeTripCommand({ type: "AddDay", tripId, dayId }, OWNER);
  await executeTripCommand(
    { type: "AddActivity", tripId, activityId: randomUUID(), dayId, title: "Ramen" },
    OWNER,
  );
  return { tripId, dayId };
}

type RawDoc = Record<string, unknown> & { activities: Record<string, Record<string, unknown>> };

/**
 * Age the stored projection back to what a doc written before M18 (and before
 * lineage) actually looks like on disk: no `kind`, no `tags`, no `forkedFrom`
 * key at all. Rewriting the row is the only faithful way to get one — a doc is
 * re-written only when its trip next changes, so the real rows in this shape
 * are the ones nobody has touched since.
 */
async function ageDocToPreM18(tripId: string): Promise<void> {
  const rows = await db.select().from(tripDetails).where(eq(tripDetails.tripId, tripId));
  const doc = JSON.parse(JSON.stringify(rows[0]!.doc)) as RawDoc;
  for (const activity of Object.values(doc.activities)) {
    delete activity.kind;
    delete activity.tags;
  }
  delete doc.forkedFrom;
  await db
    .update(tripDetails)
    // The column is `$type<TripDetail>()`, which is precisely the lie under
    // test: what is stored has never been parsed.
    .set({ doc: doc as unknown as TripDetail })
    .where(eq(tripDetails.tripId, tripId));
}

beforeEach(() => {
  currentUserId = OWNER;
});

describe("requireTripAccess", () => {
  it("still answers the ordinary case with the effective member list", async () => {
    const { tripId } = await seedDay();
    const access = await requireTripAccess(tripId, "viewer");
    if ("error" in access) throw new Error(`expected access, got ${access.error.status}`);
    expect(access.userId).toBe(OWNER);
    expect(access.role).toBe("owner");
    expect(access.detail.tripId).toBe(tripId);
    expect(access.detail.members).toEqual([{ userId: OWNER, role: "owner" }]);
  });

  it("403s a stranger", async () => {
    const { tripId } = await seedDay();
    currentUserId = STRANGER;
    const access = await requireTripAccess(tripId, "viewer");
    if (!("error" in access)) throw new Error("a stranger should not have access");
    expect(access.error.status).toBe(403);
  });

  // PR #71 review §2. `getTripDetail` returns the stored doc RAW, so typing it
  // `TripDetail` without parsing was a claim nothing checked — the defaults
  // that make a pre-M18 doc legal only exist inside a parse.
  it("supplies the contract's defaults for a doc written before the fields existed", async () => {
    const { tripId } = await seedDay();
    await ageDocToPreM18(tripId);

    const access = await requireTripAccess(tripId, "viewer");
    if ("error" in access) throw new Error(`expected access, got ${access.error.status}`);
    const activities = Object.values(access.detail.activities);
    expect(activities).toHaveLength(1);
    expect(activities[0]!.kind).toBe("planned");
    expect(activities[0]!.tags).toEqual([]);
    expect(access.detail.forkedFrom).toBeNull();
  });

  // The confirmed 500: "Keep this day" on a pre-M18 trip inserted the library
  // row, THEN threw at `SavedDay.parse` because `stopsForDay` had copied
  // `undefined` into a required `SavedStop.kind` — leaving the user a 500 and
  // an orphaned, contract-violating row. This is the route's exact sequence
  // (requireTripAccess → saveDay → SavedDay.parse), one layer down.
  it("lets a day from a pre-M18 trip be kept, as a contract-valid saved day", async () => {
    const { tripId, dayId } = await seedDay();
    await ageDocToPreM18(tripId);

    const access = await requireTripAccess(tripId, "viewer");
    if ("error" in access) throw new Error(`expected access, got ${access.error.status}`);
    const saved = await saveDay({ name: "A kept day", dayId }, access.detail, OWNER);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(() => SavedDay.parse(saved.value)).not.toThrow();
    expect(saved.value.stops).toEqual([
      expect.objectContaining({ title: "Ramen", kind: "planned", tags: [] }),
    ]);
  });
});
