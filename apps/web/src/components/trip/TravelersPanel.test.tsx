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

  // The accessible name is stable while the visible label flips, because
  // creating an invite copies it immediately — see the comment on the button.
  it("copies an outstanding invite's link and says so", async () => {
    render(<TravelersPanel tripId={tripId} />);
    const copy = await screen.findByRole("button", { name: "Copy invite link" });
    expect(copy.textContent).toBe("Copy link");
    await userEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith("http://test/invite/tok-123");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copy invite link" }).textContent).toBe("Copied"),
    );
  });

  it("revokes an invite and re-reads the list", async () => {
    render(<TravelersPanel tripId={tripId} />);
    await userEvent.click(await screen.findByRole("button", { name: "Revoke invite" }));
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

  // A blocked clipboard permission is not worth a red banner — but it does
  // need a way out. A `title` tooltip is not one: unreachable by keyboard and
  // on touch, which would leave the owner unable to send the invite at all
  // (CodeRabbit, PR #70).
  it("reveals the link as selectable text when the clipboard is denied", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    render(<TravelersPanel tripId={tripId} />);
    await userEvent.click(await screen.findByRole("button", { name: "Copy invite link" }));

    expect(screen.queryByText("denied")).toBeNull();
    const fallback = await screen.findByLabelText("Invite link");
    expect((fallback as HTMLInputElement).value).toBe("http://test/invite/tok-123");
    expect(fallback.hasAttribute("readonly")).toBe(true);
    expect(screen.getByRole("button", { name: "Copy invite link" }).textContent).toBe("Copy link");
  });

  it("hides the fallback again once a copy succeeds", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    render(<TravelersPanel tripId={tripId} />);
    const copy = await screen.findByRole("button", { name: "Copy invite link" });
    await userEvent.click(copy);
    expect(await screen.findByLabelText("Invite link")).toBeTruthy();

    await userEvent.click(copy);
    await waitFor(() => expect(screen.queryByLabelText("Invite link")).toBeNull());
  });

  // A retry that worked must not leave the previous failure sitting next to
  // fresh, correct data. Reached through two revokes, because a panel whose
  // FIRST read failed renders nothing to act on — see the note below.
  it("clears a previous error once a reload succeeds", async () => {
    fetchTripAccessMock
      .mockResolvedValueOnce({ ok: true, value: access() })
      .mockResolvedValueOnce({ ok: false, error: { status: 500, message: "boom" } })
      .mockResolvedValue({ ok: true, value: access() });

    render(<TravelersPanel tripId={tripId} />);
    await userEvent.click(await screen.findByRole("button", { name: "Revoke invite" }));
    expect(await screen.findByText("boom")).toBeTruthy();

    await userEvent.click(await screen.findByRole("button", { name: "Revoke invite" }));
    await waitFor(() => expect(screen.queryByText("boom")).toBeNull());
  });

  // The reverse, which the fix above could easily have broken: `load()` clears
  // the error on success, so a handler that set its own error BEFORE reloading
  // would wipe its own message and a failed revoke would look like a success.
  it("still reports a failed revoke, even though the reload after it succeeds", async () => {
    revokeTripInviteMock.mockResolvedValue({
      ok: false,
      error: { status: 500, message: "could not revoke" },
    });
    render(<TravelersPanel tripId={tripId} />);
    await userEvent.click(await screen.findByRole("button", { name: "Revoke invite" }));
    expect(await screen.findByText("could not revoke")).toBeTruthy();
  });
});
