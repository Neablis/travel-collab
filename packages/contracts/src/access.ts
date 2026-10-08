import { z } from "zod";
import { TripMember, TripRole } from "./trip.ts";
import { AvatarKey, PersonColor } from "./identity.ts";

// The Access & Membership module's cross-boundary types (AGENTS.md module map).
//
// Nothing here is event-sourced: ADR-003 scopes the log to planning, and an
// invite is ordinary CRUD with audit fields. The planning domain never imports
// this file — `packages/domain` reads `TripMember` and nothing else, and the
// AccessPolicy seam is still the only thing that interprets a role.

// `owner` is deliberately absent: an invite hands out participation, never
// ownership. Transferring a trip is a different operation with different
// consequences (the owner is the only role that can delete a trip) and no
// milestone has asked for it. `suggester` is invitable (ADR-064): it is the
// whole point of the role that an owner can hand it out.
export const InviteRole = z.enum(["viewer", "suggester", "editor"]);
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
  // Whether whoever accepts joins as a traveller (travellers spec D3); the
  // accept writes it. Defaulted for a row or a server from before the field.
  travelling: z.boolean().default(true),
});
export type TripInvite = z.infer<typeof TripInvite>;

export const CreateInviteInput = z.object({
  // `.or(z.literal(""))` is deliberately NOT accepted: the client sends null
  // for "no email", so an empty string is a bug worth a 400 rather than a
  // silently stored blank.
  email: z.string().email().max(320).nullable(),
  role: InviteRole,
  // Optional, and NOT defaulted here: absent means "preset from the role"
  // (travellers spec D3: Can edit → travelling, the others not), which the
  // server decides. A default of `true` would override that preset.
  travelling: z.boolean().optional(),
});
export type CreateInviteInput = z.infer<typeof CreateInviteInput>;

// The two bodies `PATCH /api/trips/:tripId/members/:userId` takes. Strict, so
// a body naming both is a 400 rather than half-applied by whichever the route
// tries first.
//
// Travelling is about the person (D4): the owner may set it for anyone, a
// member for themselves only — the AccessPolicy seam decides, not this shape.
export const SetTravellingInput = z.object({ travelling: z.boolean() }).strict();
export type SetTravellingInput = z.infer<typeof SetTravellingInput>;

// A role change in place (D8). `InviteRole`, so it can never grant `owner`:
// the owner is the log's `TripCreated.createdBy`, and moving it is a transfer
// (D9, out of scope).
export const ChangeRoleInput = z.object({ role: InviteRole }).strict();
export type ChangeRoleInput = z.infer<typeof ChangeRoleInput>;

// A member with the profile fields the People list needs. `TripMember`
// (planning) carries no profile — this is the Identity join, done in the
// Access module where it belongs, so no planning read model grows a name.
// `travelling` is `TripMember`'s, read the same way (`travellerIds`).
export const TripMemberProfile = z.object({
  userId: z.string().min(1),
  role: TripRole,
  name: z.string().nullable(),
  email: z.string().nullable(),
  image: z.string().nullable(),
  travelling: TripMember.shape.travelling,
  // M38: the persona. `displayName` is what the person chose (trip surfaces
  // show it first, before `name`); `avatar` and `color` are their stored
  // choices, before any per-trip clash shift. Defaulted for version skew.
  displayName: z.string().nullable().default(null),
  avatar: AvatarKey.nullable().default(null),
  color: PersonColor.nullable().default(null),
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
  /**
   * Whether this trip's **owner** holds `trip.collaborators` (M20 link 6).
   *
   * **The owner's, not the reader's**, and the asymmetry is the design. The
   * owner is the billing subject: a trip's collaboration is paid for by whoever
   * owns it, so an editor reading this sees whether the trip they are on is
   * collaborative — not whether their own account could pay for one.
   *
   * Advisory, exactly like `myRole`: it decides whether the invite form is
   * rendered at all, and every write is refused server-side regardless of what
   * the client did with it.
   *
   * **Entitlements never learns what a trip is** (ADR-045 rule 5). This field
   * is the boolean Access & Membership reads out of that module and puts on its
   * own DTO; the capability string is opaque on the other side of that call.
   */
  collaboratorsEntitled: z.boolean(),
  /**
   * The trip's access revision as of this read (travellers spec D11, W22): the
   * same string the events poll reports as `accessRev`. It is a per-trip
   * integer counter (W5). The provider compares it for equality only; the
   * People section orders by it, to refuse a read older than the one it holds.
   *
   * **Read before the members it describes, never after.** So it is never
   * newer than the list beside it. A client that takes it as its baseline
   * then treats any later rev from the poll as news. Taking the first poll's
   * rev as the baseline instead absorbs an Access write made between the load
   * and that poll, which is then never shown (KI-2026-10-05-g).
   *
   * Optional: absent for the demo trip, which is served without the database,
   * and when the rev read fails. A client without it falls back to taking the
   * first poll's rev as the baseline.
   */
  accessRev: z.string().optional(),
  /**
   * The reader's own user id, as the server that authenticated them knows it.
   * The People section marks "You" and offers the reader's own row its menu
   * from this, rather than waiting on a separate session probe — which, when
   * it failed, left the reader no way to leave the trip.
   *
   * Optional: absent for a reader who is not on the trip (the demo visitor, an
   * invite-link look), and from a server that predates it. A client without
   * it falls back to the session.
   */
  viewerId: z.string().min(1).optional(),
});
export type TripAccess = z.infer<typeof TripAccess>;

