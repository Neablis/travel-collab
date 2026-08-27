import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type {
  CreateInviteInput,
  InvitePreview,
  InviteRole,
  InviteStatus,
  TripInvite,
} from "@tc/contracts";
import { db } from "../db/client";
import { tripInvites, users } from "../db/schema";
import { getTripDetail } from "../projections";
import { grantMembership, grantedMembers, revokeMembership } from "./members";

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

function toDto(row: InviteRow): TripInvite {
  return {
    inviteId: row.id,
    tripId: row.tripId,
    email: row.email,
    role: row.role as InviteRole,
    status: row.status as InviteStatus,
    token: row.token,
    invitedBy: row.invitedBy,
    createdAt: row.createdAt,
    acceptedBy: row.acceptedBy,
    acceptedAt: row.acceptedAt,
    revokedAt: row.revokedAt,
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
    createdAt: now,
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
 */
export async function revokeInvite(
  tripId: string,
  inviteId: string,
  now: string = new Date().toISOString(),
): Promise<AccessResult<TripInvite>> {
  return db.transaction(async (tx): Promise<AccessResult<TripInvite>> => {
    const rows = await tx
      .select()
      .from(tripInvites)
      .where(and(eq(tripInvites.id, inviteId), eq(tripInvites.tripId, tripId)));
    const row = rows[0];
    if (row === undefined) {
      return { ok: false, error: { code: "not-found", message: "This invite does not exist." } };
    }
    if (row.status === "revoked") return { ok: true, value: toDto(row) };
    if (row.acceptedBy !== null) {
      await revokeMembership(tx, tripId, row.acceptedBy);
    }
    const updated: InviteRow = { ...row, status: "revoked", revokedAt: now };
    await tx
      .update(tripInvites)
      .set({ status: "revoked", revokedAt: now })
      .where(eq(tripInvites.id, inviteId));
    return { ok: true, value: toDto(updated) };
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
  const inviter = await db.select().from(users).where(eq(users.id, row.invitedBy));
  const granted = await grantedMembers(db, row.tripId);
  const alreadyMember =
    detail.members.some((m) => m.userId === viewerId) || granted.some((m) => m.userId === viewerId);
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
  if (detail.members.some((m) => m.userId === userId)) {
    return {
      ok: false,
      error: { code: "invalid", message: "You are already on this trip." },
    };
  }

  return db.transaction(async (tx): Promise<AccessResult<{ tripId: string; role: InviteRole }>> => {
    const claimed = await tx
      .update(tripInvites)
      .set({ status: "accepted", acceptedBy: userId, acceptedAt: now })
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
    await grantMembership(tx, {
      tripId: row.tripId,
      userId,
      role: row.role as InviteRole,
      invitedBy: row.invitedBy,
      now,
    });
    return { ok: true, value: { tripId: row.tripId, role: row.role as InviteRole } };
  });
}
