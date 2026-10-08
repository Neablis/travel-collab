import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InviteLanding, TripPreview } from "@tc/contracts";
import { rememberInviteJoin, takeJoinedToast } from "@/lib/pendingInviteJoin";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

const signInMock = vi.fn();
vi.mock("next-auth/react", () => ({ signIn: (...args: unknown[]) => signInMock(...args) }));

const fetchInviteLandingMock = vi.fn();
const fetchInvitePreviewMock = vi.fn();
const acceptInviteMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchInviteLanding: (...args: unknown[]) => fetchInviteLandingMock(...args),
  fetchInvitePreview: (...args: unknown[]) => fetchInvitePreviewMock(...args),
  acceptInvite: (...args: unknown[]) => acceptInviteMock(...args),
}));

// The countdown reads the reader's day; a fixed one keeps "in 5 days" true.
vi.mock("@/lib/today", () => ({ useToday: () => "2026-09-26" }));

// The map is MapLibre, tested where it lives; what this file owns is that the
// preview's stops reach it.
vi.mock("@/components/playbooks/SharedDayMap", () => ({
  SharedDayMap: ({ days }: { days: { stops: unknown[] }[] }) => (
    <div role="img" aria-label={`Map of ${days.flatMap((d) => d.stops).length} stops`} />
  ),
}));

import { InviteLandingScreen } from "./InviteLandingScreen";

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

function valid(overrides: Partial<Extract<InviteLanding, { state: "valid" }>> = {}): InviteLanding {
  return {
    state: "valid",
    signedIn: false,
    tripId,
    role: "editor",
    sentAt: "2026-09-21T10:00:00.000Z",
    recipientEmail: "sam@example.com",
    inviterName: "Dana Reyes",
    trip: { name: "Japan: food and temples", startDate: "2026-10-01", dayCount: 3, cityCount: 2, stopCount: 4 },
    days: [
      { city: "Kyoto", stopCount: 2 },
      { city: "Kyoto", stopCount: 0 },
      { city: "Osaka", stopCount: 2 },
    ],
    legs: [
      { city: "Kyoto", dayFrom: 1, dayTo: 2, stopCount: 2, highlights: ["Fushimi Inari"] },
      { city: "Osaka", dayFrom: 3, dayTo: 3, stopCount: 2, highlights: [] },
    ],
    crew: ["Dana", "Mei"],
    ...overrides,
  };
}

// What the token-scoped read answers for the same trip (M38 D4): the route,
// the people as personas, and one amount, the trip's total.
const preview: TripPreview = {
  name: "Japan: food and temples",
  startDate: "2026-10-01",
  endDate: "2026-10-03",
  days: [
    {
      date: "2026-10-01",
      city: "Kyoto",
      stops: [
        { title: "Fushimi Inari", location: { name: "Fushimi Inari", city: "Kyoto", lat: 34.9671, lng: 135.7727 } },
        { title: "Nishiki Market", location: { name: "Nishiki Market", city: "Kyoto", lat: 35.005, lng: 135.7649 } },
      ],
    },
    {
      date: "2026-10-02",
      city: "Kyoto",
      stops: [{ title: "Kinkaku-ji", location: { name: "Kinkaku-ji", city: "Kyoto", lat: 35.0394, lng: 135.7292 } }],
    },
    {
      date: "2026-10-03",
      city: "Osaka",
      stops: [
        { title: "Dotonbori", location: { name: "Dotonbori", city: "Osaka", lat: 34.6687, lng: 135.5013 } },
        { title: "Osaka Castle", location: { name: "Osaka Castle", city: "Osaka", lat: 34.6873, lng: 135.5262 } },
      ],
    },
  ],
  people: [
    { name: "Dana Reyes", avatar: "compass", color: "sky", colorShifted: false, travelling: true },
    { name: "Mei Lin", avatar: null, color: "rose", colorShifted: false, travelling: true },
    { name: "Kenji", avatar: null, color: "teal", colorShifted: false, travelling: false },
  ],
  total: { amountMinor: 123_450, currency: "USD" },
};

const answer = (landing: InviteLanding) => ({ ok: true, value: landing });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  pushMock.mockReset();
  signInMock.mockReset();
  fetchInviteLandingMock.mockReset().mockResolvedValue(answer(valid()));
  fetchInvitePreviewMock.mockReset().mockResolvedValue({ ok: true, value: preview });
  acceptInviteMock.mockReset().mockResolvedValue({ ok: true, value: { tripId } });
  // The signed-out Join re-banks the admission cookie with a HEAD of the page.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null)));
});

