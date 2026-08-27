import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LandingScreen } from "./LandingScreen";

afterEach(cleanup);

describe("LandingScreen", () => {
  it("leads with the product claim", () => {
    render(<LandingScreen />);
    expect(
      screen.getByRole("heading", { name: "The trip everyone actually helped plan." }),
    ).toBeDefined();
  });

  it("keeps a Sign in link — e2e/helpers.ts drives sign-in through it", () => {
    render(<LandingScreen />);
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/signin");
  });

  it("sends every primary call to action to sign-up", () => {
    render(<LandingScreen />);
    // "Start a trip" is asked twice — header and closing CTA band — so this
    // enumerates both rather than loosening the assertion to the first match.
    const startTrip = screen.getAllByRole("link", { name: "Start a trip" });
    expect(startTrip).toHaveLength(2);
    for (const link of startTrip) expect(link.getAttribute("href")).toBe("/signup");
    expect(screen.getByRole("link", { name: "Continue with Google" }).getAttribute("href")).toBe("/signup");
  });

  it("marks both peek-at-a-trip buttons as unbuilt rather than shipping dead buttons", () => {
    const { container } = render(<LandingScreen />);
    // Two shells with distinct ids, not one id used twice: the e2e spec locates
    // by `data-preview-id` and Playwright's strict mode fails on two matches.
    // querySelectorAll + a length assertion, not querySelector: the whole
    // reason these are two distinct ids is that a duplicate breaks Playwright's
    // strict mode in the e2e spec, and a first-match lookup would pass happily
    // against exactly the duplicate this is meant to catch (CodeRabbit, PR #58).
    const peek = container.querySelectorAll('[data-preview-id="landing-peek-trip"]');
    const finished = container.querySelectorAll('[data-preview-id="landing-see-finished"]');
    expect(peek).toHaveLength(1);
    expect(finished).toHaveLength(1);
    expect(peek[0]?.textContent).toContain("Look around a real trip");
    expect(finished[0]?.textContent).toContain("See a finished one");
  });

  it("carries the Early access footnote", () => {
    render(<LandingScreen />);
    expect(screen.getByText(/Early access/)).toBeDefined();
  });

  it("names what the page is for", () => {
    render(<LandingScreen />);
    expect(
      screen.getByRole("heading", { name: "Planning is the trip, three times over." }),
    ).toBeDefined();
  });

  // SPEC §14, copy rules: no "free", no "open source", no "no credit card" —
  // Caesura is a product for groups, not a tool, and the only footnote is
  // "Early access". The page shipped all three of those before this pass;
  // this is the guard that stops the old positioning creeping back.
  // `free` is word-bounded on purpose: the Playbooks block's fixture copy
  // legitimately reads "Sunrise, Freedom Beach" (`dc.html:2169`).
  it.each([
    ["free", /\bfree\b/i],
    ["open source", /open[ -]source/i],
    ["no credit card", /credit card/i],
  ])("never sells itself on %s (SPEC §14)", (_label, pattern) => {
    const { container } = render(<LandingScreen />);
    expect(container.textContent ?? "").not.toMatch(pattern);
  });
});
