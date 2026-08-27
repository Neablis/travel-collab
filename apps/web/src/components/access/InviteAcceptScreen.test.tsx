import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvitePreview } from "@tc/contracts";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

const fetchInvitePreviewMock = vi.fn();
const acceptInviteMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchInvitePreview: (...args: unknown[]) => fetchInvitePreviewMock(...args),
  acceptInvite: (...args: unknown[]) => acceptInviteMock(...args),
}));

import { InviteAcceptScreen } from "./InviteAcceptScreen";

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

function preview(overrides: Partial<InvitePreview> = {}): InvitePreview {
  return {
    tripId,
    tripName: "Kyoto in spring",
    role: "editor",
    status: "pending",
    invitedByName: "Alice",
    alreadyMember: false,
    ...overrides,
  };
}

afterEach(cleanup);
beforeEach(() => {
  pushMock.mockReset();
  fetchInvitePreviewMock.mockReset().mockResolvedValue({ ok: true, value: preview() });
  acceptInviteMock.mockReset().mockResolvedValue({ ok: true, value: { tripId } });
});

describe("InviteAcceptScreen", () => {
  it("names the trip, the inviter, and what the role lets you do", async () => {
    render(<InviteAcceptScreen token="tok" />);
    expect(await screen.findByRole("heading", { name: "Kyoto in spring" })).toBeTruthy();
    expect(screen.getByText("Alice invited you to this trip.")).toBeTruthy();
    expect(screen.getByText("You'll be able to change the plan.")).toBeTruthy();
  });

  it("says plainly that a viewer cannot change anything", async () => {
    fetchInvitePreviewMock.mockResolvedValue({ ok: true, value: preview({ role: "viewer" }) });
    render(<InviteAcceptScreen token="tok" />);
    expect(await screen.findByText("You'll be able to look, but not change anything.")).toBeTruthy();
  });

  it("copes with an inviter Identity has no name for", async () => {
    fetchInvitePreviewMock.mockResolvedValue({ ok: true, value: preview({ invitedByName: null }) });
    render(<InviteAcceptScreen token="tok" />);
    expect(await screen.findByText("You've been invited to this trip.")).toBeTruthy();
  });

  it("joins and lands on the trip", async () => {
    render(<InviteAcceptScreen token="tok" />);
    await userEvent.click(await screen.findByRole("button", { name: "Join this trip" }));
    await waitFor(() => expect(acceptInviteMock).toHaveBeenCalledWith("tok"));
    expect(pushMock).toHaveBeenCalledWith(`/trips/${tripId}`);
  });

  // Following your own link twice is not an error from where you are standing.
  it("offers to open the trip when you are already on it", async () => {
    fetchInvitePreviewMock.mockResolvedValue({
      ok: true,
      value: preview({ alreadyMember: true, status: "accepted" }),
    });
    render(<InviteAcceptScreen token="tok" />);
    await userEvent.click(await screen.findByRole("button", { name: "Open the trip" }));
    expect(pushMock).toHaveBeenCalledWith(`/trips/${tripId}`);
    expect(acceptInviteMock).not.toHaveBeenCalled();
  });

  it("says a spent link is spent, and offers no button", async () => {
    fetchInvitePreviewMock.mockResolvedValue({ ok: true, value: preview({ status: "accepted" }) });
    render(<InviteAcceptScreen token="tok" />);
    expect(await screen.findByText("This invite has already been used.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Join this trip" })).toBeNull();
  });

  it("says a revoked link is revoked", async () => {
    fetchInvitePreviewMock.mockResolvedValue({ ok: true, value: preview({ status: "revoked" }) });
    render(<InviteAcceptScreen token="tok" />);
    expect(await screen.findByText("This invite has been revoked.")).toBeTruthy();
  });

  it("shows a dead end for an invalid token, with a way out", async () => {
    fetchInvitePreviewMock.mockResolvedValue({
      ok: false,
      error: { status: 404, message: "This invite link is not valid." },
    });
    render(<InviteAcceptScreen token="nope" />);
    expect(await screen.findByRole("heading", { name: /doesn't work/i })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Go to your trips" }));
    expect(pushMock).toHaveBeenCalledWith("/");
  });

  // A join that loses the race re-reads, because "already used" changes what
  // the screen should be offering.
  it("re-reads the invite when joining fails", async () => {
    acceptInviteMock.mockResolvedValue({
      ok: false,
      error: { status: 410, message: "This invite has already been used." },
    });
    render(<InviteAcceptScreen token="tok" />);
    await userEvent.click(await screen.findByRole("button", { name: "Join this trip" }));
    await waitFor(() => expect(fetchInvitePreviewMock).toHaveBeenCalledTimes(2));
    expect(pushMock).not.toHaveBeenCalled();
  });
});
