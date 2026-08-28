import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedTripView } from "@tc/contracts";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

const fetchSharedTripMock = vi.fn();
const cloneSharedTripMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchSharedTrip: (...args: unknown[]) => fetchSharedTripMock(...args),
  cloneSharedTrip: (...args: unknown[]) => cloneSharedTripMock(...args),
}));

import { SharedTripScreen } from "./SharedTripScreen";

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const dayOne = "11111111-1111-4111-8111-111111111111";
const dayTwo = "22222222-2222-4222-8222-222222222222";
const stop = "33333333-3333-4333-8333-333333333333";
const parked = "44444444-4444-4444-8444-444444444444";

function view(overrides: Partial<SharedTripView> = {}): SharedTripView {
  return {
    tripId,
    name: "Kyoto in spring",
    startDate: "2026-04-01",
    currency: "USD",
    budget: null,
    days: [
      { dayId: dayOne, activityIds: [stop], date: "2026-04-01", costSubtotal: 4500 },
      { dayId: dayTwo, activityIds: [], date: "2026-04-02", costSubtotal: 0 },
    ],
    backlog: [parked],
    activities: {
      [stop]: {
        activityId: stop,
        title: "Fushimi Inari",
        timeWindow: { start: "09:00", end: "11:00" },
        location: { name: "Kyoto", lat: 34.96, lng: 135.77 },
        notes: null,
        anchors: [],
        kind: "planned",
        tags: [],
        cost: { amountMinor: 4500, currency: "USD" },
      },
      [parked]: {
        activityId: parked,
        title: "Nishiki Market",
        timeWindow: null,
        location: null,
        notes: null,
        anchors: [],
        kind: "idea",
        tags: [],
        cost: null,
      },
    },
    unscheduledCostSubtotal: 0,
    tripCostTotal: 4500,
    travellerCount: 3,
    seq: 7,
    sharedAt: "2026-03-20T00:00:00.000Z",
    stale: false,
    ...overrides,
  };
}

afterEach(cleanup);
beforeEach(() => {
  pushMock.mockReset();
  fetchSharedTripMock.mockReset().mockResolvedValue({ ok: true, value: view() });
  cloneSharedTripMock.mockReset().mockResolvedValue({ ok: true, value: { tripId: "cloned-id" } });
});

