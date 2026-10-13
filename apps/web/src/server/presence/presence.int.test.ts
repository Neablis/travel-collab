// M46's presence gate box (D7, ADR-073 §6), through the events poll a client
// actually makes: who polled is served as online, who has not polled within
// the window is not, and the heartbeat writes a member's last-seen at most once
// per window however often they poll.
//
// Every time is the database's `now()`: the test container's TimeZone is not
// UTC, and a JS clock compared with it would test the offset, not the window.
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TripEventsPage } from "@tc/contracts";
import { db } from "@/server/db/client";
import { tripPresence } from "@/server/db/schema";
import { executeTripCommand } from "@/server/commands";
import { grantMembership } from "@/server/access/members";
import { entitleAccounts } from "@/server/test-support/entitledAccount";
import { DEMO_TRIP_ID } from "@/lib/demoTrip";

let currentUserId = "";
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const events = await import("@/app/api/trips/[tripId]/events/route");
const members = await import("@/app/api/trips/[tripId]/members/[userId]/route");

const newUser = () => `dev-presence-${randomUUID()}`;
const tripParams = (tripId: string) => ({ params: Promise.resolve({ tripId }) });

async function sharedTrip() {
  const owner = newUser();
  const guest = newUser();
  await entitleAccounts([owner]);
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name: "Porto" }, owner);
  if (!created.ok) throw new Error("failed to seed trip");
  await grantMembership(db, { tripId, userId: guest, role: "editor", invitedBy: owner, now: new Date().toISOString() });
  return { tripId, owner, guest };
}

async function poll(tripId: string, as: string): Promise<TripEventsPage> {
  currentUserId = as;
  const res = await events.GET(new Request(`http://test/api/trips/${tripId}/events?after=0`), tripParams(tripId));
  expect(res.status).toBe(200);
  return (await res.json()) as TripEventsPage;
}

/** `seen_at` as the database stores it, in microseconds, so a rewrite of the same millisecond still shows. */
async function seenAt(tripId: string, userId: string): Promise<string | undefined> {
  const rows = await db
    .select({ at: sql<string>`(extract(epoch from ${tripPresence.seenAt}) * 1000000)::bigint::text` })
    .from(tripPresence)
    .where(and(eq(tripPresence.tripId, tripId), eq(tripPresence.userId, userId)));
  return rows[0]?.at;
}

/**
 * The row's `xmax`: the last transaction to update or lock it. A poll that
 * neither writes nor locks the row leaves it alone; `seen_at` alone cannot
 * tell a skipped write from a row lock taken and released.
 */
async function rowXmax(tripId: string, userId: string): Promise<string | undefined> {
  const rows = await db
    .select({ xmax: sql<string>`xmax::text` })
    .from(tripPresence)
    .where(and(eq(tripPresence.tripId, tripId), eq(tripPresence.userId, userId)));
  return rows[0]?.xmax;
}

async function setSeenAgo(tripId: string, userId: string, minutes: number): Promise<void> {
  await db
    .update(tripPresence)
    .set({ seenAt: sql`now() - make_interval(mins => ${minutes})` })
    .where(and(eq(tripPresence.tripId, tripId), eq(tripPresence.userId, userId)));
}

beforeEach(() => {
  currentUserId = "";
});

describe("who is online, on the events poll", () => {
  it("serves a member who polled, to the other members", async () => {
    const { tripId, owner, guest } = await sharedTrip();
    await poll(tripId, guest);

    expect(new Set((await poll(tripId, owner)).online)).toEqual(new Set([owner, guest]));
  });

  it("does not serve a member whose last poll is older than the window", async () => {
    const { tripId, owner, guest } = await sharedTrip();
    await poll(tripId, guest);
    await setSeenAgo(tripId, guest, 7);

    expect((await poll(tripId, owner)).online).toEqual([owner]);
  });

  it("writes a member's last-seen at most once per heartbeat, however often they poll", async () => {
    const { tripId, guest } = await sharedTrip();
    await poll(tripId, guest);
    const first = await seenAt(tripId, guest);
    expect(first).toBeDefined();

    await poll(tripId, guest);
    await poll(tripId, guest);
    expect(await seenAt(tripId, guest)).toBe(first);

    // Past the heartbeat, the next poll writes again.
    await setSeenAgo(tripId, guest, 5);
    const stale = await seenAt(tripId, guest);
    await poll(tripId, guest);
    expect(await seenAt(tripId, guest)).not.toBe(stale);
  });

  // ADR-073 §6: one read per poll. An upsert that skips its update still locks
  // the row, which costs a transaction id and a WAL record every 2s per reader.
  it("neither writes nor locks the row on a poll inside the heartbeat", async () => {
    const { tripId, guest } = await sharedTrip();
    await poll(tripId, guest);
    const before = await rowXmax(tripId, guest);
    expect(before).toBeDefined();

    await poll(tripId, guest);
    expect(await rowXmax(tripId, guest)).toBe(before);
  });

  // D7: the served ids are only ever current members, so the row a removed
  // member leaves behind is never read.
  it("does not serve a removed member, even with a fresh last-seen", async () => {
    const { tripId, owner, guest } = await sharedTrip();
    await poll(tripId, guest);

    currentUserId = owner;
    const removed = await members.DELETE(new Request("http://test/x", { method: "DELETE" }), {
      params: Promise.resolve({ tripId, userId: guest }),
    });
    expect(removed.status).toBe(200);
    expect(await seenAt(tripId, guest)).toBeDefined();

    expect((await poll(tripId, owner)).online).toEqual([owner]);
  });

  it("writes and serves nothing for the demo", async () => {
    const page = await poll(DEMO_TRIP_ID, "");
    expect(page).not.toHaveProperty("online");
    const rows = await db.select().from(tripPresence).where(eq(tripPresence.tripId, DEMO_TRIP_ID));
    expect(rows).toEqual([]);
  });
});
