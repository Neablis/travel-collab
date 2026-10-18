import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InviteLanding, TripPreview } from "@tc/contracts";

const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: replaceMock }) }));
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));

const fetchInviteLandingMock = vi.fn();
const fetchInvitePreviewMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchInviteLanding: (...args: unknown[]) => fetchInviteLandingMock(...args),
  fetchInvitePreview: (...args: unknown[]) => fetchInvitePreviewMock(...args),
  acceptInvite: vi.fn(),
}));

vi.mock("@/components/playbooks/SharedDayMap", () => ({ SharedDayMap: () => null }));

import { InviteLookScreen } from "./InviteLookScreen";

const landing: Extract<InviteLanding, { state: "valid" }> = {
  state: "valid",
  signedIn: false,
  tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
  role: "suggester",
  sentAt: "2026-09-21T10:00:00.000Z",
  recipientEmail: "sam@example.com",
  inviterName: "Dana Reyes",
  trip: { name: "Japan: food and temples", startDate: "2026-10-01", dayCount: 1, cityCount: 1, stopCount: 1 },
  days: [{ city: "Kyoto", stopCount: 1 }],
  legs: [{ city: "Kyoto", dayFrom: 1, dayTo: 1, stopCount: 1, highlights: [] }],
  crew: ["Dana"],
};

const preview: TripPreview = {
  name: "Japan: food and temples",
  startDate: "2026-10-01",
  endDate: "2026-10-01",
  days: [{ date: "2026-10-01", city: "Kyoto", stops: [{ title: "Fushimi Inari", location: { name: "Fushimi Inari", city: "Kyoto" } }] }],
  people: [{ name: "Dana Reyes", avatar: null, color: "sky", colorShifted: false, travelling: true }],
  total: { amountMinor: 4_500, currency: "USD" },
  description: null,
};

afterEach(cleanup);
beforeEach(() => {
  replaceMock.mockReset();
  fetchInviteLandingMock.mockReset().mockResolvedValue({ ok: true, value: landing });
  fetchInvitePreviewMock.mockReset().mockResolvedValue({ ok: true, value: preview });
});

describe("InviteLookScreen", () => {
  it("tells a suggester that joining lets them suggest changes for approval", async () => {
    render(<InviteLookScreen token="tok" googleAvailable />);
    expect(
      await screen.findByText(
        "You're having a look first. Join and you can suggest changes for the trip's planners to approve.",
      ),
    ).toBeTruthy();
  });

  // Trips have no voting or commenting (Mitchell, 2026-10-11).
  it("tells an editor that joining lets them change the stops, and nothing unbuilt", async () => {
    fetchInviteLandingMock.mockResolvedValue({ ok: true, value: { ...landing, role: "editor" } });
    render(<InviteLookScreen token="tok" googleAvailable />);
    expect(
      await screen.findByText(
        "You're having a look first. Join and you can add, move and change stops alongside everyone else.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/\bvot(e|es|ing)\b|\bcomment/i)).toBeNull();
  });

  it("shows the landing's plan card, with the trip's total, under the banner's Join", async () => {
    render(<InviteLookScreen token="tok" googleAvailable />);
    const plan = await screen.findByRole("region", { name: "The plan so far" });
    expect(plan.textContent).toContain("The trip so far comes to $45.00.");
    expect(screen.getByRole("button", { name: "Join the trip" })).toBeTruthy();
  });

  it("says it is opening the invite while the reads resolve", () => {
    fetchInviteLandingMock.mockReturnValue(new Promise(() => {}));
    render(<InviteLookScreen token="tok" googleAvailable />);
    expect(within(screen.getByRole("main")).getByText("Opening this invite…")).toBeTruthy();
  });

  // The banner is the page's subject: its line is the one `h1`, and it sits
  // inside the one <main> with the plan card rather than above it.
  it("heads the page with the banner's line, inside the main landmark", async () => {
    render(<InviteLookScreen token="tok" googleAvailable />);
    const main = await screen.findByRole("main");
    expect(within(main).getByRole("heading", { level: 1, name: "Dana Reyes invited you to plan this trip" })).toBeTruthy();
    expect(within(main).getByRole("button", { name: "Join the trip" })).toBeTruthy();
  });

  // As on the landing: the preview is the picture, not the invite.
  it("keeps the banner's Join when the trip's preview cannot be read", async () => {
    fetchInvitePreviewMock.mockResolvedValue({ ok: false, error: { status: 0, message: "Network error" } });
    render(<InviteLookScreen token="tok" googleAvailable />);
    expect(await screen.findByRole("button", { name: "Join the trip" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "The plan so far" })).toBeNull();
  });

  it("sends a holder whose invite is no longer pending back to the landing", async () => {
    fetchInviteLandingMock.mockResolvedValue({ ok: true, value: { state: "revoked", signedIn: false } });
    render(<InviteLookScreen token="tok" googleAvailable />);
    await vi.waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/invite/tok"));
    expect(screen.queryByRole("region", { name: "The plan so far" })).toBeNull();
  });
});
