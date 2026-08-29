import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import type {
  CreateInviteInput,
  TripDetail,
  InvitePreview,
  InviteRole,
  InviteStatus,
  TripInvite,
} from "@tc/contracts";
import { db } from "../db/client";
import { tripInvites, users } from "../db/schema";
import { getTripDetail } from "../projections";
import { grantMembership, grantedMembers, mergeMembers, revokeMembership } from "./members";

/**
 * Thrown inside `acceptInvite`'s transaction when a concurrent accept won the
 * race for the membership row. Rolls the transaction back — including the
 * token claim — and is converted to an ordinary refusal by the caller.
 */
class AlreadyAMemberError extends Error {}

export type AccessError = { code: "not-found" | "forbidden" | "invalid" | "gone"; message: string };
export type AccessResult<T> = { ok: true; value: T } | { ok: false; error: AccessError };

/**
 * 32 bytes of CSPRNG entropy, base64url. This IS the credential (ADR-026):
 * anyone holding the link can accept, and the invite's `email` is a label, not
 * a check. The alternative — refusing to accept unless the session's email
 * matches — was rejected because the dev-login provider mints users with no
 * email at all, which would make the whole flow untestable end to end, and
 * because a person is quite likely to sign in with a different address than
 * the one they were invited at. The controls that remain are that the token is
 * unguessable, single-use, and revocable.
 */
function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

type InviteRow = typeof tripInvites.$inferSelect;

/**
 * The one place a stored instant becomes a `TripInvite`'s string. The columns
 * are `mode: "date"` precisely so this conversion cannot be skipped on the
 * write path: a row built in memory carries `Date`s exactly like a row read
 * back does, so both paths render the same ISO-8601 string (KI-53).
 */
function toDto(row: InviteRow): TripInvite {
  return {
    inviteId: row.id,
    tripId: row.tripId,
    email: row.email,
    role: row.role as InviteRole,
    status: row.status as InviteStatus,
    token: row.token,
    invitedBy: row.invitedBy,
    createdAt: row.createdAt.toISOString(),
    acceptedBy: row.acceptedBy,
    acceptedAt: row.acceptedAt === null ? null : row.acceptedAt.toISOString(),
    revokedAt: row.revokedAt === null ? null : row.revokedAt.toISOString(),
  };
}

export async function createInvite(
  tripId: string,
  invitedBy: string,
  input: CreateInviteInput,
  now: string = new Date().toISOString(),
): Promise<TripInvite> {
  const row: InviteRow = {
    id: randomUUID(),
    tripId,
    email: input.email === null ? null : input.email.trim().toLowerCase(),
    role: input.role,
    token: mintToken(),
    status: "pending",
    invitedBy,
    createdAt: new Date(now),
    acceptedBy: null,
    acceptedAt: null,
    revokedAt: null,
  };
  await db.insert(tripInvites).values(row);
  return toDto(row);
}

