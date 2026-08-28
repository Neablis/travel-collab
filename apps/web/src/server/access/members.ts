import { and, eq, exists, inArray, sql, type Column, type SQL } from "drizzle-orm";
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
  return (await grantedMembersByTrip(tx, [tripId])).get(tripId) ?? [];
}

/**
 * `grantedMembers` for many trips in ONE round trip.
 *
 * The home grid needs the effective member list for every card it renders
 * (the avatar stack counts travellers), and doing that per trip is an N+1 that
 * grows with how many trips you are on — measurable enough by M11 that it
 * widened the e2e flake window (PR #71 review §6). Trips with no accepted
 * invite are simply absent from the map; callers read `?? []`.
 *
 * Ordered, where the unordered per-trip query it replaced was not: a batched
 * read can interleave trips arbitrarily, and the avatar stack jumping between
 * refreshes for no reason is a real regression. `createdAt` is invite-accept
 * order; `userId` only breaks ties within a single transaction.
 */
export async function grantedMembersByTrip(
  tx: Queryable,
  tripIds: readonly string[],
): Promise<Map<string, TripMember[]>> {
  const byTrip = new Map<string, TripMember[]>();
  if (tripIds.length === 0) return byTrip;
  const rows = await tx
    .select()
    .from(tripMemberships)
    .where(inArray(tripMemberships.tripId, [...tripIds]))
    .orderBy(tripMemberships.createdAt, tripMemberships.userId);
  for (const r of rows) {
    const list = byTrip.get(r.tripId);
    const member: TripMember = { userId: r.userId, role: r.role as TripRole };
    if (list === undefined) byTrip.set(r.tripId, [member]);
    else list.push(member);
  }
  return byTrip;
}

/**
 * The Access module's half of "may this user see this trip?", as SQL.
 *
 * A predicate rather than a list of ids, so the caller can push it into its
 * own query instead of loading every row and filtering in JS — one dropped
 * `.filter()` there is a full cross-tenant dump (project review L3). EXISTS,
 * not a join: a trip is visible if EITHER source names the user, and an inner
 * join over `trip_memberships` alone would drop the owner-only trips that
 * predate this table entirely (see `mergeMembers` above for why the two
 * sources exist).
 *
 * `tripIdColumn` is passed in because Access does not know the shape of the
 * planning read models it narrows — only its own table.
 */
export function hasMembershipRow(tripIdColumn: Column, userId: string): SQL {
  return exists(
    db
      .select({ one: sql<number>`1` })
      .from(tripMemberships)
      .where(and(eq(tripMemberships.tripId, tripIdColumn), eq(tripMemberships.userId, userId))),
  );
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

/**
 * Establish a membership. Returns false when one already existed.
 *
 * `onConflictDoNothing`, NOT `onConflictDoUpdate`, and that is the whole
 * safety property. `acceptInvite`'s guard reads the member list and refuses
 * anyone already on the trip — but that read cannot be serialized against a
 * concurrent one by moving it inside a transaction: under READ COMMITTED two
 * simultaneous accepts of two DIFFERENT tokens both see no membership, both
 * claim their own token (no row conflict), and both arrive here. An upsert let
 * the loser of that race overwrite the winner's role, which put role selection
 * back in the recipient's hands by another door (CodeRabbit, PR #70).
 *
 * The primary key on (tripId, userId) is the only real serialization point, so
 * the decision is made HERE: first grant wins, later ones report that they
 * changed nothing, and the caller rolls its transaction back. Changing a role
 * stays the owner's operation — revoke and re-invite.
 */
export async function grantMembership(
  tx: Queryable,
  input: { tripId: string; userId: string; role: TripRole; invitedBy: string; now: string },
): Promise<boolean> {
  const inserted = await tx
    .insert(tripMemberships)
    .values({
      tripId: input.tripId,
      userId: input.userId,
      role: input.role,
      invitedBy: input.invitedBy,
      createdAt: input.now,
    })
    .onConflictDoNothing({ target: [tripMemberships.tripId, tripMemberships.userId] })
    .returning();
  return inserted.length > 0;
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
