import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";
import type { TripSummaryMember } from "@tc/contracts";
import { db } from "@/server/db/client";
import {
  events,
  pages,
  tripDetails,
  tripInvites,
  tripMemberships,
  tripAccessRevs,
  tripShares,
  tripSummaries,
  tripTravellers,
  users,
} from "@/server/db/schema";
import { executeTripCommand } from "@/server/commands";
import { upsertUser, writePreferences } from "@/server/users";
import { acceptInvite, createInvite } from "@/server/access/invites";
import { setTravelling } from "@/server/access/travellers";
import { createShare } from "@/server/access/shares";

// Every id here is fresh per run, so the grid these tests read is only ever
// this file's own rows — no truncation, same convention as the sibling route
// int tests. That matters more here than anywhere else: GET /api/trips is the
// one route whose result set used to be "every trip on the instance".
const OWNER = `trips-owner-${randomUUID()}`;
const GUEST = `trips-guest-${randomUUID()}`;
const STRANGER = `trips-stranger-${randomUUID()}`;

let currentUserId: string = OWNER;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

// Import after the mock so the route picks up the mocked `auth`.
const { GET } = await import("./route");

type Summary = { tripId: string; name: string; members: TripSummaryMember[] };

// The persona of a member with no `users` row — every id this file mints that
// the naming test below does not sign in.
const UNNAMED = { name: null, displayName: null, avatar: null, color: null };

const seeded: string[] = [];
const signedIn: string[] = [];

async function seedTrip(name: string, owner = OWNER): Promise<string> {
  const tripId = randomUUID();
  const result = await executeTripCommand({ type: "CreateTrip", tripId, name }, owner);
  if (!result.ok) throw new Error(`failed to seed trip: ${result.error.message}`);
  seeded.push(tripId);
  return tripId;
}

// This file seeds ~14 trips per run, and it is the one testing a query whose
// old cost grew with how many trips exist — leaving them behind would be a
// slow-motion version of the e2e trip leak (PR #71 review §9). Scoped to the
// ids this file minted, so it cannot disturb a sibling suite.
afterAll(async () => {
  if (signedIn.length > 0) await db.delete(users).where(inArray(users.id, signedIn));
  if (seeded.length === 0) return;
  await db.delete(tripShares).where(inArray(tripShares.tripId, seeded));
  await db.delete(tripInvites).where(inArray(tripInvites.tripId, seeded));
  await db.delete(tripMemberships).where(inArray(tripMemberships.tripId, seeded));
  await db.delete(tripTravellers).where(inArray(tripTravellers.tripId, seeded));
  await db.delete(tripAccessRevs).where(inArray(tripAccessRevs.tripId, seeded));
  await db.delete(pages).where(inArray(pages.tripId, seeded));
  await db.delete(tripDetails).where(inArray(tripDetails.tripId, seeded));
  await db.delete(tripSummaries).where(inArray(tripSummaries.tripId, seeded));
  await db.delete(events).where(inArray(events.streamId, seeded));
});

async function join(
  tripId: string,
  role: "viewer" | "editor",
  userId: string,
  invitedBy = OWNER,
): Promise<void> {
  const invite = await createInvite(tripId, invitedBy, { email: null, role });
  const accepted = await acceptInvite(invite.token, userId);
  if (!accepted.ok) throw new Error(`failed to accept: ${accepted.error.message}`);
}

async function grid(): Promise<Summary[]> {
  const response = await GET();
  expect(response.status).toBe(200);
  return ((await response.json()) as { trips: Summary[] }).trips;
}

beforeEach(() => {
  currentUserId = OWNER;
});

