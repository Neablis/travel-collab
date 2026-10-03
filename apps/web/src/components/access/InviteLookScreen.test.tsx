import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InviteLanding } from "@tc/contracts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));

const fetchInviteLandingMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchInviteLanding: (...args: unknown[]) => fetchInviteLandingMock(...args),
  acceptInvite: vi.fn(),
}));

// The banner is what is under test. The board under it is the ordinary trip
// board, tested where it lives; mounting it here would only add its reads.
const { passThrough } = vi.hoisted(() => ({
  passThrough: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/board/TripBoardScreen", () => ({ TripBoardScreen: () => null }));
vi.mock("@/components/trip/context/TripProvider", () => ({ TripProvider: passThrough }));
vi.mock("@/components/trip/context/FocusProvider", () => ({ FocusProvider: passThrough }));
vi.mock("@/components/trip/context/EditorHost", () => ({ EditorHost: passThrough }));
vi.mock("@/components/trip/context/LensRouter", () => ({ LensRouter: passThrough }));

import { InviteLookScreen } from "./InviteLookScreen";

const landing: Extract<InviteLanding, { state: "valid" }> = {
  state: "valid",
  signedIn: false,
  tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
  role: "suggester",
  sentAt: "2026-09-21T10:00:00.000Z",
  recipientEmail: "sam@example.com",
  inviterName: "Dana Reyes",
  trip: { name: "Japan: food and temples", startDate: "2026-10-01", dayCount: 1, cityCount: 1, stopCount: 0 },
  days: [{ city: "Kyoto", stopCount: 0 }],
  legs: [{ city: "Kyoto", dayFrom: 1, dayTo: 1, stopCount: 0, highlights: [] }],
  crew: ["Dana"],
};

afterEach(cleanup);
beforeEach(() => {
  fetchInviteLandingMock.mockReset().mockResolvedValue({ ok: true, value: landing });
});

describe("InviteLookScreen", () => {
  it("tells a suggester that joining lets them suggest changes for approval", async () => {
    render(<InviteLookScreen token="tok" googleAvailable />);
    expect(
      await screen.findByText(
        "You're having a look first. Join and you can suggest changes for the planners to approve.",
      ),
    ).toBeTruthy();
  });
});