// ── The invite landing (M27 link 6, SPEC §35.6) ─────────────────────────────
//
// What `GET /api/invites/:token` answers to ANYONE holding the link, signed in
// or not. It replaced `InvitePreview`, which needed a session and so could not
// draw the screen an invite link opens for somebody with no account yet.
//
// Four states, each its own object, and every one `.strict()`: the parse at the
// route is what guarantees a refused link carries nothing beyond its state. A
// field added to `valid` cannot ride into `revoked` on a careless spread,
// because the parse throws on it. There is no `expired`: invites do not expire
// (see `InviteStatus`), and M27 D9 records that as owed, not drawn.

// One day of the plan, for the ribbon: which city (null when no stop names
// one) and how full it is. The colour is decided on the client from `city`, by
// the same `dayAccents` derivation the board uses, so the two cannot disagree.
export const InviteLandingDay = z
  .object({
    city: z.string().nullable(),
    stopCount: z.number().int().nonnegative(),
  })
  .strict();
export type InviteLandingDay = z.infer<typeof InviteLandingDay>;

// A run of consecutive days in one city. `highlights` are stop titles, at most
// three, with transit and lodging skipped — a train and a check-in are not
// what a trip is about. Day numbers are 1-based, as the screen prints them.
export const InviteLandingLeg = z
  .object({
    city: z.string().nullable(),
    dayFrom: z.number().int().min(1),
    dayTo: z.number().int().min(1),
    stopCount: z.number().int().nonnegative(),
    highlights: z.array(z.string()).max(3),
  })
  .strict();
export type InviteLandingLeg = z.infer<typeof InviteLandingLeg>;

/**
 * A pending invite, readable in full by whoever holds the link.
 *
 * The token is the credential (ADR-026): its holder can join and then read all
 * of this and more, so the landing names the inviter and the crew (M27 D10).
 * What it never carries is a user id — `crew` is first names, the inviter is a
 * name — because a stranger's page has no use for one (ADR-027).
 *
 * `tripId` is here because both of the holder's next steps need it: *Have a
 * look first* mounts the board on it, and joining lands on it.
 */
const ValidLanding = z
  .object({
    state: z.literal("valid"),
    signedIn: z.boolean(),
    tripId: z.string().uuid(),
    role: InviteRole,
    sentAt: z.string(),
    // The label the owner typed, not a check (ADR-026) — null when they typed none.
    recipientEmail: z.string().nullable(),
    // Never an email address: a stranger's page must not turn somebody's
    // address into their name, so the name chain stops before that link.
    inviterName: z.string(),
    trip: z
      .object({
        name: z.string(),
        startDate: z.string().nullable(),
        dayCount: z.number().int().nonnegative(),
        cityCount: z.number().int().nonnegative(),
        stopCount: z.number().int().nonnegative(),
      })
      .strict(),
    days: z.array(InviteLandingDay),
    legs: z.array(InviteLandingLeg),
    crew: z.array(z.string()).min(1),
  })
  .strict();

/**
 * The reader is already on this trip. Only ever answered to a session — a
 * signed-out reader is nobody's member — and it names only what that member
 * can already read.
 */
const MemberLanding = z
  .object({
    state: z.literal("member"),
    signedIn: z.literal(true),
    tripId: z.string().uuid(),
    tripName: z.string(),
  })
  .strict();

/** Taken back by the trip. Says so and nothing else (#71 review §7, M27 D10). */
const RevokedLanding = z.object({ state: z.literal("revoked"), signedIn: z.boolean() }).strict();

/**
 * No token by that name, a trip that has been deleted, or a link somebody else
 * already used. `message` is the server's sentence for which, and it names no
 * trip, no person and no role.
 */
const UnavailableLanding = z
  .object({ state: z.literal("unavailable"), signedIn: z.boolean(), message: z.string() })
  .strict();

export const InviteLanding = z.discriminatedUnion("state", [
  ValidLanding,
  MemberLanding,
  RevokedLanding,
  UnavailableLanding,
]);
export type InviteLanding = z.infer<typeof InviteLanding>;
