import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReferralNudge } from "./ReferralNudge";

// A failed or refused mint changes only text beside the button, whose name
// stays "Copy referral link": unless that text is in a live region, a screen
// reader user presses Copy and hears nothing either way.

function serveMint(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(JSON.stringify({ error: "nope" }), { status })
        : new Response(JSON.stringify({ codes: [], earnsReward: true }), { status: 200 }),
    ),
  );
}

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
});