/** Newest first — the link someone just created is the one they want to copy. */
export async function listInvites(tripId: string): Promise<TripInvite[]> {
  const rows = await db.select().from(tripInvites).where(eq(tripInvites.tripId, tripId));
  return rows
    .map(toDto)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/**
 * Revoke: the link stops working, and if it has already been used, the
 * membership it created goes with it. Both halves in one transaction so a
 * revoked invite can never leave a live membership behind.
 *
 * The order is the load-bearing part. The guarded UPDATE goes FIRST and the
 * membership is deleted from the `acceptedBy` that UPDATE *returns*, never
 * from a prior SELECT. Reading first is exactly what broke the invariant
 * above: under READ COMMITTED the SELECT saw `pending` / `acceptedBy: null`
 * while a concurrent accept was still in flight, so revoke skipped the
 * delete; the accept then committed its membership row; and an unguarded
 * `SET status = 'revoked'` wrote straight over that new row version. The
 * invite read "Revoked", the membership lived, and nothing could take it
 * away — re-revoking returned early and there is no remove-member endpoint,
 * so the person the owner was trying to lock out kept editor access
 * permanently (PR #71 review §1). RETURNING reports the row as it stands
 * after this statement took its lock, so a racing accept's `acceptedBy` is
 * visible here.
 *
 * `status <> 'revoked'` is what keeps the write idempotent, and the
 * already-revoked path falls through to the same delete rather than returning
 * early — so revoking a second time is the recovery for any membership an
 * earlier lost race left behind.
 */
export async function revokeInvite(
  tripId: string,
  inviteId: string,
  now: string = new Date().toISOString(),
): Promise<AccessResult<TripInvite>> {
  return db.transaction(async (tx): Promise<AccessResult<TripInvite>> => {
    const claimed = await tx
      .update(tripInvites)
      .set({ status: "revoked", revokedAt: new Date(now) })
      .where(
        and(
          eq(tripInvites.id, inviteId),
          eq(tripInvites.tripId, tripId),
          ne(tripInvites.status, "revoked"),
        ),
      )
      .returning();
    let row: InviteRow | undefined = claimed[0];
    if (row === undefined) {
      // Nothing matched: either this invite does not exist (or belongs to
      // another trip), or it was already revoked. Re-read to tell those
      // apart — the second case still has a membership to re-assert.
      const rows = await tx
        .select()
        .from(tripInvites)
        .where(and(eq(tripInvites.id, inviteId), eq(tripInvites.tripId, tripId)));
      row = rows[0];
    }
    if (row === undefined) {
      return { ok: false, error: { code: "not-found", message: "This invite does not exist." } };
    }
    if (row.acceptedBy !== null) {
      await revokeMembership(tx, tripId, row.acceptedBy);
    }
    return { ok: true, value: toDto(row) };
  });
}

async function findByToken(token: string): Promise<InviteRow | undefined> {
  const rows = await db.select().from(tripInvites).where(eq(tripInvites.token, token));
  return rows[0];
}

/**
 * What the accept screen renders. Deliberately readable by someone who is not
 * a member — that is the entire point of an invite — and deliberately thin:
 * a trip name, the role on offer, and nothing about who else is on the trip.
 *
 * A spent or revoked token now discloses nothing at all. This never gated on
 * `status`, so revoking a link stopped it being *usable* but left it
 * answering with the trip's name, the role and the inviter's name forever, to
 * whoever still held it (PR #71 review §7).
 *
 * The refusal borrows `acceptInvite`'s wording for the same two situations
 * rather than the unknown-token wording. Accept already tells a holder which
 * of the two happened, so repeating it here reveals nothing new, and the
 * accept screen has no other way to explain why the Join button went away —
 * `e2e/m11-invites.spec.ts` ("a revoked link stops working") asserts exactly
 * that sentence.
 *
 * The one exception is a viewer who is already on the trip: the name and the
 * roles are readable through the trip itself, so there is nothing left to
 * withhold, and gating them would turn "follow your own link twice" — which
 * this screen answers with "Open the trip" — into a dead end.
 */
export async function previewInvite(
  token: string,
  viewerId: string,
): Promise<AccessResult<InvitePreview>> {
  const row = await findByToken(token);
  if (row === undefined) {
    return { ok: false, error: { code: "not-found", message: "This invite link is not valid." } };
  }
  const detail = await getTripDetail(row.tripId);
  if (detail === null || detail.status === "deleted") {
    return { ok: false, error: { code: "gone", message: "This trip is no longer available." } };
  }
  const granted = await grantedMembers(db, row.tripId);
  const alreadyMember =
    detail.members.some((m) => m.userId === viewerId) || granted.some((m) => m.userId === viewerId);
  if (row.status !== "pending" && !alreadyMember) {
    return {
      ok: false,
      error: {
        code: "gone",
        message:
          row.status === "revoked"
            ? "This invite has been revoked."
            : "This invite has already been used.",
      },
    };
  }
  const inviter = await db.select().from(users).where(eq(users.id, row.invitedBy));
  return {
    ok: true,
    value: {
      tripId: row.tripId,
      tripName: detail.name,
      role: row.role as InviteRole,
      status: row.status as InviteStatus,
      invitedByName: inviter[0]?.name ?? null,
      alreadyMember,
    },
  };
}

/**
 * Single-use by construction: the status flip and the membership grant happen
 * in one transaction, and the flip is conditioned on the row still being
 * `pending`, so two simultaneous accepts cannot both win.
 *
 * Accepting your own invite is refused rather than silently no-op'd — it is
 * always a mistake (the owner clicked their own link) and saying so is kinder
 * than a screen that appears to do nothing.
 */
export async function acceptInvite(
  token: string,
  userId: string,
  now: string = new Date().toISOString(),
): Promise<AccessResult<{ tripId: string; role: InviteRole }>> {
  const existing = await findByToken(token);
  if (existing === undefined) {
    return { ok: false, error: { code: "not-found", message: "This invite link is not valid." } };
  }
  const detail = await getTripDetail(existing.tripId);
  if (detail === null || detail.status === "deleted") {
    return { ok: false, error: { code: "gone", message: "This trip is no longer available." } };
  }
  // Re-visiting a link you already spent is a success, not an error — checked
  // BEFORE the membership guard below, which would otherwise turn a
  // double-click into "You are already on this trip."
  if (existing.status === "accepted" && existing.acceptedBy === userId) {
    return { ok: true, value: { tripId: existing.tripId, role: existing.role as InviteRole } };
  }
  try {
    return await acceptInviteTransaction(token, userId, now, detail);
  } catch (error) {
    if (error instanceof AlreadyAMemberError) {
      return { ok: false, error: { code: "invalid", message: "You are already on this trip." } };
    }
    throw error;
  }
}

function acceptInviteTransaction(
  token: string,
  userId: string,
  now: string,
  detail: TripDetail,
): Promise<AccessResult<{ tripId: string; role: InviteRole }>> {
  return db.transaction(async (tx): Promise<AccessResult<{ tripId: string; role: InviteRole }>> => {
    // The EFFECTIVE member list, not `detail.members` (the projection, which
    // carries only the owner). Reading the projection let an existing member
    // accept a second outstanding invite and rewrite their own role, so the
    // role that stuck was whichever link the RECIPIENT clicked last.
    //
    // Inside the transaction, but that alone does not make it safe: under READ
    // COMMITTED two simultaneous accepts of two different tokens both see no
    // membership here. `grantMembership` is where the race is actually
    // decided — see the check on its return value below.
    const members = mergeMembers(detail.members, await grantedMembers(tx, detail.tripId));
    if (members.some((m) => m.userId === userId)) {
      return {
        ok: false,
        error: { code: "invalid", message: "You are already on this trip." },
      };
    }

    const claimed = await tx
      .update(tripInvites)
      .set({ status: "accepted", acceptedBy: userId, acceptedAt: new Date(now) })
      .where(and(eq(tripInvites.token, token), eq(tripInvites.status, "pending")))
      .returning();
    const row = claimed[0];
    if (row === undefined) {
      // Lost the race, or the link was already spent/revoked. Re-read to say
      // which, because "already used by you" is a success from where the
      // person clicking is standing.
      const found = await tx.select().from(tripInvites).where(eq(tripInvites.token, token));
      const current = found[0];
      if (current !== undefined && current.status === "accepted" && current.acceptedBy === userId) {
        return { ok: true, value: { tripId: current.tripId, role: current.role as InviteRole } };
      }
      return {
        ok: false,
        error: {
          code: "gone",
          message:
            current?.status === "revoked"
              ? "This invite has been revoked."
              : "This invite has already been used.",
        },
      };
    }
    const granted = await grantMembership(tx, {
      tripId: row.tripId,
      userId,
      role: row.role as InviteRole,
      invitedBy: row.invitedBy,
      now,
    });
    if (!granted) {
      // A concurrent accept established the membership first. Throwing rolls
      // this transaction back, which un-claims the token we just marked
      // accepted — otherwise a link would be spent for a grant that never
      // happened, and the caller would be told a role they do not hold.
      throw new AlreadyAMemberError();
    }
    return { ok: true, value: { tripId: row.tripId, role: row.role as InviteRole } };
  });
}
