import { z } from "zod";
import { TripRole } from "./trip";

// The Access & Membership module's cross-boundary types (AGENTS.md module map).
//
// Nothing here is event-sourced: ADR-003 scopes the log to planning, and an
// invite is ordinary CRUD with audit fields. The planning domain never imports
// this file — `packages/domain` reads `TripMember` and nothing else, and the
// AccessPolicy seam is still the only thing that interprets a role.

// `owner` is deliberately absent: an invite hands out participation, never
// ownership. Transferring a trip is a different operation with different
// consequences (the owner is the only role that can delete a trip) and no
// milestone has asked for it.
export const InviteRole = z.enum(["viewer", "editor"]);
export type InviteRole = z.infer<typeof InviteRole>;

// `pending` → `accepted` (single use) or `revoked`. There is no expiry today:
// an unexpiring link the owner can revoke is one control, and adding a second
// one nobody asked for would need a UI to explain it.
export const InviteStatus = z.enum(["pending", "accepted", "revoked"]);
export type InviteStatus = z.infer<typeof InviteStatus>;

// The owner's view of an invite. `token` is in this DTO because the owner has
// to be able to re-copy the link they already handed out; the route that
// serves it requires `owner`, and no other endpoint ever returns a token.
export const TripInvite = z.object({
  inviteId: z.string().uuid(),
  tripId: z.string().uuid(),
  // Optional, and NOT a credential — the token is (see ADR-026). It is a label
  // so the owner can tell two outstanding invites apart. The dev-login
  // provider mints users with no email at all, so a required one would make
  // invites untestable end to end.
  email: z.string().email().nullable(),
  role: InviteRole,
  status: InviteStatus,
  token: z.string().min(1),
  invitedBy: z.string().min(1),
  createdAt: z.string(),
  acceptedBy: z.string().min(1).nullable(),
  acceptedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type TripInvite = z.infer<typeof TripInvite>;

export const CreateInviteInput = z.object({
  // `.or(z.literal(""))` is deliberately NOT accepted: the client sends null
  // for "no email", so an empty string is a bug worth a 400 rather than a
  // silently stored blank.
  email: z.string().email().max(320).nullable(),
  role: InviteRole,
});
export type CreateInviteInput = z.infer<typeof CreateInviteInput>;

// A member with the profile fields the Travelers list needs. `TripMember`
// (planning) stays `{ userId, role }` — this is the Identity join, done in the
// Access module where it belongs, so no planning read model grows a name.
export const TripMemberProfile = z.object({
  userId: z.string().min(1),
  role: TripRole,
  name: z.string().nullable(),
  email: z.string().nullable(),
  image: z.string().nullable(),
});
export type TripMemberProfile = z.infer<typeof TripMemberProfile>;

// GET /api/trips/:tripId/access. `invites` is empty for a non-owner (they may
// see who is on the trip; they may not see or reuse the links that let people
// on). `myRole` is what the board reads to know it is read-only — advisory
// only: every write is refused server-side regardless of what the client did.
export const TripAccess = z.object({
  tripId: z.string().uuid(),
  myRole: TripRole,
  members: z.array(TripMemberProfile).min(1),
  invites: z.array(TripInvite),
});
export type TripAccess = z.infer<typeof TripAccess>;

// What the accept screen shows before anyone commits to anything. No token is
// echoed back and no member list is exposed: this is the one Access read a
// person who is not yet a member can perform.
export const InvitePreview = z.object({
  tripId: z.string().uuid(),
  tripName: z.string(),
  role: InviteRole,
  status: InviteStatus,
  invitedByName: z.string().nullable(),
  // True when the viewer is already on this trip (they followed the link
  // twice, or the owner also added them directly). The screen offers "Open the
  // trip" instead of "Join" rather than reporting an error.
  alreadyMember: z.boolean(),
});
export type InvitePreview = z.infer<typeof InvitePreview>;
