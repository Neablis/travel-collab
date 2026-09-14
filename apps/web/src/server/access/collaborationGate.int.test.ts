// **The collaboration gate, and the negative that matters more than it**
// (M20 link 6).
//
// Two halves, and the second is the milestone's:
//
//   1. Inviting anyone requires the trip OWNER's `trip.collaborators`.
//   2. **Trip planning is entirely free**, and a test proves it stays free.
//      That is the most important negative in this milestone: everything else
//      here is a gate, and the thing most likely to break quietly is a gate
//      arriving somewhere it was never supposed to be.
//
// The lapse behaviour is a read boundary, so it is asserted the only way that
// means anything: the `trip_memberships` rows are compared byte for byte
// before and after, and restoring is counted in writes.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { tripMemberships, users } from "@/server/db/schema";
import { executeTripCommand } from "@/server/commands";
import { getTripDetail } from "@/server/projections";
import { effectiveMembers, capGranted, grantMembership } from "./members";
import { upsertUser } from "@/server/users";
import { issueGrant, revokeGrant, allGrantsFor } from "@/server/entitlements/grants";

// The routes read the session through `@/server/auth`; the endpoint half of
// this suite drives them as a real owner, so the seam is a mutable id — the
// same idiom the sibling route int tests use.
let currentUserId = "";
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const newUser = () => `dev-${randomUUID()}`;

async function account(planId: "free" | "plus" | "premium"): Promise<string> {
  const id = newUser();
  await upsertUser({ id, email: null, name: null, image: null });
  await db.update(users).set({ planId, planVersion: 1 }).where(eq(users.id, id));
  return id;
}

async function tripOwnedBy(ownerId: string): Promise<string> {
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto 2028" }, ownerId);
  if (!created.ok) throw new Error("failed to seed trip");
  return tripId;
}

async function membershipRows(tripId: string) {
  return db
    .select()
    .from(tripMemberships)
    .where(eq(tripMemberships.tripId, tripId))
    .orderBy(tripMemberships.userId);
}

async function addCollaborator(tripId: string, ownerId: string, role: "editor" | "viewer" = "editor") {
  const userId = newUser();
  await grantMembership(db, {
    tripId,
    userId,
    role,
    invitedBy: ownerId,
    now: new Date().toISOString(),
  });
  return userId;
}

describe("trip planning is entirely free", () => {
  // **The milestone's most important negative.** A `free` account creates a
  // trip, dates it, adds a day and an activity, sets a cost and a budget — all
  // of it, with no gate anywhere. If an entitlement check ever arrives on this
  // path, this is what says so.
  it("lets a free account plan a whole trip with no gate anywhere", async () => {
    const free = await account("free");
    const tripId = await tripOwnedBy(free);

    const dayIds = [randomUUID(), randomUUID(), randomUUID()];
    const dated = await executeTripCommand(
      { type: "SetTripDates", tripId, startDate: "2028-04-01", endDate: "2028-04-03", newDayIds: dayIds },
      free,
    );
    expect(dated.ok).toBe(true);
    if (!dated.ok) return;

    const firstDay = dated.detail.days[0]!.dayId;
    for (const command of [
      {
        type: "AddActivity" as const,
        tripId,
        activityId: randomUUID(),
        dayId: firstDay,
        title: "Fushimi Inari",
        cost: { amountMinor: 0, currency: "JPY" as const },
      },
      { type: "SetTripCurrency" as const, tripId, currency: "JPY" as const },
      { type: "SetTripBudget" as const, tripId, budget: { amountMinor: 400000, currency: "JPY" as const } },
      { type: "SetTripName" as const, tripId, name: "Kyoto, properly" },
    ]) {
      const result = await executeTripCommand(command, free);
      expect(result.ok, `${command.type} was refused for a free account`).toBe(true);
    }

    const detail = await getTripDetail(tripId);
    expect(detail!.name).toBe("Kyoto, properly");
    expect(detail!.days).toHaveLength(3);
    // And the member list is still just them, uncapped — a solo trip never
    // reaches the gate at all.
    expect(await effectiveMembers(db, tripId, detail!.members)).toEqual([
      { userId: free, role: "owner" },
    ]);
  });
});