describe("InviteLandingScreen — a pending invite", () => {
  it("tells a signed-out stranger who asked and what the trip is, and offers a look", async () => {
    render(<InviteLandingScreen token="tok" googleAvailable />);
    expect(await screen.findByRole("heading", { level: 1, name: "Japan: food and temples" })).toBeTruthy();
    expect(screen.getByText("Dana Reyes invited you")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Have a look first" }).getAttribute("href")).toBe("/invite/tok/look");
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
  });

  // The fixed set (D5), each drawn by the notebook's widget from the preview.
  it("shows the trip before joining: the countdown, who's going, and the plan card", async () => {
    render(<InviteLandingScreen token="tok" googleAvailable />);
    expect(await screen.findByText("in 5 days")).toBeTruthy();
    // `trip.people`: who is travelling, with the owner — not who only plans.
    expect(screen.getByText("Mei is going with Dana.")).toBeTruthy();

    const plan = screen.getByRole("region", { name: "The plan so far" });
    // `trip.strip`, named by its runs.
    expect(within(plan).getByRole("img", { name: "Days 1–2 Kyoto (Oct 1 – Oct 2), day 3 Osaka (Oct 3)" })).toBeTruthy();
    // `city.rows`: a line per city, its days and its stops.
    expect(
      within(plan)
        .getAllByRole("row")
        .map((row) => [within(row).getByRole("rowheader"), ...within(row).getAllByRole("cell")].map((c) => c.textContent)),
    ).toEqual([
      ["Kyoto", "Day 1, Day 2", "3 stops"],
      ["Osaka", "Day 3", "2 stops"],
    ]);
    // The map, over every stop the preview carries.
    expect(within(plan).getByRole("img", { name: "Map of 5 stops" })).toBeTruthy();
    // `cost`: the trip's total, in a sentence.
    expect(within(plan).getByText(/^The trip so far comes to/).textContent).toBe("The trip so far comes to $1,234.50.");
  });

  // D4: the total is the only money a stranger sees.
  it("shows no amount but the trip's total — nothing per person, nothing per stop", async () => {
    render(<InviteLandingScreen token="tok" googleAvailable />);
    await screen.findByRole("region", { name: "The plan so far" });
    expect(document.body.textContent?.match(/\$[\d,]+(\.\d+)?/g)).toEqual(["$1,234.50"]);
    // `person.share`'s sentence, which an amount would follow.
    expect(screen.queryByText(/is in for [$\d]/)).toBeNull();
    expect(screen.getByText("What each person is in for, and what each stop costs, show once you join.")).toBeTruthy();
  });

  it("does not promise a viewer that they can change anything", async () => {
    fetchInviteLandingMock.mockResolvedValue(answer(valid({ role: "viewer" })));
    render(<InviteLandingScreen token="tok" googleAvailable />);
    expect(await screen.findByText(/You'll be able to look, but not change anything\./)).toBeTruthy();
    expect(screen.queryByText(/You can add stops/)).toBeNull();
  });

  it("tells a suggester their changes go to the trip's planners for approval", async () => {
    fetchInviteLandingMock.mockResolvedValue(answer(valid({ role: "suggester" })));
    render(<InviteLandingScreen token="tok" googleAvailable />);
    expect(await screen.findByText(/You can suggest stops and changes for the trip's planners to approve\./)).toBeTruthy();
    expect(screen.queryByText(/You can add stops/)).toBeNull();
  });

  it("signed out, Join banks the intent and leaves for Google with the landing as the way back", async () => {
    const user = userEvent.setup();
    render(<InviteLandingScreen token="tok" googleAvailable />);
    await user.click(await screen.findByRole("button", { name: "Join with Google" }));

    await waitFor(() => expect(signInMock).toHaveBeenCalledWith("google", { callbackUrl: "/invite/tok" }));
    expect(acceptInviteMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("pending_invite_join")).toContain('"token":"tok"');
  });

  it("signed out with no Google provider, Join goes through the sign-in screen instead", async () => {
    const user = userEvent.setup();
    render(<InviteLandingScreen token="tok" googleAvailable={false} />);
    await user.click(await screen.findByRole("button", { name: "Sign in to join" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/signin?callbackUrl=%2Finvite%2Ftok"));
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("signed in, Join accepts, owes the trip its toast, and lands on the trip", async () => {
    fetchInviteLandingMock.mockResolvedValue(answer(valid({ signedIn: true })));
    const user = userEvent.setup();
    render(<InviteLandingScreen token="tok" googleAvailable />);
    await user.click(await screen.findByRole("button", { name: "Join the trip" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/trips/${tripId}`));
    expect(acceptInviteMock).toHaveBeenCalledWith("tok");
    expect(takeJoinedToast(tripId)).toBe("Dana");
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });

  // SPEC §35.10's undrawn state: the account exists, the membership does not.
  it("keeps the landing and a working Join when the accept fails after sign-in", async () => {
    fetchInviteLandingMock.mockResolvedValue(answer(valid({ signedIn: true })));
    acceptInviteMock.mockResolvedValueOnce({ ok: false, error: { status: 0, message: "Network error" } });
    const user = userEvent.setup();
    render(<InviteLandingScreen token="tok" googleAvailable />);
    await user.click(await screen.findByRole("button", { name: "Join the trip" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Network error");
    expect(pushMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Join the trip" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/trips/${tripId}`));
    expect(acceptInviteMock).toHaveBeenCalledTimes(2);
  });

  it("finishes a Join pressed before sign-in, once, and only for the invite it was pressed on", async () => {
    fetchInviteLandingMock.mockResolvedValue(answer(valid({ signedIn: true })));
    rememberInviteJoin("tok");
    render(<InviteLandingScreen token="tok" googleAvailable />);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/trips/${tripId}`));
    expect(acceptInviteMock).toHaveBeenCalledTimes(1);
    cleanup();

    acceptInviteMock.mockClear();
    rememberInviteJoin("a-different-token");
    render(<InviteLandingScreen token="tok" googleAvailable />);
    await screen.findByRole("button", { name: "Join the trip" });
    expect(acceptInviteMock).not.toHaveBeenCalled();
  });
});

describe("InviteLandingScreen — every other state", () => {
  it("says a revoked invite was taken back, offers no Join, and names nothing", async () => {
    fetchInviteLandingMock.mockResolvedValue(answer({ state: "revoked", signedIn: false }));
    render(<InviteLandingScreen token="tok" googleAvailable />);
    expect(await screen.findByRole("heading", { level: 1, name: "This invite was taken back" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Join/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.getByRole("link", { name: "What is Caesura?" }).getAttribute("href")).toBe("/welcome");    // Only a pending invite has a preview to read.
    expect(fetchInvitePreviewMock).not.toHaveBeenCalled();
  });

  // The server answers `member` for ANY current member — the owner opening
  // their own link included — so the copy may not claim this link was used.
  it("sends a member back into their trip, by its short name", async () => {
    fetchInviteLandingMock.mockResolvedValue(
      answer({ state: "member", signedIn: true, tripId, tripName: "Japan: food and temples" }),
    );
    render(<InviteLandingScreen token="tok" googleAvailable />);
    expect((await screen.findByRole("link", { name: "Open Japan" })).getAttribute("href")).toBe(`/trips/${tripId}`);
    expect(screen.getByRole("heading", { level: 1, name: "You're already on this trip" })).toBeTruthy();
    expect(
      screen.getByText("You're already a member, so there's nothing to join. Everything on it is where you left it."),
    ).toBeTruthy();
  });

  it("shows the server's reason for an unavailable link", async () => {
    fetchInviteLandingMock.mockResolvedValue(
      answer({ state: "unavailable", signedIn: false, message: "This invite has already been used." }),
    );
    render(<InviteLandingScreen token="tok" googleAvailable />);
    expect(await screen.findByText("This invite has already been used.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Join/ })).toBeNull();
  });

  // The preview is the trip's picture, not the invite. With it unread the
  // invite still says who asked and what for, and Join still works; the retry
  // re-reads the plan alone.
  it("keeps the invite and its Join when the trip's preview cannot be read, and retries just the plan", async () => {
    fetchInvitePreviewMock.mockResolvedValue({ ok: false, error: { status: 0, message: "Network error" } });
    const user = userEvent.setup();
    render(<InviteLandingScreen token="tok" googleAvailable />);
    expect(await screen.findByRole("button", { name: "Join with Google" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Japan: food and temples" })).toBeTruthy();
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.queryByRole("region", { name: "The plan so far" })).toBeNull();

    fetchInvitePreviewMock.mockResolvedValue({ ok: true, value: preview });
    await user.click(retry);
    expect(await screen.findByRole("region", { name: "The plan so far" })).toBeTruthy();
    expect(fetchInviteLandingMock).toHaveBeenCalledTimes(1);
  });

  // SPEC §35.10's other undrawn state: the landing read itself failing.
  it("offers a retry when the invite could not be read, and recovers", async () => {
    fetchInviteLandingMock.mockResolvedValueOnce({ ok: false, error: { status: 0, message: "Network error" } });
    const user = userEvent.setup();
    render(<InviteLandingScreen token="tok" googleAvailable />);
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Japan: food and temples" })).toBeTruthy();
  });
});
