import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TripAccess, TripInvite } from "@tc/contracts";

const fetchTripAccessMock = vi.fn();
const createTripInviteMock = vi.fn();
const revokeTripInviteMock = vi.fn();

vi.mock("@/lib/apiClient", () => ({
  fetchTripAccess: (...args: unknown[]) => fetchTripAccessMock(...args),
  createTripInvite: (...args: unknown[]) => createTripInviteMock(...args),
  revokeTripInvite: (...args: unknown[]) => revokeTripInviteMock(...args),
  inviteLink: (token: string) => `http://test/invite/${token}`,
}));

import { TravelersPanel } from "./TravelersPanel";

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

const invite: TripInvite = {
  inviteId: "1b3d5f70-1111-4222-8333-444455556666",
  tripId,
  // Deliberately a different address from any member's below, so an
  // assertion about the member list cannot accidentally match the invite row.
  email: "cara@example.com",
  role: "viewer",
  status: "pending",
  token: "tok-123",
  invitedBy: "dev-alice",
  createdAt: "2026-08-01T00:00:00.000Z",
  acceptedBy: null,
  acceptedAt: null,
  revokedAt: null,
};

function access(overrides: Partial<TripAccess> = {}): TripAccess {
  return {
    tripId,
    myRole: "owner",
    members: [
      { userId: "dev-alice", role: "owner", name: "Alice", email: null, image: null },
      { userId: "dev-bob", role: "editor", name: null, email: "bob@example.com", image: null },
    ],
    invites: [invite],
    ...overrides,
  };
}

const writeText = vi.fn().mockResolvedValue(undefined);

afterEach(cleanup);
beforeEach(() => {
  fetchTripAccessMock.mockReset().mockResolvedValue({ ok: true, value: access() });
  createTripInviteMock.mockReset();
  revokeTripInviteMock.mockReset().mockResolvedValue({ ok: true, value: { ...invite, status: "revoked" } });
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});

describe("TravelersPanel", () => {
  it("names each traveller by the best thing it knows and badges their role", async () => {
    render(<TravelersPanel tripId={tripId} />);
    // Identity's name wins; an email stands in when there is no name.
    expect(await screen.findByText("Alice")).toBeTruthy();
    expect(screen.getByText("bob@example.com")).toBeTruthy();
    expect(screen.getByText("owner")).toBeTruthy();
    expect(screen.getByText("editor")).toBeTruthy();
    // …and the outstanding invite is listed by the address it was sent to.
    expect(screen.getByText("cara@example.com")).toBeTruthy();
  });

  it("falls back to the bare user id when Identity knows nothing", async () => {
    fetchTripAccessMock.mockResolvedValue({
      ok: true,
      value: access({
        members: [{ userId: "dev-carol", role: "owner", name: null, email: null, image: null }],
        invites: [],
      }),
    });
    render(<TravelersPanel tripId={tripId} />);
    expect(await screen.findByText("dev-carol")).toBeTruthy();
  });

  it("creates an invite with the chosen role and copies the link", async () => {
    createTripInviteMock.mockResolvedValue({ ok: true, value: { ...invite, token: "fresh" } });
    render(<TravelersPanel tripId={tripId} />);
    await screen.findByText("Alice");

    await userEvent.type(screen.getByLabelText("Invite by email"), "cara@example.com");
    await userEvent.selectOptions(screen.getByLabelText("Invite role"), "viewer");
    await userEvent.click(screen.getByRole("button", { name: "Invite someone" }));

    await waitFor(() =>
      expect(createTripInviteMock).toHaveBeenCalledWith(tripId, {
        email: "cara@example.com",
        role: "viewer",
      }),
    );
    // Copying is what actually delivers the invite — nothing emails it.
    expect(writeText).toHaveBeenCalledWith("http://test/invite/fresh");
  });

  it("sends null, not an empty string, when no email is typed", async () => {
    createTripInviteMock.mockResolvedValue({ ok: true, value: invite });
    render(<TravelersPanel tripId={tripId} />);
    await screen.findByText("Alice");
    await userEvent.click(screen.getByRole("button", { name: "Invite someone" }));
    await waitFor(() =>
      expect(createTripInviteMock).toHaveBeenCalledWith(tripId, { email: null, role: "editor" }),
    );
  });

  it("copies an outstanding invite's link and says so", async () => {
    render(<TravelersPanel tripId={tripId} />);
    await userEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith("http://test/invite/tok-123");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("revokes an invite and re-reads the list", async () => {
    render(<TravelersPanel tripId={tripId} />);
    await userEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(revokeTripInviteMock).toHaveBeenCalledWith(tripId, invite.inviteId));
    expect(fetchTripAccessMock).toHaveBeenCalledTimes(2);
  });

  // The invite list carries tokens, so a non-owner must not see the controls
  // at all — the server refuses them too (access/route.int.test.ts).
  it("offers no invite controls to a non-owner", async () => {
    fetchTripAccessMock.mockResolvedValue({
      ok: true,
      value: access({ myRole: "editor", invites: [] }),
    });
    render(<TravelersPanel tripId={tripId} />);
    await screen.findByText("Alice");
    expect(screen.queryByRole("button", { name: "Invite someone" })).toBeNull();
    expect(screen.queryByLabelText("Invite by email")).toBeNull();
  });

  it("surfaces a failed invite rather than looking like it worked", async () => {
    createTripInviteMock.mockResolvedValue({
      ok: false,
      error: { status: 403, message: "forbidden" },
    });
    render(<TravelersPanel tripId={tripId} />);
    await screen.findByText("Alice");
    await userEvent.click(screen.getByRole("button", { name: "Invite someone" }));
    expect(await screen.findByText("forbidden")).toBeTruthy();
  });

  // A blocked clipboard permission is not worth a red banner: the link is
  // still on screen (title attribute) and still works.
  it("does not report an error when the clipboard is denied", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    render(<TravelersPanel tripId={tripId} />);
    await userEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    expect(screen.queryByText("denied")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
  });
});