describe("GET /api/trips visibility", () => {
  it("401s when unauthenticated", async () => {
    currentUserId = "";
    expect((await GET()).status).toBe(401);
  });

  // The case a naive `JOIN trip_memberships` drops on the floor: every trip
  // made in the eight milestones before that table existed, and every trip
  // anyone has made since without inviting a soul. Its ONLY record of an
  // owner is the projection's own member list.
  it("shows a trip the caller owns in the projection with no membership row at all", async () => {
    const tripId = await seedTrip("Projection only");
    const rows = await db.select().from(tripMemberships);
    expect(rows.filter((r) => r.tripId === tripId)).toEqual([]);

    const mine = (await grid()).find((t) => t.tripId === tripId);
    expect(mine).toBeDefined();
    expect(mine!.name).toBe("Projection only");
    expect(mine!.members).toEqual([{ userId: OWNER, role: "owner", travelling: true, ...UNNAMED }]);
  });

  // M11 exit gate, SPEC R4: shared trips appear in the same grid, and the
  // caller is not in the projection's member list at all.
  it("shows a trip the caller reaches only through an accepted invite", async () => {
    const tripId = await seedTrip("Shared with me");
    await join(tripId, "editor", GUEST);
    currentUserId = GUEST;

    const shared = (await grid()).find((t) => t.tripId === tripId);
    expect(shared).toBeDefined();
    expect(shared!.name).toBe("Shared with me");
    // The avatar stack counts travellers: the effective list, not the
    // projection's owner-only one, and the owner still heads it.
    expect(shared!.members).toEqual([
      { userId: OWNER, role: "owner", travelling: true, ...UNNAMED },
      { userId: GUEST, role: "editor", travelling: true, ...UNNAMED },
    ]);
  });

  it("serves an owned and a shared trip in the same shape — indistinguishable in the grid", async () => {
    const own = await seedTrip("Ours", GUEST);
    const shared = await seedTrip("Theirs");
    await join(shared, "viewer", GUEST);
    currentUserId = GUEST;

    const trips = await grid();
    const a = trips.find((t) => t.tripId === own)!;
    const b = trips.find((t) => t.tripId === shared)!;
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(a.members).toEqual([{ userId: GUEST, role: "owner", travelling: true, ...UNNAMED }]);
    // A viewer joins not travelling unless the invite said otherwise (D3).
    expect(b.members).toEqual([
      { userId: OWNER, role: "owner", travelling: true, ...UNNAMED },
      { userId: GUEST, role: "viewer", travelling: false, ...UNNAMED },
    ]);
  });

  // Travellers spec W21: the cards' "N travellers" and their avatars read
  // `travelling` off these members, and the list used to leave it off, so
  // every member counted. Two trips, so the overlay is shown to be per trip.
  it("says who is not travelling, trip by trip", async () => {
    const both = await seedTrip("Both going");
    const ownerStays = await seedTrip("Owner stays home");
    await join(both, "editor", GUEST);
    await join(ownerStays, "editor", GUEST);
    const marked = await setTravelling(ownerStays, OWNER, OWNER, false);
    expect(marked.ok).toBe(true);

    const trips = await grid();
    expect(trips.find((t) => t.tripId === both)!.members).toEqual([
      { userId: OWNER, role: "owner", travelling: true, ...UNNAMED },
      { userId: GUEST, role: "editor", travelling: true, ...UNNAMED },
    ]);
    expect(trips.find((t) => t.tripId === ownerStays)!.members).toEqual([
      { userId: OWNER, role: "owner", travelling: false, ...UNNAMED },
      { userId: GUEST, role: "editor", travelling: true, ...UNNAMED },
    ]);
  });

  // M38 part 3: a card names its people, so each member carries who they are —
  // the owner from the projection and the guest from a membership row alike,
  // since both halves of the list are named in the one users read. The
  // address is never on it: a card is read by everyone on the trip.
  it("names every member by their persona, and never by their address", async () => {
    const owner = `trips-named-owner-${randomUUID()}`;
    const guest = `trips-named-guest-${randomUUID()}`;
    signedIn.push(owner, guest);
    await upsertUser({ id: owner, email: `${owner}@example.test`, name: "Dana Reyes", image: null });
    await upsertUser({ id: guest, email: `${guest}@example.test`, name: "Sam Okafor", image: null });
    await writePreferences(owner, { displayName: "Dee", avatar: "compass", color: "plum" });
    const tripId = await seedTrip("Named", owner);
    await join(tripId, "editor", guest, owner);
    currentUserId = guest;

    const trip = (await grid()).find((t) => t.tripId === tripId)!;
    expect(trip.members).toEqual([
      { userId: owner, role: "owner", travelling: true, name: "Dana Reyes", displayName: "Dee", avatar: "compass", color: "plum" },
      { userId: guest, role: "editor", travelling: true, name: "Sam Okafor", displayName: null, avatar: null, color: null },
    ]);
    expect(JSON.stringify(trip)).not.toContain("@example.test");
  });

  // THE security assertion (project review L3). The predicate now lives in
  // SQL precisely so this cannot regress by deleting a `.filter()`.
  it("never serves a trip the caller has no relationship to", async () => {
    const theirs = await seedTrip("Not yours");
    currentUserId = STRANGER;

    const trips = await grid();
    expect(trips.map((t) => t.tripId)).not.toContain(theirs);
    // Stronger, and the actual cross-tenant claim: a stranger sees nothing.
    expect(trips).toEqual([]);
  });

  // A pinned share link is a bearer credential served at /s/<token>, not a
  // membership — it never put the trip in anyone's grid and still does not.
  it("does not surface a trip on the strength of a share token alone", async () => {
    const theirs = await seedTrip("Pinned");
    const share = await createShare(theirs, OWNER);
    expect(share.ok).toBe(true);
    currentUserId = STRANGER;

    expect((await grid()).map((t) => t.tripId)).not.toContain(theirs);
  });

  it("still hides a deleted trip from its own owner", async () => {
    const tripId = await seedTrip("Gone");
    const deleted = await executeTripCommand({ type: "DeleteTrip", tripId }, OWNER);
    expect(deleted.ok).toBe(true);

    expect((await grid()).map((t) => t.tripId)).not.toContain(tripId);
  });
});

describe("GET /api/trips cost", () => {
  // PR #71 review §6: the route ran one `effectiveMembers` query per surviving
  // trip inside a Promise.all. Counting statements is the only way to pin that
  // it no longer does — an assertion on the response body cannot see it.
  it("issues a constant number of statements no matter how many trips are visible", async () => {
    const solo = `trips-cost-solo-${randomUUID()}`;
    const many = `trips-cost-many-${randomUUID()}`;

    await seedTrip("One", solo);
    for (const name of ["A", "B", "C", "D", "E"]) {
      const tripId = await seedTrip(name, many);
      await join(tripId, "viewer", solo, many);
    }

    const spy = vi.spyOn(db.$client, "query");

    // `solo` owns one trip and is a viewer on all five of `many`'s, so it is
    // SOLO's grid that has six cards and MANY's that has five — the two user
    // ids describe what each owns, not what each sees.
    currentUserId = solo;
    spy.mockClear();
    const sixCards = await grid();
    const forSixTrips = spy.mock.calls.length;

    currentUserId = many;
    spy.mockClear();
    const fiveCards = await grid();
    const forFiveTrips = spy.mock.calls.length;

    spy.mockRestore();

    expect(sixCards.length).toBe(6); // 1 owned + 5 joined as viewer
    expect(fiveCards.length).toBe(5);
    // The summaries query, then one batched read each of the granted members,
    // who is travelling, and every member's persona (M38; M37 D5: in one read,
    // never per card).
    expect(forSixTrips).toBe(4);
    expect(forFiveTrips).toBe(forSixTrips);
  });
});
