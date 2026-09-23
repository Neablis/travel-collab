import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddActivity, InviteLanding } from "@tc/contracts";
import { db } from "@/server/db/client";
import { tripDetails, users } from "@/server/db/schema";
import { executeTripCommand } from "@/server/commands";
import { upsertUser } from "@/server/users";
import { acceptInvite, createInvite, revokeInvite } from "@/server/access/invites";
import { entitleAccounts } from "@/server/test-support/entitledAccount";

// `GET /api/invites/:token` — the invite landing (M27 link 6). Through the
// ROUTE rather than `readInviteLanding` alone, because the route's parse is
// half of the nondisclosure rule: `InviteLanding`'s refusals are `.strict()`,
// so what this file asserts about a refused link is what actually leaves.

const run = randomUUID().slice(0, 8);
const OWNER = `dev-landing-owner-${run}`;
const GUEST = `dev-landing-guest-${run}`;
const CARA = `dev-landing-cara-${run}`;

let currentUserId = "";

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET } = await import("./route");

async function landing(token: string): Promise<{ status: number; body: { landing: InviteLanding }; raw: string }> {
  const response = await GET(new Request("http://test/x"), { params: Promise.resolve({ token }) });
  const raw = await response.text();
  return { status: response.status, body: JSON.parse(raw) as { landing: InviteLanding }, raw };
}

async function seedTrip(name = "Japan: food and temples"): Promise<string> {
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name }, OWNER);
  if (!created.ok) throw new Error("failed to seed trip");
  return tripId;
}

async function addDay(tripId: string): Promise<string> {
  const dayId = randomUUID();
  const added = await executeTripCommand({ type: "AddDay", tripId, dayId }, OWNER);
  if (!added.ok) throw new Error("failed to add day");
  return dayId;
}

async function addStop(
  tripId: string,
  dayId: string,
  title: string,
  extra: Partial<Pick<AddActivity, "kind" | "tags">> & { city?: string } = {},
): Promise<void> {
  const { city, ...rest } = extra;
  const added = await executeTripCommand(
    {
      type: "AddActivity",
      tripId,
      dayId,
      activityId: randomUUID(),
      title,
      ...(city === undefined ? {} : { location: { name: title, city, lat: 35, lng: 135 } }),
      ...rest,
    },
    OWNER,
  );
  if (!added.ok) throw new Error(`failed to add ${title}`);
}

beforeAll(async () => {
  // The owner must be able to collaborate, or the guest's grant caps and the
  // suite would be about entitlements (see invites.int.test.ts). The UPDATE
  // and the upsert give the owner and the guest the names the landing shows.
  await entitleAccounts([OWNER]);
  await db.update(users).set({ name: "Dana Reyes", email: "dana@example.com" }).where(eq(users.id, OWNER));
  await upsertUser({ id: GUEST, name: "Mei Tanaka", email: "mei@example.com", image: null });
});

beforeEach(() => {
  currentUserId = "";
});

