import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LandingScreen } from "./LandingScreen";

afterEach(cleanup);

describe("LandingScreen", () => {
  it("leads with the product claim", () => {
    render(<LandingScreen />);
    expect(
      screen.getByRole("heading", { name: "Plan the trip together, not in twelve group chats." }),
    ).toBeDefined();
  });

  it("keeps a Sign in link — e2e/helpers.ts drives sign-in through it", () => {
    render(<LandingScreen />);
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/signin");
  });

  it("sends both primary calls to action to sign-up", () => {
    render(<LandingScreen />);
    expect(screen.getByRole("link", { name: "Start a trip" }).getAttribute("href")).toBe("/signup");
    expect(screen.getByRole("link", { name: "Continue with Google" }).getAttribute("href")).toBe("/signup");
  });

  it("marks 'Look around a real trip' as unbuilt rather than shipping a dead button", () => {
    const { container } = render(<LandingScreen />);
    const shell = container.querySelector('[data-preview-id="landing-peek-trip"]');
    expect(shell).not.toBeNull();
    expect(shell?.textContent).toContain("Look around a real trip");
  });

  it("shows the sample itinerary and the proof chips", () => {
    render(<LandingScreen />);
    expect(screen.getByText("Day 6 · Kyoto")).toBeDefined();
    expect(screen.getByText("Fushimi Inari, early")).toBeDefined();
    expect(screen.getByText("Four people, one plan")).toBeDefined();
  });
});
