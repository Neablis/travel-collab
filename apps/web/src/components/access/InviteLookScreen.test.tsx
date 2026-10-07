import { cleanup, render, screen } from "@testing-library/react";
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

// The board prints every stop's cost, which D4 hides before joining (M38). It
// is a marker here so that mounting it again is a failure, not a quiet extra.
vi.mock("@/components/board/TripBoardScreen", () => ({ TripBoardScreen: () => <div data-testid="trip-board" /> }));

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

  it("shows the landing's plan card, with the trip's total, and not the board", async () => {
    render(<InviteLookScreen token="tok" googleAvailable />);
    const plan = await screen.findByRole("region", { name: "The plan so far" });
    expect(plan.textContent).toContain("The trip so far comes to $45.00.");
    expect(screen.queryByTestId("trip-board")).toBeNull();
    expect(screen.getByRole("button", { name: "Join the trip" })).toBeTruthy();
  });

  it("sends a holder whose invite is no longer pending back to the landing", async () => {
    fetchInviteLandingMock.mockResolvedValue({ ok: true, value: { state: "revoked", signedIn: false } });
    render(<InviteLookScreen token="tok" googleAvailable />);
    await vi.waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/invite/tok"));
    expect(screen.queryByRole("region", { name: "The plan so far" })).toBeNull();
  });
});