describe("GET /api/invites/:token — a pending invite", () => {
  it("answers a signed-out stranger with who asked, the trip, the plan and the crew", async () => {
    const tripId = await seedTrip();
    const kyoto1 = await addDay(tripId);
    const kyoto2 = await addDay(tripId);
    await addDay(tripId); // day 3, nothing planned
    const osaka = await addDay(tripId);
    // Transit and lodging are not highlights; the cap is three per leg, and a
    // leg's highlights run across its days in order.
    await addStop(tripId, kyoto1, "Shinkansen from Tokyo", { city: "Kyoto", kind: "transit" });
    await addStop(tripId, kyoto1, "Check in at the ryokan", { city: "Kyoto", tags: ["lodging"] });
    await addStop(tripId, kyoto1, "Fushimi Inari", { city: "Kyoto" });
    await addStop(tripId, kyoto2, "Nishiki Market", { city: "Kyoto" });
    await addStop(tripId, kyoto2, "Gion at dusk", { city: "Kyoto" });
    await addStop(tripId, kyoto2, "Pontocho dinner", { city: "Kyoto" });
    await addStop(tripId, osaka, "Dotonbori", { city: "Osaka" });
    const invite = await createInvite(tripId, OWNER, { email: "sam@example.com", role: "editor" });
    const earlier = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    expect((await acceptInvite(earlier.token, GUEST)).ok).toBe(true);

    const { status, body, raw } = await landing(invite.token);

    expect(status).toBe(200);
    expect(body.landing).toEqual({
      state: "valid",
      signedIn: false,
      tripId,
      role: "editor",
      sentAt: invite.createdAt,
      recipientEmail: "sam@example.com",
      inviterName: "Dana Reyes",
      trip: { name: "Japan: food and temples", startDate: null, dayCount: 4, cityCount: 2, stopCount: 7 },
      days: [
        { city: "Kyoto", stopCount: 3 },
        { city: "Kyoto", stopCount: 3 },
        { city: null, stopCount: 0 },
        { city: "Osaka", stopCount: 1 },
      ],
      legs: [
        {
          city: "Kyoto",
          dayFrom: 1,
          dayTo: 2,
          stopCount: 6,
          highlights: ["Fushimi Inari", "Nishiki Market", "Gion at dusk"],
        },
        { city: null, dayFrom: 3, dayTo: 3, stopCount: 0, highlights: [] },
        { city: "Osaka", dayFrom: 4, dayTo: 4, stopCount: 1, highlights: ["Dotonbori"] },
      ],
      crew: ["Dana", "Mei"],
    });
    // ADR-027: a stranger's page carries no user id, and no crew member's
    // address — the name chain stops before its email link.
    for (const secret of [OWNER, GUEST, "dana@example.com", "mei@example.com", invite.token]) {
      expect(raw).not.toContain(secret);
    }
  });

  // A Google account is keyed by its `sub` — a long number. With no `users`
  // row there is no name to show, and the landing must not fall back to it.
  it("names nobody by an id even when Identity has no name for them", async () => {
    const tripId = await seedTrip();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "viewer" });
    const nameless = `1098${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    await acceptInvite((await createInvite(tripId, OWNER, { email: null, role: "viewer" })).token, nameless);

    const { raw, body } = await landing(invite.token);
    expect(body.landing.state).toBe("valid");
    expect(raw).not.toContain(nameless);
  });
});

describe("GET /api/invites/:token — what a refused link says", () => {
  it("says only `revoked` about a revoked invite", async () => {
    const tripId = await seedTrip("Kyoto");
    const invite = await createInvite(tripId, OWNER, { email: "bob@example.com", role: "editor" });
    await revokeInvite(tripId, invite.inviteId);
    currentUserId = CARA;

    const { status, body, raw } = await landing(invite.token);
    expect(status).toBe(410);
    expect(body.landing).toEqual({ state: "revoked", signedIn: true });
    for (const secret of ["Kyoto", tripId, "Dana", "bob@example.com"]) expect(raw).not.toContain(secret);
  });

  it("says only that the link was used, to anyone but the person who used it", async () => {
    const tripId = await seedTrip("Kyoto");
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    await acceptInvite(invite.token, GUEST);
    currentUserId = CARA;

    const { status, body, raw } = await landing(invite.token);
    expect(status).toBe(410);
    expect(body.landing).toEqual({
      state: "unavailable",
      signedIn: true,
      message: "This invite has already been used.",
    });
    for (const secret of ["Kyoto", tripId, "Dana", "Mei"]) expect(raw).not.toContain(secret);
  });

  it("tells the person who used it that they are on the trip — and only with a session", async () => {
    const tripId = await seedTrip("Japan: food and temples");
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    await acceptInvite(invite.token, GUEST);

    currentUserId = GUEST;
    expect((await landing(invite.token)).body.landing).toEqual({
      state: "member",
      signedIn: true,
      tripId,
      tripName: "Japan: food and temples",
    });

    // The same link, signed out, is somebody else's spent link.
    currentUserId = "";
    expect((await landing(invite.token)).body.landing.state).toBe("unavailable");
  });

  it("answers an unknown token and a deleted trip as unavailable, 404 and 410", async () => {
    const unknown = await landing("no-such-token");
    expect(unknown.status).toBe(404);
    expect(unknown.body.landing).toEqual({
      state: "unavailable",
      signedIn: false,
      message: "This invite link is not valid.",
    });

    const tripId = await seedTrip("Kyoto");
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    const deleted = await executeTripCommand({ type: "DeleteTrip", tripId }, OWNER);
    expect(deleted.ok).toBe(true);
    const gone = await landing(invite.token);
    expect(gone.status).toBe(410);
    expect(gone.body.landing).toEqual({
      state: "unavailable",
      signedIn: false,
      message: "This trip is no longer available.",
    });
  });

  // `getTripDetail` THROWS on a stored doc it cannot parse. Uncaught, this
  // public read answered 500 — the one status the landing offers Try again
  // for, and a retry that could never succeed.
  it("answers a trip it cannot read as unavailable, not a 500", async () => {
    const tripId = await seedTrip("Unreadable");
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    const [row] = await db.select().from(tripDetails).where(eq(tripDetails.tripId, tripId));
    await db
      .update(tripDetails)
      .set({ doc: { ...(row!.doc as object), days: "not a list" } as never })
      .where(eq(tripDetails.tripId, tripId));

    const unreadable = await landing(invite.token);
    expect(unreadable.status).toBe(410);
    expect(unreadable.body.landing).toEqual({
      state: "unavailable",
      signedIn: false,
      message: "This trip is no longer available.",
    });
  });
});
