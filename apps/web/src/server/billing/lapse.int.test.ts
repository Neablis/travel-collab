// **The lapse, end to end through M20's resolver** (M21 links 5 and 6).
//
// Two gate boxes live here and neither can be answered by a unit test:
//
//   * *"Cancelling keeps access to the end of the paid period, then lapses
//     through M20's resolver — no second downgrade path exists."*
//   * *"A lapse walks M20's collaborator cap: three collaborators drop to
//     `viewer`, `trip_memberships` is unchanged, and paying again restores
//     them."*
//
// The second one is the reason this file is in `billing/` and reaches into
// Access: the cap is applied on READ by M20's code, which this milestone does
// not touch — `members.ts` is one of the three files M21's diff must not
// modify. So what is being proven is that a billing state change is enough,
// with nothing else edited, to move what a collaborator may do.
//
// **Nothing here writes a downgrade**, and that absence is the test. The row
// keeps saying what Stripe last said; the clock does the rest.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { subscriptions, users } from "@/server/db/schema";
import { upsertUser } from "@/server/users";
import { entitlementsFor } from "@/server/entitlements/resolver";
import { effectiveMembers, grantMembership } from "@/server/access/members";
import { tripMemberships } from "@/server/db/schema";
import { GRACE_WINDOW_DAYS } from "./standing";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-10-01T12:00:00.000Z");

async function subscriber(over: Partial<typeof subscriptions.$inferInsert> = {}): Promise<string> {
  const userId = `dev-${randomUUID()}`;
  await upsertUser({ id: userId, email: null, name: null, image: null });
  // The webhook's two writes, made by hand: what the account holds, and the
  // subscription behind it. Every test below moves only the second.
  await db.update(users).set({ planId: "premium", planVersion: 1 }).where(eq(users.id, userId));
  await db.insert(subscriptions).values({
    id: randomUUID(),
    userId,
    stripeCustomerId: `cus_${userId}`,
    stripeSubscriptionId: `sub_${randomUUID()}`,
    planId: "premium",
    planVersion: 1,
    status: "active",
    currentPeriodEnd: new Date(T0.getTime() + 19 * DAY),
    cancelAtPeriodEnd: false,
    pastDueSince: null,
    lastEventAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  });
  return userId;
}

const may = async (userId: string, at: Date) => {
  const resolved = await entitlementsFor(userId, at);
  return {
    collaborators: resolved.entitlements.has("trip.collaborators"),
    assistant: resolved.entitlements.has("ai.ask"),
    held: resolved.held.planId,
    conferred: resolved.conferred.planId,
  };
};

describe("a cancellation", () => {
  it("keeps everything to the end of the paid period", async () => {
    const userId = await subscriber({ cancelAtPeriodEnd: true });
    const inside = await may(userId, new Date(T0.getTime() + 18 * DAY));
    expect(inside.collaborators).toBe(true);
    expect(inside.assistant).toBe(true);
  });

  // **What you bought stays written down.** `users.plan_id` keeps saying
  // `premium` after the lapse — it is what the account bought, and it is what
  // the account sheet has to name when it says what is being lost. Only what
  // it CONFERS changes.
  it("still names what was bought after it stops conferring", async () => {
    const userId = await subscriber({ status: "canceled", cancelAtPeriodEnd: true });
    const after = await may(userId, new Date(T0.getTime() + 20 * DAY));
    expect(after.held).toBe("premium");
    expect(after.conferred).toBe("free");
    expect(after.collaborators).toBe(false);
  });
});

describe("a declined card", () => {
  const declined = { status: "past_due" as const, pastDueSince: T0 };

  it("loses nothing inside the grace window", async () => {
    const userId = await subscriber(declined);
    const day2 = await may(userId, new Date(T0.getTime() + 2 * DAY));
    expect(day2.collaborators).toBe(true);
    expect(day2.assistant).toBe(true);
  });

  // **The gate box's exact pair**: lapses on day 4 and not on day 3.
  it("lapses on day 4 and not on day 3", async () => {
    const userId = await subscriber(declined);
    expect((await may(userId, new Date(T0.getTime() + GRACE_WINDOW_DAYS * DAY))).collaborators).toBe(true);
    expect((await may(userId, new Date(T0.getTime() + 4 * DAY))).collaborators).toBe(false);
  });

  // **Nothing ran.** No job, no scheduled write, no second downgrade path —
  // the row is byte-identical across the boundary and only the clock moved.
  // If a lapse were written down, this assertion would be the one that failed.
  it("lapses with nothing written and no job run", async () => {
    const userId = await subscriber(declined);
    const [before] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    await may(userId, new Date(T0.getTime() + 10 * DAY));
    const [after] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    expect(after).toEqual(before);
    const [account] = await db.select().from(users).where(eq(users.id, userId));
    expect(account!.planId).toBe("premium");
  });

  // **A later successful retry restores it through the ordinary path.** The
  // only thing that changes is a status, which is what makes the lapse
  // reversible rather than a state to be dug out of.
  it("is restored by the payment succeeding, with nothing special-cased", async () => {
    const userId = await subscriber(declined);
    expect((await may(userId, new Date(T0.getTime() + 6 * DAY))).collaborators).toBe(false);
    await db
      .update(subscriptions)
      .set({ status: "active", pastDueSince: null })
      .where(eq(subscriptions.userId, userId));
    expect((await may(userId, new Date(T0.getTime() + 6 * DAY))).collaborators).toBe(true);
  });
});

