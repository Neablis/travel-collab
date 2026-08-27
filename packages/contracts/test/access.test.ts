import { describe, expect, it } from "vitest";
import {
  CreateInviteInput,
  InvitePreview,
  InviteRole,
  TripAccess,
  TripInvite,
  TripMemberProfile,
  TripRole,
} from "../src";

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const inviteId = "1b3d5f70-1111-4222-8333-444455556666";

const invite = {
  inviteId,
  tripId,
  email: "bob@example.com",
  role: "editor",
  status: "pending",
  token: "tok",
  invitedBy: "dev-alice",
  createdAt: "2026-08-01T00:00:00.000Z",
  acceptedBy: null,
  acceptedAt: null,
  revokedAt: null,
};

describe("InviteRole", () => {
  // An invite hands out participation, never ownership: transferring a trip is
  // a different operation (the owner is the only role that can delete it) and
  // nothing has asked for it.
  it("offers viewer and editor, never owner", () => {
    expect(InviteRole.options).toEqual(["viewer", "editor"]);
    expect(InviteRole.safeParse("owner").success).toBe(false);
  });

  it("is a strict subset of TripRole", () => {
    for (const role of InviteRole.options) expect(TripRole.safeParse(role).success).toBe(true);
  });
});

describe("TripInvite", () => {
  it("accepts a pending invite", () => {
    expect(TripInvite.parse(invite)).toEqual(invite);
  });

  it("accepts an invite with no email — the token is the credential, not the address", () => {
    expect(TripInvite.parse({ ...invite, email: null }).email).toBeNull();
  });

  it("rejects an email that is not one", () => {
    expect(TripInvite.safeParse({ ...invite, email: "not-an-email" }).success).toBe(false);
  });

  it("rejects an empty token", () => {
    expect(TripInvite.safeParse({ ...invite, token: "" }).success).toBe(false);
  });

  it("carries the audit fields an accepted invite fills in", () => {
    const accepted = TripInvite.parse({
      ...invite,
      status: "accepted",
      acceptedBy: "dev-bob",
      acceptedAt: "2026-08-02T00:00:00.000Z",
    });
    expect(accepted.acceptedBy).toBe("dev-bob");
  });
});

describe("CreateInviteInput", () => {
  it("takes an email or an explicit null", () => {
    expect(CreateInviteInput.parse({ email: null, role: "viewer" }).email).toBeNull();
    expect(CreateInviteInput.parse({ email: "a@b.co", role: "editor" }).email).toBe("a@b.co");
  });

  // The client sends null for "no email", so a blank string is a bug worth a
  // 400 rather than a silently stored empty label.
  it("rejects an empty string rather than treating it as no email", () => {
    expect(CreateInviteInput.safeParse({ email: "", role: "viewer" }).success).toBe(false);
  });

  it("rejects an owner invite", () => {
    expect(CreateInviteInput.safeParse({ email: null, role: "owner" }).success).toBe(false);
  });
});

describe("TripAccess", () => {
  const member = { userId: "dev-alice", role: "owner", name: null, email: null, image: null };

  it("round-trips a full access document", () => {
    const access = { tripId, myRole: "owner", members: [member], invites: [invite] };
    expect(TripAccess.parse(access)).toEqual(access);
  });

  it("requires at least one member — a trip always has an owner", () => {
    expect(TripAccess.safeParse({ tripId, myRole: "owner", members: [], invites: [] }).success).toBe(
      false,
    );
  });

  it("allows an empty invite list, which is what a non-owner is served", () => {
    expect(
      TripAccess.parse({ tripId, myRole: "editor", members: [member], invites: [] }).invites,
    ).toEqual([]);
  });

  // TripMember (planning) stays { userId, role }; the profile fields are the
  // Identity join, done in the Access module.
  it("keeps profile fields nullable, so a member with no user row still lists", () => {
    expect(TripMemberProfile.parse(member).name).toBeNull();
  });
});

describe("InvitePreview", () => {
  it("says nothing about who else is on the trip, and echoes no token", () => {
    const preview = InvitePreview.parse({
      tripId,
      tripName: "Kyoto",
      role: "viewer",
      status: "pending",
      invitedByName: null,
      alreadyMember: false,
    });
    expect(Object.keys(preview).sort()).toEqual([
      "alreadyMember",
      "invitedByName",
      "role",
      "status",
      "tripId",
      "tripName",
    ]);
  });
});