describe("the lapse caps granted memberships on read", () => {
  // The gate box, in full: *"A premium owner with three collaborators lapses:
  // all three drop to `viewer`, `trip_memberships` rows are byte-identical
  // before and after, and re-granting restores all three to `editor` with zero
  // writes to that table. The owner keeps editing throughout."*
  it("drops three collaborators to viewer and restores them with zero writes", async () => {
    const owner = await account("premium");
    const tripId = await tripOwnedBy(owner);
    const collaborators = [
      await addCollaborator(tripId, owner),
      await addCollaborator(tripId, owner),
      await addCollaborator(tripId, owner),
    ];
    const detail = await getTripDetail(tripId);
    const projected = detail!.members;

    const before = await membershipRows(tripId);
    expect(before.map((row) => row.role)).toEqual(["editor", "editor", "editor"]);

    const entitled = await effectiveMembers(db, tripId, projected);
    for (const userId of collaborators) {
      expect(entitled.find((m) => m.userId === userId)!.role).toBe("editor");
    }

    // The lapse. `users.plan_id` is what a cancelled subscription would move
    // (M21's webhook); nothing else changes.
    await db.update(users).set({ planId: "free" }).where(eq(users.id, owner));

    const lapsed = await effectiveMembers(db, tripId, projected);
    for (const userId of collaborators) {
      expect(lapsed.find((m) => m.userId === userId)!.role).toBe("viewer");
    }
    // **The owner keeps editing throughout.** Their role comes from the
    // projection and never appears in the granted list, so it is untouched by
    // construction rather than by a special case.
    expect(lapsed.find((m) => m.userId === owner)!.role).toBe("owner");

    // **Byte-identical.** Not "still three rows" — every column, including the
    // ones a write would have moved.
    expect(await membershipRows(tripId)).toEqual(before);

    // **Restoring is zero writes to this table.** Paying again is a change to
    // `users`, and the same rows read differently.
    await db.update(users).set({ planId: "premium" }).where(eq(users.id, owner));
    const restored = await effectiveMembers(db, tripId, projected);
    for (const userId of collaborators) {
      expect(restored.find((m) => m.userId === userId)!.role).toBe("editor");
    }
    expect(await membershipRows(tripId)).toEqual(before);
  });

  // A grant is as good as a plan here — the resolver unions them, so an admin
  // comp of `premium` restores collaboration without touching `users.plan_id`.
  it("keys on the union, so a premium grant is enough", async () => {
    const owner = await account("free");
    const tripId = await tripOwnedBy(owner);
    const collaborator = await addCollaborator(tripId, owner);
    const projected = (await getTripDetail(tripId))!.members;

    expect((await effectiveMembers(db, tripId, projected)).find((m) => m.userId === collaborator)!.role).toBe(
      "viewer",
    );

    await issueGrant({
      userId: owner,
      planId: "premium",
      planVersion: 1,
      source: "admin",
      grantedBy: "operator",
      expiresAt: null,
    });
    expect((await effectiveMembers(db, tripId, projected)).find((m) => m.userId === collaborator)!.role).toBe(
      "editor",
    );

    const [grant] = await allGrantsFor(owner);
    await revokeGrant(grant!.id, "operator");
    expect((await effectiveMembers(db, tripId, projected)).find((m) => m.userId === collaborator)!.role).toBe(
      "viewer",
    );
  });

  // **It is the OWNER's entitlement, not the reader's.** An unentitled editor
  // reading a premium owner's trip sees the real roles — collaboration on this
  // trip is paid for, and by someone else.
  it("reads the owner's plan and never the reader's", async () => {
    const owner = await account("premium");
    const tripId = await tripOwnedBy(owner);
    const collaborator = await addCollaborator(tripId, owner);
    // The collaborator's own account is bare free and it makes no difference.
    await upsertUser({ id: collaborator, email: null, name: null, image: null });
    const projected = (await getTripDetail(tripId))!.members;
    const members = await effectiveMembers(db, tripId, projected);
    expect(members.find((m) => m.userId === collaborator)!.role).toBe("editor");
  });

  // The cap itself, pure: it narrows and never widens, and it never touches an
  // owner because an owner is never in the granted list.
  it("narrows and never widens", () => {
    const granted = [
      { userId: "a", role: "editor" as const },
      { userId: "b", role: "viewer" as const },
    ];
    expect(capGranted(granted, true)).toEqual(granted);
    expect(capGranted(granted, false)).toEqual([
      { userId: "a", role: "viewer" },
      { userId: "b", role: "viewer" },
    ]);
    // Nothing is promoted by a lapse, and nothing is removed.
    expect(capGranted(granted, false)).toHaveLength(2);
  });
});

describe("a free owner cannot create a trip invite", () => {
  it("refuses with 402 and names the tier rather than a permission", async () => {
    const free = await account("free");
    const tripId = await tripOwnedBy(free);
    const { POST } = await import("@/app/api/trips/[tripId]/invites/route");
    const { COLLABORATORS_NOT_ENTITLED_REASON } = await import("./collaborationGate");

    currentUserId = free;
    const res = await POST(
      new Request("http://localhost/api/trips/x/invites", {
        method: "POST",
        body: JSON.stringify({ email: "someone@example.com", role: "editor" }),
      }),
      { params: Promise.resolve({ tripId }) },
    );
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe("collaborators-not-entitled");
    expect(body.error).toBe(COLLABORATORS_NOT_ENTITLED_REASON);
    // Names the tier, not a permission — and carries no price.
    expect(body.error).toContain("Premium");
    expect(body.error).not.toMatch(/\$|\bUSD\b|per month|permission/i);
    // Nothing was written.
    expect(
      await db.select().from(tripMemberships).where(eq(tripMemberships.tripId, tripId)),
    ).toHaveLength(0);
  });

  it("lets a premium owner through", async () => {
    const premium = await account("premium");
    const tripId = await tripOwnedBy(premium);
    const { POST } = await import("@/app/api/trips/[tripId]/invites/route");

    currentUserId = premium;
    const res = await POST(
      new Request("http://localhost/api/trips/x/invites", {
        method: "POST",
        body: JSON.stringify({ email: "someone@example.com", role: "editor" }),
      }),
      { params: Promise.resolve({ tripId }) },
    );
    expect(res.status).toBe(201);
  });
});