describe("SharedTripScreen", () => {
  it("renders the plan: days, stops, times, places and costs", async () => {
    render(<SharedTripScreen token="tok" />);
    expect(await screen.findByRole("heading", { name: "Kyoto in spring" })).toBeTruthy();
    expect(screen.getByText("Fushimi Inari")).toBeTruthy();
    expect(screen.getByText("Kyoto")).toBeTruthy();
    expect(screen.getByText("3 travellers")).toBeTruthy();
    expect(screen.getByText("2 days")).toBeTruthy();
  });

  it("says a day with nothing on it has nothing on it", async () => {
    render(<SharedTripScreen token="tok" />);
    expect(await screen.findByText("Nothing planned.")).toBeTruthy();
  });

  it("lists what has not been scheduled yet", async () => {
    render(<SharedTripScreen token="tok" />);
    expect(await screen.findByText("Not scheduled yet")).toBeTruthy();
    expect(screen.getByText("Nishiki Market")).toBeTruthy();
  });

  // The whole point of the feature, said out loud on the page.
  it("says what history point it is showing", async () => {
    render(<SharedTripScreen token="tok" />);
    expect(await screen.findByText(/this is the plan as it was then/)).toBeTruthy();
  });

  it("warns when the trip has moved on since the link was made", async () => {
    fetchSharedTripMock.mockResolvedValue({ ok: true, value: view({ stale: true }) });
    render(<SharedTripScreen token="tok" />);
    expect(await screen.findByText(/It has changed since\./)).toBeTruthy();
  });

  it("is marked read-only", async () => {
    render(<SharedTripScreen token="tok" />);
    expect(await screen.findByText("Read only")).toBeTruthy();
  });

  // Read-only by construction: there is no TripProvider and no command client
  // in this subtree, so this asserts the outcome rather than the mechanism.
  // "Make this my trip" is the one button, and it writes to a NEW trip.
  it("offers nothing that would change the trip it is showing", async () => {
    render(<SharedTripScreen token="tok" />);
    await screen.findByText("Fushimi Inari");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Make this my trip"]);
  });

  it("clones the pinned trip and opens the copy", async () => {
    render(<SharedTripScreen token="tok" />);
    await userEvent.click(await screen.findByRole("button", { name: "Make this my trip" }));
    await waitFor(() => expect(cloneSharedTripMock).toHaveBeenCalledWith("tok"));
    expect(pushMock).toHaveBeenCalledWith("/trips/cloned-id");
  });

  // Offered to everyone, because hiding it until you sign in makes the one
  // thing this page is for invisible to exactly the people it is winning over.
  it("sends a signed-out visitor to sign in, and back to this link", async () => {
    cloneSharedTripMock.mockResolvedValue({
      ok: false,
      error: { status: 401, message: "unauthenticated" },
    });
    render(<SharedTripScreen token="tok" />);
    await userEvent.click(await screen.findByRole("button", { name: "Make this my trip" }));
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/signin?callbackUrl=%2Fs%2Ftok"),
    );
  });

  it("reports a clone that failed for any other reason", async () => {
    cloneSharedTripMock.mockResolvedValue({
      ok: false,
      error: { status: 410, message: "This link has been turned off." },
    });
    render(<SharedTripScreen token="tok" />);
    await userEvent.click(await screen.findByRole("button", { name: "Make this my trip" }));
    expect(await screen.findByText("This link has been turned off.")).toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows a way onward when the link is dead rather than a blank page", async () => {
    fetchSharedTripMock.mockResolvedValue({
      ok: false,
      error: { status: 404, message: "No trip is published here yet." },
    });
    render(<SharedTripScreen token="featured" />);
    expect(await screen.findByRole("heading", { name: "Nothing to see here" })).toBeTruthy();
    expect(screen.getByText("No trip is published here yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Start a trip" }).getAttribute("href")).toBe("/signup");
  });
});

// `router.push` does not unmount synchronously, so releasing the busy flag
// before navigating left the button live on a page that is still on screen.
// The cost of that window is not a wasted request — it is a second trip in
// the visitor's list (CodeRabbit, PR #71).
describe("SharedTripScreen clone is single-shot", () => {
  it("does not clone twice when the button is clicked again mid-navigation", async () => {
    fetchSharedTripMock.mockResolvedValue({ ok: true, value: view() });
    cloneSharedTripMock.mockResolvedValue({ ok: true, value: { tripId: "new-trip" } });
    render(<SharedTripScreen token="tok" />);

    const button = await screen.findByRole("button", { name: "Make this my trip" });
    await userEvent.click(button);
    await waitFor(() => expect(pushMock).toHaveBeenCalled());

    // Still mounted, still on the shared page — and the button must not have
    // come back to life.
    expect(button.hasAttribute("disabled")).toBe(true);
    await userEvent.click(button).catch(() => undefined);
    expect(cloneSharedTripMock).toHaveBeenCalledTimes(1);
  });

  // The mirror: a FAILED clone must release the button, or the visitor is
  // stuck looking at an error with no way to retry.
  it("releases the button when the clone fails", async () => {
    fetchSharedTripMock.mockResolvedValue({ ok: true, value: view() });
    cloneSharedTripMock.mockResolvedValue({
      ok: false,
      error: { status: 500, message: "Could not copy this trip." },
    });
    render(<SharedTripScreen token="tok" />);

    const button = await screen.findByRole("button", { name: "Make this my trip" });
    await userEvent.click(button);

    expect(await screen.findByText("Could not copy this trip.")).toBeTruthy();
    expect(button.hasAttribute("disabled")).toBe(false);
  });
});
