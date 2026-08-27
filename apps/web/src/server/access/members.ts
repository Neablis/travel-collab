import { and, eq, inArray } from "drizzle-orm";
import type { TripMember, TripMemberProfile, TripRole } from "@tc/contracts";
import { db, type Db } from "../db/client";
import { tripMemberships, users } from "../db/schema";

type Queryable = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

const RANK: Record<TripRole, number> = { viewer: 0, editor: 1, owner: 2 };

/**
 * The one place the two halves of a trip's member list meet.
 *
 * `projected` is what the planning log says — `TripCreated` mints exactly one
 * `owner` and no planning command ever adds to it. `granted` is what the
 * Access module says: one row per accepted invite. Keeping them separate is
 * what lets ADR-003 hold in both directions — no membership row is needed for
 * the eight milestones of trips that predate this table, and no planning event
 * had to be invented to carry an invite.
 *
 * Pure, and deliberately total over disagreement: if a userId appears on both
 * sides (an owner who somehow also holds a granted row), the HIGHER rank wins.
 * A trip's owner losing ownership because a stray `viewer` row exists is the
 * one failure mode here that cannot be undone through the UI.
 */
export function mergeMembers(
  projected: readonly TripMember[],
  granted: readonly TripMember[],
): TripMember[] {
  const byUser = new Map<string, TripMember>();
  for (const member of [...projected, ...granted]) {
    const existing = byUser.get(member.userId);
    if (existing === undefined || RANK[member.role] > RANK[existing.role]) {
      byUser.set(member.userId, member);
    }
  }
  // Projection order first (the owner stays the head of the list, which is
  // what TimelineLens reads as `detail.members[0]`), then grant order.
  return [...byUser.values()].sort((a, b) => rankOfSource(projected, a) - rankOfSource(projected, b));
}

function rankOfSource(projected: readonly TripMember[], member: TripMember): number {
  const index = projected.findIndex((m) => m.userId === member.userId);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/** Accepted-invite memberships for one trip, as planning-shaped members. */
export async function grantedMembers(tx: Queryable, tripId: string): Promise<TripMember[]> {
  const rows = await tx.select().from(tripMemberships).where(eq(tripMemberships.tripId, tripId));
  return rows.map((r) => ({ userId: r.userId, role: r.role as TripRole }));
}

/**
 * The member list every authorization decision and every read DTO should use.
 *
 * `projected` comes from the caller because the caller already has it — either
 * folded state inside the command transaction, or the stored `trip_details`
 * doc — and re-reading it here would double the I/O on the command path.
 */
export async function effectiveMembers(
  tx: Queryable,
  tripId: string,
  projected: readonly TripMember[],
): Promise<TripMember[]> {
  return mergeMembers(projected, await grantedMembers(tx, tripId));
}

/** Trip ids this user reaches through an accepted invite (not the ones they own). */
export async function sharedTripIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ tripId: tripMemberships.tripId })
    .from(tripMemberships)
    .where(eq(tripMemberships.userId, userId));
  return rows.map((r) => r.tripId);
}

export async function grantMembership(
  tx: Queryable,
  input: { tripId: string; userId: string; role: TripRole; invitedBy: string; now: string },
): Promise<void> {
  await tx
    .insert(tripMemberships)
    .values({
      tripId: input.tripId,
      userId: input.userId,
      role: input.role,
      invitedBy: input.invitedBy,
      createdAt: input.now,
    })
    // A safety net, not a role-change mechanism. `acceptInvite` refuses
    // outright for anyone already on the trip, precisely so that the role a
    // member ends up with is the one the OWNER granted rather than whichever
    // outstanding link the recipient chose to click last. Kept as an upsert so
    // a retried grant is idempotent rather than a primary-key error.
    .onConflictDoUpdate({
      target: [tripMemberships.tripId, tripMemberships.userId],
      set: { role: input.role, invitedBy: input.invitedBy },
    });
}

/**
 * Revoking an ACCEPTED invite takes the membership away too — otherwise
 * "revoke" would only stop a link being reused and leave the person it already
 * let in exactly where they were, which is not what the word means.
 */
export async function revokeMembership(
  tx: Queryable,
  tripId: string,
  userId: string,
): Promise<void> {
  await tx
    .delete(tripMemberships)
    .where(and(eq(tripMemberships.tripId, tripId), eq(tripMemberships.userId, userId)));
}

/**
 * The Identity join, done here rather than in a planning read model: the
 * Travelers list wants names and avatars, and `TripMember` must stay
 * `{ userId, role }` so the planning domain keeps knowing nothing about people.
 *
 * A member with no `users` row (an actor id from before M11 link 1, or the
 * non-person `'system'` actor) still appears, with null profile fields — the
 * list showing a bare id is much better than a traveler silently vanishing.
 */
export async function withProfiles(members: readonly TripMember[]): Promise<TripMemberProfile[]> {
  const ids = members.map((m) => m.userId);
  const rows = ids.length === 0 ? [] : await db.select().from(users).where(inArray(users.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return members.map((m) => {
    const profile = byId.get(m.userId);
    return {
      userId: m.userId,
      role: m.role,
      name: profile?.name ?? null,
      email: profile?.email ?? null,
      image: profile?.image ?? null,
    };
  });
}