describe("the collaborator cap, with real collaborators", () => {
  // **The gate box this file's header claimed and did not test**: *"three
  // collaborators drop to `viewer`, `trip_memberships` is unchanged, and paying
  // again restores them."* The suite asserted the OWNER's entitlements and
  // stopped there, so every clause about other people was a comment.
  //
  // A comment asserting an invariant with no test enforcing it is a named
  // recurring defect class in this repo, and CodeRabbit flagged it on PR #177
  // citing exactly that. This is the witness.
  //
  // It is also the only place the read-boundary design is observable: nothing
  // WRITES a role, so the proof that a lapse capped anybody is that a read
  // reports `viewer` while the stored row still says `editor`.
  const OWNER_ROLE = "owner" as const;

  async function tripWithThreeEditors(ownerId: string) {
    const tripId = randomUUID();
    const collaborators = [`dev-${randomUUID()}`, `dev-${randomUUID()}`, `dev-${randomUUID()}`];
    for (const userId of collaborators) {
      await grantMembership(db, {
        tripId,
        userId,
        role: "editor",
        invitedBy: ownerId,
        now: T0.toISOString(),
      });
    }
    // The projection the planning domain would supply: the owner is members[0]
    // and is who the gate bills, which is what makes this the owner's lapse.
    const projected = [{ userId: ownerId, role: OWNER_ROLE, joinedAt: T0.toISOString() }];
    return { tripId, collaborators, projected };
  }

  const rolesOf = async (tripId: string, projected: Parameters<typeof effectiveMembers>[2]) =>
    (await effectiveMembers(db, tripId, projected))
      .filter((member) => member.role !== OWNER_ROLE)
      .map((member) => member.role);

  // **Dated against the real clock, not `T0`.** Every other test here passes an
  // explicit `now` into `entitlementsFor`, but the collaboration gate reads the
  // wall clock — it is called from a request path, not from a test — so a
  // fixture dated in the future simply never lapses. First run of this test
  // asserted `viewer` and got `editor` for exactly that reason, which is the
  // drill working: the test was wrong and it said so before it was believed.
  const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

  it("caps three editors to viewer on lapse, restores them on payment, and writes nothing", async () => {
    const ownerId = await subscriber({ status: "past_due", pastDueSince: daysAgo(1) });
    const { tripId, collaborators, projected } = await tripWithThreeEditors(ownerId);

    // **Before**: one day after the decline, inside the three-day window, all
    // three still edit.
    expect(await rolesOf(tripId, projected)).toEqual(["editor", "editor", "editor"]);

    // **After the window closes.** Nothing ran — only the decline got older —
    // and the gate reads the resolver, so the cap follows from that alone.
    await db
      .update(subscriptions)
      .set({ pastDueSince: daysAgo(GRACE_WINDOW_DAYS + 1) })
      .where(eq(subscriptions.userId, ownerId));
    expect(await rolesOf(tripId, projected)).toEqual(["viewer", "viewer", "viewer"]);

    // **`trip_memberships` is unchanged**, which is the whole point of capping
    // on read: a billing lapse cannot corrupt membership data, and there is
    // nothing to put back.
    const rows = await db.select().from(tripMemberships).where(eq(tripMemberships.tripId, tripId));
    expect(rows.map((row) => row.role).sort()).toEqual(["editor", "editor", "editor"]);
    expect(rows.map((row) => row.userId).sort()).toEqual([...collaborators].sort());

    // **Paying again restores them, with no re-invite and no write.**
    await db
      .update(subscriptions)
      .set({ status: "active", pastDueSince: null })
      .where(eq(subscriptions.userId, ownerId));
    expect(await rolesOf(tripId, projected)).toEqual(["editor", "editor", "editor"]);
  });
});

describe("what a lapse does not touch", () => {
  // **Grants are not paid for and do not lapse with a subscription.** Every
  // account predating M20's migration holds a permanent `founder` grant, so
  // this is not a hypothetical: if a lapse removed granted capabilities, the
  // first failed payment on any founder account would take away something
  // nobody sold them.
  it("leaves an account's grants conferring exactly what they did", async () => {
    const { issueGrant } = await import("@/server/entitlements/grants");
    const userId = await subscriber({ status: "canceled" });
    await issueGrant({
      userId,
      planId: "premium",
      planVersion: 1,
      source: "founder",
      expiresAt: null,
    });
    const after = await may(userId, new Date(T0.getTime() + 40 * DAY));
    expect(after.conferred).toBe("free");
    // The grant, not the subscription, is what still confers these.
    expect(after.collaborators).toBe(true);
    expect(after.assistant).toBe(true);
  });
});
