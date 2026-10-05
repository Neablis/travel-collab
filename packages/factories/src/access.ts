import { Factory } from "fishery";
import type { TripAccess, TripInvite, TripMemberProfile } from "@tc/contracts";
import { uuidFrom } from "./ids";

// Access & Membership's read model, for component tests of the People section
// and anything else that renders who is on a trip. Ids are `dev-*` handles, as
// the dev-login provider mints them, so `displayNameFor` and `initialsFor`
// behave as they do against a real dev account.

const ACCESS_TRIP_ID = uuidFrom(0, 7000);

export const tripMemberProfileFactory = Factory.define<TripMemberProfile>(({ sequence }) => ({
  userId: `dev-member-${sequence}`,
  role: "editor",
  name: null,
  email: null,
  image: null,
  travelling: true,
}));

export const tripInviteFactory = Factory.define<TripInvite>(({ sequence }) => ({
  inviteId: uuidFrom(sequence, 7001),
  tripId: ACCESS_TRIP_ID,
  email: null,
  role: "editor",
  status: "pending",
  token: `tok-${sequence}`,
  invitedBy: "dev-alice",
  createdAt: "2026-08-01T00:00:00.000Z",
  acceptedBy: null,
  acceptedAt: null,
  revokedAt: null,
  travelling: true,
}));

/**
 * The owner's read of a trip with one other member and one invite out: Alice
 * owns it, Bob (known only by his address) can edit, and both are travelling.
 * Entitled to collaborators, so the collaboration gate stays out of the way of
 * a test that is not about it. `overrides` replaces whole fields; build members
 * and invites with the factories above to vary one of them.
 */
export function tripAccessFixture(overrides: Partial<TripAccess> = {}): TripAccess {
  const tripId = overrides.tripId ?? ACCESS_TRIP_ID;
  return {
    tripId,
    myRole: "owner",
    members: [
      tripMemberProfileFactory.build({ userId: "dev-alice", role: "owner", name: "Alice" }),
      tripMemberProfileFactory.build({ userId: "dev-bob", role: "editor", email: "bob@example.com" }),
    ],
    invites: [tripInviteFactory.build({ tripId, email: "cara@example.com", role: "viewer" })],
    collaboratorsEntitled: true,
    ...overrides,
  };
}
