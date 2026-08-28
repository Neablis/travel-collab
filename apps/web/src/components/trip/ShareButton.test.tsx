import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TripShare } from "@tc/contracts";

const fetchTripSharesMock = vi.fn();
const createTripShareMock = vi.fn();
const revokeTripShareMock = vi.fn();

vi.mock("@/lib/apiClient", () => ({
  fetchTripShares: (...args: unknown[]) => fetchTripSharesMock(...args),
  createTripShare: (...args: unknown[]) => createTripShareMock(...args),
  revokeTripShare: (...args: unknown[]) => revokeTripShareMock(...args),
  shareLink: (token: string) => `http://test/s/${token}`,
}));

import { ShareButton } from "./ShareButton";

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

const share: TripShare = {
  shareId: "3c5e7f90-2222-4333-8444-555566667777",
  tripId,
  token: "share-tok",
  seq: 12,
  createdBy: "dev-alice",
  createdAt: "2026-08-01T00:00:00.000Z",
  revokedAt: null,
};

const writeText = vi.fn().mockResolvedValue(undefined);

afterEach(cleanup);
beforeEach(() => {
  fetchTripSharesMock.mockReset().mockResolvedValue({ ok: true, value: [share] });
  createTripShareMock.mockReset().mockResolvedValue({ ok: true, value: { ...share, token: "fresh" } });
  revokeTripShareMock.mockReset().mockResolvedValue({ ok: true, value: { ...share, revokedAt: "now" } });
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});

const openPanel = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Share" }));
  return screen.findByTestId("share-panel");
};

// Real as of M11 link 4. Until then this was an inert
// <Preview id="share-button"> whose own tests asserted it could not be
// clicked; the milestone retired the shell, so those tests are gone with it.
describe("ShareButton", () => {
  it("defaults to the ghost variant (trip header call site)", () => {
    render(<ShareButton tripId={tripId} />);
    expect(screen.getByRole("button", { name: "Share" }).className).toMatch(/text-slate/);
  });

  it("renders the secondary variant when asked (next-trip hero call site)", () => {
    render(<ShareButton tripId={tripId} variant="secondary" />);
    expect(screen.getByRole("button", { name: "Share" }).className).toMatch(/border-border-strong/);
  });

  // The home grid mounts this next to a trip card; a list fetch per render
  // there would be a request nobody asked for on a page mostly not about
  // sharing.
  it("reads nothing until the panel is opened", async () => {
    render(<ShareButton tripId={tripId} />);
    expect(fetchTripSharesMock).not.toHaveBeenCalled();
    await openPanel();
    await waitFor(() => expect(fetchTripSharesMock).toHaveBeenCalledWith(tripId));
  });

  it("says which history point each link is pinned to", async () => {
    render(<ShareButton tripId={tripId} />);
    await openPanel();
    expect(await screen.findByText("Pinned at change 12")).toBeTruthy();
  });

  it("creates a link, copies it, and re-reads the list", async () => {
    render(<ShareButton tripId={tripId} />);
    await openPanel();
    await userEvent.click(screen.getByRole("button", { name: "Create a share link" }));
    await waitFor(() => expect(createTripShareMock).toHaveBeenCalledWith(tripId));
    expect(writeText).toHaveBeenCalledWith("http://test/s/fresh");
    await waitFor(() => expect(fetchTripSharesMock).toHaveBeenCalledTimes(2));
  });

  it("copies an existing link", async () => {
    render(<ShareButton tripId={tripId} />);
    await openPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Copy share link" }));
    expect(writeText).toHaveBeenCalledWith("http://test/s/share-tok");
  });

  it("turns a link off", async () => {
    render(<ShareButton tripId={tripId} />);
    await openPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Turn off share link" }));
    await waitFor(() => expect(revokeTripShareMock).toHaveBeenCalledWith(tripId, share.shareId));
  });

  it("lists only live links — a revoked one is gone, not shown crossed out", async () => {
    fetchTripSharesMock.mockResolvedValue({
      ok: true,
      value: [{ ...share, revokedAt: "2026-08-02T00:00:00.000Z" }],
    });
    render(<ShareButton tripId={tripId} />);
    await openPanel();
    expect(await screen.findByText("No share links yet.")).toBeTruthy();
  });

  // A `title` tooltip is not a delivery mechanism, and copying IS how a share
  // link is sent (CodeRabbit, PR #70).
  it("reveals the link as selectable text when the clipboard is denied", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    render(<ShareButton tripId={tripId} />);
    await openPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Copy share link" }));

    const fallback = await screen.findByLabelText("Share link");
    expect((fallback as HTMLInputElement).value).toBe("http://test/s/share-tok");
    expect(fallback.hasAttribute("readonly")).toBe(true);
    expect(screen.queryByText("denied")).toBeNull();
  });

  it("clears a previous error once a reload succeeds", async () => {
    fetchTripSharesMock
      .mockResolvedValueOnce({ ok: true, value: [share] })
      .mockResolvedValueOnce({ ok: false, error: { status: 500, message: "boom" } })
      .mockResolvedValue({ ok: true, value: [share] });

    render(<ShareButton tripId={tripId} />);
    await openPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Turn off share link" }));
    expect(await screen.findByText("boom")).toBeTruthy();

    await userEvent.click(await screen.findByRole("button", { name: "Turn off share link" }));
    await waitFor(() => expect(screen.queryByText("boom")).toBeNull());
  });

  // The reverse: `load()` clearing the error means a handler that set its own
  // error first would wipe its own message.
  it("still reports a failed revoke, even though the reload after it succeeds", async () => {
    revokeTripShareMock.mockResolvedValue({
      ok: false,
      error: { status: 500, message: "could not turn it off" },
    });
    render(<ShareButton tripId={tripId} />);
    await openPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Turn off share link" }));
    expect(await screen.findByText("could not turn it off")).toBeTruthy();
  });

  it("surfaces a refused create rather than looking like it worked", async () => {
    createTripShareMock.mockResolvedValue({ ok: false, error: { status: 403, message: "forbidden" } });
    render(<ShareButton tripId={tripId} />);
    await openPanel();
    await userEvent.click(screen.getByRole("button", { name: "Create a share link" }));
    expect(await screen.findByText("forbidden")).toBeTruthy();
  });
});
