import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeTripCommand } from "@/server/commands";
import { db } from "@/server/db/client";
import { savedDays } from "@/server/db/schema";

// Two actors, and the mechanism the exit gate's publish box is walked with:
// `currentUserId` is reassigned between calls, so one test can be an author and
// a reader in turn. Ids are per-run (KI-57) — nothing truncates between runs,
// so a fixed id would make these assertions a function of how often the file
// has been run.
const RUN = randomUUID();
const AUTHOR = `publish-author-${RUN}`;
const READER = `publish-reader-${RUN}`;

let currentUserId = AUTHOR;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { POST: PUBLISH, DELETE: UNPUBLISH } = await import("./route");
const { GET: READ } = await import("../route");
const { POST: SAVE } = await import("../../route");

async function saveOwnDay(name = "A day"): Promise<string> {
  const tripId = randomUUID();
  const dayId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Publishable" }, currentUserId);
  await executeTripCommand({ type: "AddDay", tripId, dayId }, currentUserId);
  await executeTripCommand(
    {
      type: "AddActivity",
      tripId,
      activityId: randomUUID(),
      dayId,
      title: "Fushimi Inari",
      location: { name: "Fushimi Inari Taisha", city: "Kyoto" },
    },
    currentUserId,
  );
  const res = await SAVE(
    new Request("http://test/x", { method: "POST", body: JSON.stringify({ name, tripId, dayId }) }),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { savedDay: { savedDayId: string } }).savedDay.savedDayId;
}

const publish = (savedDayId: string) =>
  PUBLISH(new Request("http://test/x", { method: "POST" }), {
    params: Promise.resolve({ savedDayId }),
  });

const unpublish = (savedDayId: string) =>
  UNPUBLISH(new Request("http://test/x", { method: "DELETE" }), {
    params: Promise.resolve({ savedDayId }),
  });

const read = (savedDayId: string) =>
  READ(new Request("http://test/x"), { params: Promise.resolve({ savedDayId }) });

async function publishedAtOf(savedDayId: string): Promise<Date | null> {
  const rows = await db
    .select({ publishedAt: savedDays.publishedAt })
    .from(savedDays)
    .where(eq(savedDays.id, savedDayId));
  return rows[0]?.publishedAt ?? null;
}

beforeEach(() => {
  currentUserId = AUTHOR;
});

describe("publishing a saved day", () => {
  it("is private by default, and publishing flips it", async () => {
    const savedDayId = await saveOwnDay();

    const before = await read(savedDayId);
    expect(((await before.json()) as { savedDay: { visibility: string } }).savedDay.visibility).toBe(
      "private",
    );

    const res = await publish(savedDayId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { savedDay: { visibility: string } };
    expect(body.savedDay.visibility).toBe("public");
  });

  it("401s when unauthenticated", async () => {
    const savedDayId = await saveOwnDay();
    currentUserId = "";
    expect((await publish(savedDayId)).status).toBe(401);
    expect((await unpublish(savedDayId)).status).toBe(401);
  });

  it("404s somebody else's day, published or not, and does not move it", async () => {
    const savedDayId = await saveOwnDay();
    await publish(savedDayId);

    currentUserId = READER;
    // A published day is readable by this account (below) — and still not
    // theirs to unpublish. Reading and publishing are different questions.
    expect((await unpublish(savedDayId)).status).toBe(404);
    expect((await publish(randomUUID())).status).toBe(404);

    currentUserId = AUTHOR;
    const after = (await (await read(savedDayId)).json()) as { savedDay: { visibility: string } };
    expect(after.savedDay.visibility).toBe("public");
  });
});

// The gate box, walked as two actors: "a day is private by default; publishing
// makes it findable by another signed-in account, and unpublishing removes it
// from that account's results."
describe("what another signed-in account can read", () => {
  it("cannot read a private day, can read it once published, and cannot again after unpublish", async () => {
    const savedDayId = await saveOwnDay("Kyoto temples on foot");

    currentUserId = READER;
    expect((await read(savedDayId)).status).toBe(404);

    currentUserId = AUTHOR;
    expect((await publish(savedDayId)).status).toBe(200);

    currentUserId = READER;
    const visible = await read(savedDayId);
    expect(visible.status).toBe(200);
    const body = (await visible.json()) as { savedDay: { name: string }; isAuthor: boolean };
    expect(body.savedDay.name).toBe("Kyoto temples on foot");
    // The reader is not the author — what PR3's Unpublish control keys off.
    expect(body.isAuthor).toBe(false);

    currentUserId = AUTHOR;
    expect((await unpublish(savedDayId)).status).toBe(200);

    currentUserId = READER;
    expect((await read(savedDayId)).status).toBe(404);
  });

  it("lets the author read their own day whatever its visibility", async () => {
    const savedDayId = await saveOwnDay();
    const priv = await read(savedDayId);
    expect(priv.status).toBe(200);
    expect(((await priv.json()) as { isAuthor: boolean }).isAuthor).toBe(true);

    await publish(savedDayId);
    expect((await read(savedDayId)).status).toBe(200);
  });
});

// `published_at` is not on the `SavedDay` contract — it is what Discover's
// "newest" sort orders by, server-side — so it is asserted against the row.
describe("published_at", () => {
  it("is set on publish and cleared on unpublish", async () => {
    const savedDayId = await saveOwnDay();
    expect(await publishedAtOf(savedDayId)).toBeNull();

    await publish(savedDayId);
    expect(await publishedAtOf(savedDayId)).toBeInstanceOf(Date);

    await unpublish(savedDayId);
    expect(await publishedAtOf(savedDayId)).toBeNull();
  });

  // Otherwise a client that retries a publish — or a person double-clicking —
  // reorders Discover's newest sort for free.
  it("does not move when an already-public day is published again", async () => {
    const savedDayId = await saveOwnDay();
    await publish(savedDayId);
    const first = await publishedAtOf(savedDayId);

    await publish(savedDayId);
    expect((await publishedAtOf(savedDayId))?.getTime()).toBe(first?.getTime());
  });

  // The difference between coalescing and freezing: a day that was withdrawn
  // and put back IS newly published, and the clear-to-null above is what makes
  // the coalesce take a fresh date rather than restoring the old one. Asserted
  // as "set again", not as "strictly later" — publish and republish can land in
  // the same millisecond here, and a test that depends on them not to is a
  // flake waiting for a fast machine.
  it("takes a date again when a day is unpublished and republished", async () => {
    const savedDayId = await saveOwnDay();
    await publish(savedDayId);
    await unpublish(savedDayId);
    expect(await publishedAtOf(savedDayId)).toBeNull();

    await publish(savedDayId);
    expect(await publishedAtOf(savedDayId)).toBeInstanceOf(Date);
  });
});
