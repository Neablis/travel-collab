import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReferralNudge } from "./ReferralNudge";

// A failed or refused mint changes only text beside the button, whose name
// stays "Copy referral link": unless that text is in a live region, a screen
// reader user presses Copy and hears nothing either way.

function serveMint(status: number, codes: { code: string; redeemed: boolean }[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(JSON.stringify({ error: "nope" }), { status })
        : new Response(JSON.stringify({ codes, earnsReward: true }), { status: 200 }),
    ),
  );
}

const writeText = vi.fn();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReferralNudge", () => {
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
