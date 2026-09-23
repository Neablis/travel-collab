import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InviteLanding } from "@tc/contracts";
import { rememberInviteJoin, takeJoinedToast } from "@/lib/pendingInviteJoin";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

const signInMock = vi.fn();
vi.mock("next-auth/react", () => ({ signIn: (...args: unknown[]) => signInMock(...args) }));

const fetchInviteLandingMock = vi.fn();
const acceptInviteMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchInviteLanding: (...args: unknown[]) => fetchInviteLandingMock(...args),
  acceptInvite: (...args: unknown[]) => acceptInviteMock(...args),
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
    // The plan card: one row per leg, and an empty leg is not given a highlight.
    expect(within(screen.getByRole("list", { name: "Legs of the trip" })).getAllByRole("listitem")).toHaveLength(2);
  });

  it("does not promise a viewer that they can change anything", async () => {
    fetchInviteLandingMock.mockResolvedValue(answer(valid({ role: "viewer" })));
    render(<InviteLandingScreen token="tok" googleAvailable />);
    expect(await screen.findByText(/You'll be able to look, but not change anything\./)).toBeTruthy();
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
    expect(screen.getByRole("link", { name: "What is Caesura?" }).getAttribute("href")).toBe("/welcome");
  });

  it("sends a member back into their trip, by its short name", async () => {
    fetchInviteLandingMock.mockResolvedValue(
      answer({ state: "member", signedIn: true, tripId, tripName: "Japan: food and temples" }),
    );
    render(<InviteLandingScreen token="tok" googleAvailable />);
    expect((await screen.findByRole("link", { name: "Open Japan" })).getAttribute("href")).toBe(`/trips/${tripId}`);
  });

  it("shows the server's reason for an unavailable link", async () => {
    fetchInviteLandingMock.mockResolvedValue(
      answer({ state: "unavailable", signedIn: false, message: "This invite has already been used." }),
    );
    render(<InviteLandingScreen token="tok" googleAvailable />);
    expect(await screen.findByText("This invite has already been used.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Join/ })).toBeNull();
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
