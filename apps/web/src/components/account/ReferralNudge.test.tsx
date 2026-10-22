import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReferralNudge } from "./ReferralNudge";

// A failed or refused mint changes only text beside the button, whose name
// stays "Copy referral link": unless that text is in a live region, a screen
// reader user presses Copy and hears nothing either way.

function serveMint(status: number, codes: { code: string; redeemed: boolean }[] = [], earnsReward = true) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? new Response(JSON.stringify({ error: "nope" }), { status })
      : new Response(JSON.stringify({ codes, earnsReward }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const writeText = vi.fn();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReferralNudge", () => {
  // Test-pruning: this is the owner layer for the earns-nothing render
  // state. The Share panel and the invite dialog used to each carry their
  // own copy of this assertion; they now keep only a wiring test each,
  // and the gating itself lives here (logic) plus useReferralLink.test.tsx
  // (the earns flag). The nudge renders null both before the server
  // answers and when it answers earnsReward: false, so the wait for the
  // fetch call plus the act flush is what makes this absence meaningful
  // rather than vacuous: a fetch that never happened fails the wait, and
  // a true earnsReward would render the button after the flush.
  it("renders nothing new when the server says the account earns nothing", async () => {
    const fetchMock = serveMint(200, [], false);
    render(<ReferralNudge />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/account/referrals"));
    // Let the answer land before asserting that it changed nothing (the
    // same pattern the Share panel and invite dialog used for this wait).
    await act(async () => {
      await fetchMock.mock.results[0]?.value;
    });
    expect(screen.queryByRole("button", { name: "Copy referral link" })).toBeNull();
  });

  it.each([
    [409, /as many unused codes/],
    [500, /Couldn.t make a link/],
  ])("announces a mint answered %i", async (status, message) => {
    serveMint(status);
    render(<ReferralNudge />);
    await userEvent.click(await screen.findByRole("button", { name: "Copy referral link" }));
    await screen.findByText(message);
    expect(screen.getByRole("status").textContent).toMatch(message);
  });

  it.each([
    ["copied", () => writeText.mockResolvedValue(undefined), /copied/i],
    ["refused", () => writeText.mockRejectedValue(new Error("denied")), /box below/],
  ])("announces a copy the clipboard %s", async (_, answer, message) => {
    serveMint(201, [{ code: "OPEN23456", redeemed: false }]);
    // After setup, which puts its own clipboard on the window.
    const user = userEvent.setup();
    answer();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ReferralNudge />);
    await user.click(await screen.findByRole("button", { name: "Copy referral link" }));
    expect(await within(screen.getByRole("status")).findByText(message)).toBeTruthy();
  });
});
